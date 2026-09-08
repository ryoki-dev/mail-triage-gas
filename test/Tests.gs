/**
 * 単体テスト。GAS エディタで runAllTests を実行するとログに結果が出る。
 * ネットワーク（Anthropic API / Slack）や Gmail には触れない純粋関数のみを対象にする。
 */

function runAllTests() {
  var t = new TestRunner_();

  t.test('parseFrom_: 表示名つき', function (a) {
    var r = parseFrom_('山田 太郎 <taro@Example.com>');
    a.equal(r.name, '山田 太郎');
    a.equal(r.email, 'taro@example.com');
  });

  t.test('parseFrom_: メールのみ', function (a) {
    var r = parseFrom_('info@example.co.jp');
    a.equal(r.name, 'info@example.co.jp');
    a.equal(r.email, 'info@example.co.jp');
  });

  t.test('parseFrom_: ダブルクォート付き表示名', function (a) {
    var r = parseFrom_('"Support, ACME" <support@acme.test>');
    a.equal(r.name, 'Support, ACME');
    a.equal(r.email, 'support@acme.test');
  });

  t.test('splitList_: 区切り文字ゆらぎ', function (a) {
    a.deepEqual(splitList_('高, 中　低'), ['高', '中', '低']);
    a.deepEqual(splitList_('高'), ['高']);
    a.deepEqual(splitList_(''), []);
  });

  t.test('toPositiveInt_: 不正値はフォールバック', function (a) {
    a.equal(toPositiveInt_('30', 10), 30);
    a.equal(toPositiveInt_('abc', 10), 10);
    a.equal(toPositiveInt_('-4', 10), 10);
    a.equal(toPositiveInt_('', 10), 10);
  });

  t.test('sanitizeLabel_: スラッシュを全角化', function (a) {
    a.equal(sanitizeLabel_('見積/料金'), '見積／料金');
    a.equal(sanitizeLabel_(''), 'その他');
  });

  t.test('extractJsonText_: 構造化出力レスポンスからJSONを取り出す', function (a) {
    var fakeResponse = {
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '{"category":"不具合・クレーム","priority":"高",' +
          '"summary":"注文した商品が破損していた。","recommended_action":"交換手配の連絡をする。",' +
          '"contains_personal_info":true}' },
      ],
    };
    var data = JSON.parse(extractJsonText_(fakeResponse));
    a.equal(data.category, '不具合・クレーム');
    a.equal(data.priority, '高');
    a.equal(data.contains_personal_info, true);
  });

  t.test('extractJsonText_: テキストブロックが無ければ例外', function (a) {
    a.throws(function () {
      extractJsonText_({ content: [{ type: 'thinking', thinking: '' }] });
    });
  });

  t.report();
}

/** ------- 最小限のテストランナー ------- */
function TestRunner_() {
  this.passed = 0;
  this.failed = 0;
  this.failures = [];
}

TestRunner_.prototype.test = function (name, fn) {
  try {
    fn(new Assert_());
    this.passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    this.failed++;
    this.failures.push(name + ' — ' + ((e && e.message) || e));
    console.error('  FAIL  ' + name + ' — ' + ((e && e.message) || e));
  }
};

TestRunner_.prototype.report = function () {
  console.log('--------------------------------');
  console.log('結果: %d 件成功 / %d 件失敗', this.passed, this.failed);
  if (this.failed > 0) {
    throw new Error('テスト失敗:\n' + this.failures.join('\n'));
  }
};

function Assert_() {}
Assert_.prototype.equal = function (actual, expected) {
  if (actual !== expected) {
    throw new Error('期待値 ' + JSON.stringify(expected) + ' ≠ 実際 ' + JSON.stringify(actual));
  }
};
Assert_.prototype.deepEqual = function (actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('期待値 ' + JSON.stringify(expected) + ' ≠ 実際 ' + JSON.stringify(actual));
  }
};
Assert_.prototype.throws = function (fn) {
  try {
    fn();
  } catch (e) {
    return;
  }
  throw new Error('例外が発生しませんでした');
};
