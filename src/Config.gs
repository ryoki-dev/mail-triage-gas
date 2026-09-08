/**
 * 設定の読み込み。
 *
 * 方針: 「業務ルールはコードに書かない」。
 *   - 秘密情報・インフラ設定 …… スクリプトプロパティ（プロジェクトの設定 > スクリプト プロパティ）
 *   - 業務ルール（対象メール・カテゴリ・通知条件など）…… スプレッドシートの「設定」「カテゴリ」シート
 *
 * こうしておくと、分類カテゴリや通知の閾値を変えたいとき、
 * 非エンジニアでもスプレッドシートを編集するだけで運用を変更できる。
 */

/** スクリプトプロパティのキー名 */
var PROP_KEYS = {
  API_KEY: 'ANTHROPIC_API_KEY',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  SLACK_WEBHOOK_URL: 'SLACK_WEBHOOK_URL',
};

/** 「設定」シートに書き込む既定値（initialSetup で使用） */
var DEFAULT_SETTINGS = [
  ['キー', '値', '説明'],
  ['対象Gmail検索クエリ', 'label:問い合わせ -label:仕分け済み newer_than:7d',
    'この検索条件に一致するスレッドを処理対象にする（Gmailの検索構文）'],
  ['1回の最大処理数', '20', '1回の実行で処理するスレッドの上限。API課金と実行時間の上限を制御'],
  ['本文の最大文字数', '4000', 'AIに渡す本文の文字数上限。長いメールはこの長さで切り詰める'],
  ['通知する優先度', '高', 'Slack通知する優先度をカンマ区切りで指定（例: 高,中）'],
  ['仕分け済みラベル名', '仕分け済み', '処理が完了したスレッドに付けるGmailラベル'],
  ['優先度の判定方針',
    '緊急のトラブル・クレーム・支払い関連・期限が明記された依頼は「高」。' +
    '通常の見積・相談は「中」。営業・提携の打診や情報提供のみは「低」。',
    'AIに渡す優先度判定のガイドライン。自社の運用に合わせて自由に書き換え可'],
  ['ドライラン', 'false',
    'true のあいだはGmailラベル付与とSlack通知を行わず、ログ記録のみ（動作確認用）'],
  ['Claudeモデル', 'claude-opus-5',
    '分類に使うモデルID。コスト重視なら claude-haiku-4-5、中間は claude-sonnet-5'],
];

/** 「カテゴリ」シートに書き込む既定値（initialSetup で使用） */
var DEFAULT_CATEGORIES = [
  ['カテゴリ', '説明（AIの判断材料になる）'],
  ['見積・料金の問い合わせ', '料金、見積依頼、発注の相談、契約条件に関するもの'],
  ['不具合・クレーム', '製品やサービスの不具合報告、苦情、返金・交換の要求'],
  ['一般的な問い合わせ', '仕様の質問、使い方、資料請求など上記以外の顧客からの質問'],
  ['営業・提携の打診', '広告・ツール・業務提携などの売り込み、代理店の案内'],
  ['スパム・無関係', '無差別送信、フィッシング、業務と関係のないメール'],
  ['その他', '上記のいずれにも当てはまらないもの'],
];

/**
 * 実行時の設定オブジェクトを組み立てて返す。
 * @return {{
 *   apiKey: string, spreadsheetId: string, slackWebhookUrl: string,
 *   model: string, gmailQuery: string, maxThreads: number, maxBodyChars: number,
 *   notifyPriorities: string[], doneLabel: string, priorityPolicy: string,
 *   dryRun: boolean, categories: {name: string, description: string}[]
 * }}
 */
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty(PROP_KEYS.API_KEY) || '').trim();
  if (!apiKey) {
    throw new Error(
      'スクリプトプロパティ ' + PROP_KEYS.API_KEY + ' が未設定です。' +
      'README のセットアップ手順を参照してください。');
  }

  var spreadsheetId = (props.getProperty(PROP_KEYS.SPREADSHEET_ID) || '').trim();
  if (!spreadsheetId) {
    throw new Error(
      'スクリプトプロパティ ' + PROP_KEYS.SPREADSHEET_ID + ' が未設定です。' +
      'initialSetup を実行するか、既存のスプレッドシートIDを設定してください。');
  }

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var settings = readKeyValueSheet_(ss, '設定');
  var categories = readCategoriesSheet_(ss, 'カテゴリ');
  if (categories.length === 0) {
    throw new Error('「カテゴリ」シートにカテゴリが1件も定義されていません。');
  }

  return {
    apiKey: apiKey,
    spreadsheetId: spreadsheetId,
    slackWebhookUrl: (props.getProperty(PROP_KEYS.SLACK_WEBHOOK_URL) || '').trim(),
    model: settings['Claudeモデル'] || 'claude-opus-5',
    gmailQuery: settings['対象Gmail検索クエリ'] || 'label:問い合わせ -label:仕分け済み newer_than:7d',
    maxThreads: toPositiveInt_(settings['1回の最大処理数'], 20),
    maxBodyChars: toPositiveInt_(settings['本文の最大文字数'], 4000),
    notifyPriorities: splitList_(settings['通知する優先度'] || '高'),
    doneLabel: settings['仕分け済みラベル名'] || '仕分け済み',
    priorityPolicy: settings['優先度の判定方針'] || '',
    dryRun: String(settings['ドライラン'] || 'false').toLowerCase() === 'true',
    categories: categories,
  };
}

/** 「キー / 値」形式のシートを { キー: 値 } に変換 */
function readKeyValueSheet_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return {};
  var values = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) out[key] = String(values[i][1] == null ? '' : values[i][1]).trim();
  }
  return out;
}

/** 「カテゴリ / 説明」シートを配列に変換 */
function readCategoriesSheet_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][0] || '').trim();
    if (name) out.push({ name: name, description: String(values[i][1] || '').trim() });
  }
  return out;
}

function toPositiveInt_(value, fallback) {
  var n = parseInt(value, 10);
  return (isFinite(n) && n > 0) ? n : fallback;
}

function splitList_(value) {
  return String(value).split(/[,、\s]+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}
