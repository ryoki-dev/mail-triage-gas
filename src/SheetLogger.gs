/**
 * スプレッドシートへの記録。
 *   - 「ログ」シート     … 1問い合わせ = 1行。分類結果と対応状況
 *   - 「実行ログ」シート … 1実行 = 1行。処理件数・エラー件数・所要時間
 */

var SHEET = {
  LOG: 'ログ',
  RUN_LOG: '実行ログ',
  SETTINGS: '設定',
  CATEGORIES: 'カテゴリ',
};

var LOG_HEADERS = [
  '受信日時', '差出人', '差出人メール', '件名', 'カテゴリ', '優先度',
  '要約', '推奨アクション', '個人情報', '対応状況', 'メッセージID', '処理日時', 'モデル',
];

var RUN_LOG_HEADERS = [
  '開始', '終了', '所要秒', '取得スレッド', '分類成功', 'スキップ', 'エラー', '通知', 'ドライラン',
];

function getSheet_(cfg, name, headers) {
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 既にログ済みのメッセージIDの集合を返す（二重処理防止用）。
 * status=ERROR の行は「未処理」とみなし、次回実行でリトライさせる。
 */
function loadProcessedMessageIds_(cfg) {
  var sheet = getSheet_(cfg, SHEET.LOG, LOG_HEADERS);
  var idCol = LOG_HEADERS.indexOf('メッセージID') + 1;
  var statusCol = LOG_HEADERS.indexOf('対応状況') + 1;
  var lastRow = sheet.getLastRow();
  var set = {};
  if (lastRow < 2) return set;
  var rows = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][idCol - 1] || '').trim();
    var status = String(rows[i][statusCol - 1] || '').trim();
    if (id && status !== 'ERROR') set[id] = true;
  }
  return set;
}

/** 分類結果を1行追記 */
function appendTriageRow_(cfg, message, parsed) {
  var sheet = getSheet_(cfg, SHEET.LOG, LOG_HEADERS);
  var sender = parseFrom_(message.getFrom());
  sheet.appendRow([
    message.getDate(),
    sender.name,
    sender.email,
    message.getSubject() || '(件名なし)',
    parsed.category,
    parsed.priority,
    parsed.summary,
    parsed.recommendedAction,
    parsed.containsPersonalInfo ? '有' : '',
    '未対応',
    message.getId(),
    new Date(),
    parsed.model,
  ]);
}

/** 分類に失敗したメールも記録（次回実行でリトライされる想定） */
function appendErrorRow_(cfg, message, err) {
  var sheet = getSheet_(cfg, SHEET.LOG, LOG_HEADERS);
  var sender = parseFrom_(message.getFrom());
  sheet.appendRow([
    message.getDate(),
    sender.name,
    sender.email,
    message.getSubject() || '(件名なし)',
    '（エラー）',
    '',
    String((err && err.message) || err).substring(0, 500),
    '手動で確認してください',
    '',
    'ERROR',
    message.getId(),
    new Date(),
    cfg.model,
  ]);
}

/** 1実行のサマリを記録 */
function writeRunLog_(cfg, startedAt, endedAt, stats) {
  var sheet = getSheet_(cfg, SHEET.RUN_LOG, RUN_LOG_HEADERS);
  sheet.appendRow([
    startedAt,
    endedAt,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    stats.fetched,
    stats.classified,
    stats.skipped,
    stats.errors,
    stats.notified,
    cfg.dryRun ? 'true' : '',
  ]);
}

/** "山田 太郎 <taro@example.com>" → { name: "山田 太郎", email: "taro@example.com" } */
function parseFrom_(from) {
  from = String(from || '');
  var m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  }
  return { name: from.trim(), email: from.trim().toLowerCase() };
}
