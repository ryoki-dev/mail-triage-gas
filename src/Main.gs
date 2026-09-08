/**
 * 問い合わせメール自動仕分けツール — エントリポイント。
 *
 * 処理の流れ:
 *   1. 「設定」シートの検索クエリに一致する Gmail スレッドを取得
 *   2. 各スレッドの最新メッセージを Claude API で分類（カテゴリ / 優先度 / 要約 / 推奨アクション）
 *   3. 結果を「ログ」シートに1行追記
 *   4. （ドライランでなければ）Gmail にカテゴリ別ラベルと「仕分け済み」ラベルを付与
 *   5. （ドライランでなければ）優先度が通知対象のものを Slack に通知
 *   6. 実行サマリを「実行ログ」シートに記録
 *
 * 冪等性: 「仕分け済み」ラベルで対象から除外するのに加え、
 *         ログ済みメッセージID（成功行のみ）を突き合わせて二重処理を防ぐ。
 *         分類が失敗したメールは次回実行でリトライされる。
 *         1通の分類失敗が全体を止めないよう、例外はメール単位で捕捉する。
 */

/** 時間主導トリガーから呼ばれるメイン処理 */
function run() {
  var startedAt = new Date();
  var cfg = getConfig();
  var stats = { fetched: 0, classified: 0, skipped: 0, errors: 0, notified: 0 };

  var processedIds = loadProcessedMessageIds_(cfg);
  var threads = fetchTargetThreads_(cfg);
  stats.fetched = threads.length;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var message = latestMessage_(thread);
    var messageId = message.getId();

    if (processedIds[messageId]) {
      stats.skipped++;
      continue;
    }

    var parsed;
    try {
      parsed = classifyMessage_(message, cfg);
      appendTriageRow_(cfg, message, parsed);
      stats.classified++;
    } catch (err) {
      stats.errors++;
      appendErrorRow_(cfg, message, err);
      console.error('分類失敗 messageId=%s: %s', messageId, (err && err.stack) || err);
      continue; // 分類できなかったのでラベル付与・通知は行わない
    }

    if (cfg.dryRun) continue;

    // ここから先（Gmail操作・Slack通知）の失敗は警告扱い。分類結果は既に保存済み。
    try {
      applyLabels_(thread, parsed, cfg);
      if (cfg.notifyPriorities.indexOf(parsed.priority) !== -1) {
        notifySlack_(message, parsed, cfg);
        stats.notified++;
      }
    } catch (postErr) {
      console.warn('ラベル付与/通知で警告 messageId=%s: %s', messageId, postErr);
    }
  }

  writeRunLog_(cfg, startedAt, new Date(), stats);
  if (stats.errors > 0 && !cfg.dryRun) {
    notifySlackError_(cfg, stats);
  }
  console.log('完了: %s', JSON.stringify(stats));
}

/** スレッド内の最新メッセージ（=最後に届いたメッセージ）を返す */
function latestMessage_(thread) {
  var messages = thread.getMessages();
  return messages[messages.length - 1];
}

/**
 * 1通のメッセージを分類し、Gmail 操作用に整形した結果を返す。
 * @return {{category: string, priority: string, summary: string,
 *           recommendedAction: string, containsPersonalInfo: boolean, model: string}}
 */
function classifyMessage_(message, cfg) {
  var body = message.getPlainBody() || '';
  if (body.length > cfg.maxBodyChars) {
    body = body.substring(0, cfg.maxBodyChars) + '\n…（以下略）';
  }

  return callClassifier_({
    from: message.getFrom(),
    subject: message.getSubject() || '(件名なし)',
    date: message.getDate(),
    body: body,
  }, cfg);
}
