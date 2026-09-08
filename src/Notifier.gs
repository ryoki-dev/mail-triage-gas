/**
 * Slack への通知（Incoming Webhook）。
 * SLACK_WEBHOOK_URL が未設定なら通知はスキップする（エラーにしない）。
 */

/** 優先度が通知対象の問い合わせを Slack に投げる */
function notifySlack_(message, parsed, cfg) {
  if (!cfg.slackWebhookUrl) return;

  var sender = parseFrom_(message.getFrom());
  var lines = [
    ':envelope_with_arrow: *新しい問い合わせ（優先度: ' + parsed.priority + '）*',
    '*カテゴリ*: ' + parsed.category,
    '*差出人*: ' + sender.name + ' <' + sender.email + '>',
    '*件名*: ' + (message.getSubject() || '(件名なし)'),
    '*要約*:\n' + parsed.summary,
    '*推奨アクション*: ' + parsed.recommendedAction,
    '<' + threadPermalink_(message) + '|Gmail で開く>',
  ];
  postToSlack_(cfg.slackWebhookUrl, { text: lines.join('\n') });
}

/** 実行中にエラーが出たことを Slack に通知 */
function notifySlackError_(cfg, stats) {
  if (!cfg.slackWebhookUrl) return;
  postToSlack_(cfg.slackWebhookUrl, {
    text: ':warning: 問い合わせ仕分けツールで ' + stats.errors +
      ' 件の分類エラーが発生しました。「ログ」シートの status=ERROR の行を確認してください。',
  });
}

function postToSlack_(webhookUrl, body) {
  var res = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.warn('Slack通知に失敗: %s %s', res.getResponseCode(), res.getContentText());
  }
}

/** Gmail スレッドを開くパーマリンク */
function threadPermalink_(message) {
  try {
    return message.getThread().getPermalink();
  } catch (e) {
    return 'https://mail.google.com/';
  }
}
