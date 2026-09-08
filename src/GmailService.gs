/**
 * Gmail の取得とラベル操作。
 */

/** 「設定」の検索クエリに一致するスレッドを取得（最大件数は設定で制御） */
function fetchTargetThreads_(cfg) {
  return GmailApp.search(cfg.gmailQuery, 0, cfg.maxThreads);
}

/**
 * スレッドにラベルを付ける。
 *   - カテゴリ別ラベル: 「問い合わせ/見積・料金の問い合わせ」のような階層ラベル
 *   - 完了ラベル: 「仕分け済み」（次回以降、検索クエリで除外される）
 * ラベルが無ければ作成する。
 */
function applyLabels_(thread, parsed, cfg) {
  var categoryLabelName = cfg.doneLabel + '/' + sanitizeLabel_(parsed.category);
  getOrCreateLabel_(categoryLabelName).addToThread(thread);
  getOrCreateLabel_(cfg.doneLabel).addToThread(thread);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Gmail ラベルに使えない文字を除去 */
function sanitizeLabel_(s) {
  return String(s).replace(/[\/\\]/g, '／').trim() || 'その他';
}
