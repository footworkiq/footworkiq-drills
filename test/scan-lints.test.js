// Tests for scripts/lib/scan-lints.js. The flag/pass vectors come from
// docs/schema/scan-rules.json, the byte copy of the app's file, so these are
// the same vectors the app's matcher (scripts/lib/scanLint.cjs) runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintScanCard, findSceneWords, findOptionWords, SCAN_RULES } from '../scripts/lib/scan-lints.js';

const good = JSON.parse(
  readFileSync(new URL('./fixtures/cards/scan-good/scan-fx-receiving.json', import.meta.url), 'utf8'),
);

function card(mutate = () => {}) {
  const c = structuredClone(good);
  mutate(c);
  return c;
}

const rules = (issues) => issues.map((i) => i.rule);

test('the good scan fixture has no scan issues', () => {
  assert.deepEqual(lintScanCard(good), []);
});

for (const text of SCAN_RULES.vectors.prompt.flag) {
  test(`prompt vector flags: ${text}`, () => {
    assert.ok(findSceneWords(text).length > 0, `expected a hit in ${JSON.stringify(text)}`);
    const issues = lintScanCard(card((c) => { c.scan.prompt = text; }));
    assert.ok(rules(issues).includes('scan-prompt-word'), JSON.stringify(issues));
  });
}

for (const text of SCAN_RULES.vectors.prompt.pass) {
  test(`prompt vector passes: ${text}`, () => {
    assert.deepEqual(findSceneWords(text), []);
    assert.deepEqual(lintScanCard(card((c) => { c.scan.prompt = text; })), []);
  });
}

for (const text of SCAN_RULES.vectors.option.flag) {
  test(`option vector flags: ${text}`, () => {
    assert.ok(findOptionWords(text).length > 0, `expected a hit in ${JSON.stringify(text)}`);
    const issues = lintScanCard(card((c) => { c.options[1].text = text; }));
    assert.ok(issues.some((i) => i.rule === 'scan-option-word' && i.field === 'options[1].text'), JSON.stringify(issues));
  });
}

for (const text of SCAN_RULES.vectors.option.pass) {
  test(`option vector passes: ${text}`, () => {
    assert.deepEqual(findOptionWords(text), []);
    assert.deepEqual(lintScanCard(card((c) => { c.options[1].text = text; })), []);
  });
}

test('a player count is reported once', () => {
  assert.deepEqual(findSceneWords('Two defenders are coming.'), ['Two defenders']);
  assert.deepEqual(findSceneWords('Take two touches.'), []);
});

test('question text uses the scene words', () => {
  const issues = lintScanCard(card((c) => { c.text = 'Which team-mate do you pass to?'; }));
  assert.deepEqual(rules(issues), ['scan-text-word']);
});

test('why and tip are never checked', () => {
  const issues = lintScanCard(
    card((c) => {
      c.tip = 'Find the unmarked player in space.';
      c.options[0].why = 'The defender was closing you down.';
    }),
  );
  assert.deepEqual(issues, []);
});

test('80-char prompt passes, 81-char prompt fails', () => {
  const at = 'Look first. '.padEnd(80, 'a');
  assert.equal(at.length, 80);
  assert.deepEqual(lintScanCard(card((c) => { c.scan.prompt = at; })), []);
  const over = at + 'a';
  assert.deepEqual(rules(lintScanCard(card((c) => { c.scan.prompt = over; }))), ['scan-prompt-length']);
});

test('a defend area on an attack card fails scan-area-side', () => {
  const issues = lintScanCard(card((c) => { c.scan.area = 'pressing'; }));
  assert.deepEqual(rules(issues), ['scan-area-side']);
  assert.equal(issues[0].phrase, 'pressing');
});

test('an attack area on a defend card fails scan-area-side', () => {
  const issues = lintScanCard(card((c) => { c.category = 'defend'; }));
  assert.deepEqual(rules(issues), ['scan-area-side']);
});

test('an allow-listed exact string is suppressed', () => {
  const text = "You're unmarked in midfield.";
  const c = card((x) => { x.scan.prompt = text; });
  assert.ok(lintScanCard(c, { allowlist: [] }).length > 0);
  assert.deepEqual(lintScanCard(c, { allowlist: [{ text, reason: 'test' }] }), []);
  // Only the whole string matches.
  assert.ok(lintScanCard(c, { allowlist: [{ text: 'unmarked', reason: 'test' }] }).length > 0);
});

test('a card without scan returns []', () => {
  const c = card((x) => { delete x.scan; x.text = 'The defender is closing you down.'; });
  assert.deepEqual(lintScanCard(c), []);
  assert.deepEqual(lintScanCard(null), []);
});

test('malformed scan fields do not throw', () => {
  assert.doesNotThrow(() => lintScanCard(card((c) => { c.scan.prompt = 42; c.options = 'x'; })));
});
