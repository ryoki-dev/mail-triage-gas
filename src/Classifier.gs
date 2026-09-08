/**
 * Claude API（Anthropic Messages API）による問い合わせメールの分類。
 *
 * GAS には公式SDKが無いため UrlFetchApp による生HTTPで呼び出す。
 * 構造化出力（output_config.format / json_schema）を使い、
 * 応答が必ず指定スキーマのJSONになることを保証する。
 *
 * 参考: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */

var ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var API_MAX_RETRY = 2; // 429 / 5xx のときのリトライ回数

/**
 * @param {{from:string, subject:string, date:Date, body:string}} input
 * @param {object} cfg getConfig() の戻り値
 * @return {{category:string, priority:string, summary:string,
 *           recommendedAction:string, containsPersonalInfo:boolean, model:string}}
 */
function callClassifier_(input, cfg) {
  var categoryNames = cfg.categories.map(function (c) { return c.name; });
  var categoryGuide = cfg.categories.map(function (c) {
    return '- ' + c.name + '：' + (c.description || '');
  }).join('\n');

  var systemPrompt = [
    'あなたは企業のカスタマーサポート窓口で、受信した問い合わせメールを最初に振り分けるトリアージ担当です。',
    'メールを読み、次の各項目を日本語で出力してください。',
    '',
    '【カテゴリ】次のいずれか1つを選ぶ:',
    categoryGuide,
    '',
    '【優先度】「高」「中」「低」のいずれか。判定方針:',
    cfg.priorityPolicy || '緊急のトラブル・支払い関連・期限のある依頼は高、通常の相談は中、売り込みは低。',
    '',
    '【要約】本文の要点を3行以内で。挨拶や署名は省く。',
    '【推奨アクション】担当者が次に取るべき具体的な行動を1〜2文で。',
    '【個人情報の有無】本文に氏名・電話番号・住所・口座番号などの個人情報が含まれるか。',
    '',
    '推測が難しい場合でも必ずいずれかのカテゴリと優先度を選ぶこと。カテゴリ名は指定の表記と完全に一致させること。',
  ].join('\n');

  var userContent = [
    '差出人: ' + input.from,
    '受信日時: ' + Utilities.formatDate(input.date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    '件名: ' + input.subject,
    '',
    '--- 本文 ---',
    input.body,
  ].join('\n');

  var schema = {
    type: 'object',
    properties: {
      category: { type: 'string', enum: categoryNames },
      priority: { type: 'string', enum: ['高', '中', '低'] },
      summary: { type: 'string', description: '3行以内の日本語要約' },
      recommended_action: { type: 'string', description: '担当者が次に取るべき具体的な行動' },
      contains_personal_info: { type: 'boolean' },
    },
    required: ['category', 'priority', 'summary', 'recommended_action', 'contains_personal_info'],
    additionalProperties: false,
  };

  var payload = {
    model: cfg.model,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    output_config: {
      format: { type: 'json_schema', schema: schema },
      effort: 'low', // 分類タスクなので浅い思考で十分。コストと速度を優先
    },
  };

  var json = anthropicRequest_(payload, cfg.apiKey);
  var raw = extractJsonText_(json);
  var data = JSON.parse(raw);

  return {
    category: data.category,
    priority: data.priority,
    summary: data.summary,
    recommendedAction: data.recommended_action,
    containsPersonalInfo: !!data.contains_personal_info,
    model: json.model || cfg.model,
  };
}

/** Messages API を呼び出し、パース済みレスポンスJSONを返す。429/5xx はリトライ */
function anthropicRequest_(payload, apiKey) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var lastError = null;
  for (var attempt = 0; attempt <= API_MAX_RETRY; attempt++) {
    if (attempt > 0) Utilities.sleep(Math.pow(2, attempt) * 1000); // 2s, 4s

    var res = UrlFetchApp.fetch(ANTHROPIC_ENDPOINT, options);
    var code = res.getResponseCode();
    var text = res.getContentText();

    if (code === 200) {
      var json = JSON.parse(text);
      if (json.stop_reason === 'refusal') {
        throw new Error('Claude がリクエストを拒否しました（stop_reason=refusal）。');
      }
      return json;
    }

    if (code === 429 || code >= 500) {
      lastError = new Error('Anthropic API ' + code + ': ' + truncate_(text, 500));
      continue; // リトライ
    }

    // 4xx（キー誤り・リクエスト不正など）はリトライしても直らないので即中断
    throw new Error('Anthropic API ' + code + ': ' + truncate_(text, 500));
  }
  throw lastError || new Error('Anthropic API 呼び出しに失敗しました。');
}

/** 構造化出力のレスポンスから、最初のテキストブロック（=JSON文字列）を取り出す */
function extractJsonText_(json) {
  var content = json.content || [];
  for (var i = 0; i < content.length; i++) {
    if (content[i].type === 'text' && typeof content[i].text === 'string') {
      return content[i].text;
    }
  }
  throw new Error('レスポンスにテキストブロックがありません: ' + JSON.stringify(json).substring(0, 500));
}

function truncate_(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.substring(0, n) + '…' : s;
}
