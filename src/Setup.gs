/**
 * 初期セットアップと運用補助。
 *
 * 使い方（初回）:
 *   1. スクリプトプロパティに ANTHROPIC_API_KEY を設定
 *   2. この initialSetup() を実行
 *      → スプレッドシートを新規作成し、そのIDをスクリプトプロパティ SPREADSHEET_ID に保存
 *      → 「設定」「カテゴリ」「ログ」「実行ログ」シートを既定値つきで作成
 *      → 15分ごとの実行トリガーを登録
 *   3. 実行ログに出力されたスプレッドシートURLを開き、「設定」「カテゴリ」を自社向けに調整
 *   4. Gmail に「問い合わせ」ラベルを作り、対象メールに付ける（またはフィルタで自動付与）
 *   5. previewNextBatch() で数件テスト → 問題なければ「設定」のドライランを false に
 */

function initialSetup() {
  var props = PropertiesService.getScriptProperties();

  if (!(props.getProperty(PROP_KEYS.API_KEY) || '').trim()) {
    throw new Error('先にスクリプトプロパティ ' + PROP_KEYS.API_KEY + ' を設定してください。');
  }

  var spreadsheetId = (props.getProperty(PROP_KEYS.SPREADSHEET_ID) || '').trim();
  var ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.create('問い合わせ仕分けログ');
    props.setProperty(PROP_KEYS.SPREADSHEET_ID, ss.getId());
  }

  writeSheetIfEmpty_(ss, SHEET.SETTINGS, DEFAULT_SETTINGS);
  writeSheetIfEmpty_(ss, SHEET.CATEGORIES, DEFAULT_CATEGORIES);
  ensureHeaderSheet_(ss, SHEET.LOG, LOG_HEADERS);
  ensureHeaderSheet_(ss, SHEET.RUN_LOG, RUN_LOG_HEADERS);
  removeDefaultSheet_(ss);

  registerTrigger_(15);

  console.log('セットアップ完了。設定シートを開いて調整してください:\n%s', ss.getUrl());
  return ss.getUrl();
}

/** 実行トリガーを（重複なく）登録。everyMinutes は 1,5,10,15,30 のいずれか */
function registerTrigger_(everyMinutes) {
  deleteTriggers_();
  ScriptApp.newTrigger('run').timeBased().everyMinutes(everyMinutes).create();
  console.log('%d 分ごとのトリガーを登録しました。', everyMinutes);
}

function deleteTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'run') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * 次に処理されるメールを、Gmail もスプレッドシートも書き換えずに分類してログに出すだけの確認用。
 * 「設定」のドライランが true でなくても、この関数はラベル付与・Slack通知を行わない。
 */
function previewNextBatch() {
  var cfg = getConfig();
  cfg.dryRun = true; // 強制ドライラン
  var processedIds = loadProcessedMessageIds_(cfg);
  var threads = fetchTargetThreads_(cfg);
  var shown = 0;

  for (var i = 0; i < threads.length && shown < 5; i++) {
    var message = latestMessage_(threads[i]);
    if (processedIds[message.getId()]) continue;
    var parsed = classifyMessage_(message, cfg);
    console.log(
      '【%s / %s】%s\n  要約: %s\n  推奨: %s',
      parsed.category, parsed.priority, message.getSubject(),
      parsed.summary, parsed.recommendedAction);
    appendTriageRow_(cfg, message, parsed);
    shown++;
  }
  console.log('プレビュー %d 件をログシートに記録しました（Gmailは未変更）。', shown);
}

function writeSheetIfEmpty_(ss, name, values) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, values[0].length);
}

function ensureHeaderSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function removeDefaultSheet_(ss) {
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
}
