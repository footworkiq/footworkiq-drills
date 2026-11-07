// Unit tests for scripts/lib/card-lints.js. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  BALANCE_LINTS_STRICT,
  CARD_TAGS,
  FIELD_CAPS,
  MAX_BEST_FIRST_SHARE,
  MAX_BEST_LONGEST_SHARE,
  MAX_BEST_SHORTEST_SHARE,
  MAX_OPTION_LENGTH_RATIO,
  MAX_TAGS,
  MAX_WORDS_PER_SENTENCE,
  MIN_CARDS_FOR_DECK_LINT,
  MIN_TAGS,
  OPTION_LENGTH_SLACK_CHARS,
  URL_RE,
  checkFormat,
  checkRevBump,
  deckStats,
  isFailure,
  lintCard,
  lintDeck,
  optionBalance,
  sentences,
  strings,
  wordCount,
} from '../scripts/lib/card-lints.js';

const BASE = (() => {
  const raw = JSON.parse(
    readFileSync(new URL('../cards/decision/back-pass.json', import.meta.url), 'utf8'),
  );
  const c = JSON.parse(JSON.stringify(raw));
  c.tags = ['keeper', 'laws'];
  // Pin the option order (best, ok, poor) so these tests don't depend on the
  // seeded order the card file is stored in (reorder-card-options.js).
  const order = ['pass-first-time', 'kick-long-pitch', 'pick-hands'];
  c.options.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return c;
})();

const clone = () => JSON.parse(JSON.stringify(BASE));

/** Exactly n chars of short two-word sentences ("Go on. Go on. ..."), so no sentence is long. */
const fill = (n) => 'Go on. '.repeat(Math.ceil(n / 7) + 1).slice(0, n);

const rules = (issues) => issues.map((i) => i.rule);

// ---------------------------------------------------------------- base card

test('base card has no lint issues', () => {
  assert.deepEqual(lintCard(clone()), []);
});

test('fill() helper produces exact lengths with short sentences', () => {
  for (const n of [40, 41, 64, 65, 140, 141, 160, 161]) {
    const s = fill(n);
    assert.equal(s.length, n);
    for (const x of sentences(s)) assert.ok(wordCount(x) <= MAX_WORDS_PER_SENTENCE);
  }
});

// ---------------------------------------------------------------- field caps

const capCases = [
  ['title', FIELD_CAPS.title, (c, v) => (c.title = v), '/title'],
  ['text', FIELD_CAPS.text, (c, v) => (c.text = v), '/text'],
  ['tip', FIELD_CAPS.tip, (c, v) => (c.tip = v), '/tip'],
  ['options[2].why', FIELD_CAPS.why, (c, v) => (c.options[2].why = v), '/options/2/why'],
];

for (const [name, cap, set, path] of capCases) {
  test(`field cap: ${name} of exactly ${cap} chars passes`, () => {
    const c = clone();
    set(c, fill(cap));
    assert.deepEqual(lintCard(c), []);
  });
  test(`field cap: ${name} of ${cap + 1} chars fails with field-cap at ${path}`, () => {
    const c = clone();
    set(c, fill(cap + 1));
    const issues = lintCard(c);
    assert.deepEqual(rules(issues), ['field-cap']);
    assert.equal(issues[0].path, path);
    assert.equal(issues[0].deferred, false);
    assert.match(issues[0].message, new RegExp(`is ${cap + 1} chars \\(max ${cap}\\); shorten it`));
  });
}

// Option text caps: keep all three options the same length so option-balance stays quiet.
test('field cap: options[1].text of exactly 64 chars passes', () => {
  const c = clone();
  for (const o of c.options) o.text = fill(FIELD_CAPS.option);
  assert.deepEqual(lintCard(c), []);
});

test('field cap: options[1].text of 65 chars fails with field-cap at /options/1/text', () => {
  const c = clone();
  for (const o of c.options) o.text = fill(FIELD_CAPS.option);
  c.options[1].text = fill(FIELD_CAPS.option + 1);
  const issues = lintCard(c);
  assert.deepEqual(rules(issues), ['field-cap']);
  assert.equal(issues[0].path, '/options/1/text');
});

// ---------------------------------------------------------------- words per sentence

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';

test('a 20-word sentence passes', () => {
  const c = clone();
  c.text = words(20);
  assert.equal(wordCount(c.text), 20);
  assert.deepEqual(lintCard(c), []);
});

test('a 21-word sentence fails with sentence-length', () => {
  const c = clone();
  c.text = words(21);
  const issues = lintCard(c);
  assert.deepEqual(rules(issues), ['sentence-length']);
  assert.equal(issues[0].path, '/text');
  assert.equal(issues[0].message, '/text has a 21-word sentence (max 20); split it');
});

test('a long sentence in options[].why is caught', () => {
  const c = clone();
  c.options[0].why = words(21);
  assert.deepEqual(rules(lintCard(c)), ['sentence-length']);
  assert.equal(lintCard(c)[0].path, '/options/0/why');
});

test('sentences() keeps a quoted exclamation inside one sentence', () => {
  assert.equal(sentences('Shout "Keeper!" and go.').length, 1);
});

test('sentences() splits on . ! and ?', () => {
  assert.deepEqual(sentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
});

test('wordCount() ignores punctuation-only tokens', () => {
  assert.equal(wordCount('Go - now, then 2 more!'), 5);
  assert.equal(wordCount(''), 0);
});

// ---------------------------------------------------------------- no URL

const urlCases = [
  ['https://example.com in options[0].why', (c) => (c.options[0].why = 'See https://example.com now.'), '/options/0/why'],
  ['www.example in text', (c) => (c.text = 'Look at www.example for more.'), '/text'],
  ['footworkiq.com in tip', (c) => (c.tip = 'Read footworkiq.com first.'), '/tip'],
  ['http://x.io in title', (c) => (c.title = 'Go http://x.io'), '/title'],
];

for (const [name, mutate, path] of urlCases) {
  test(`no-url: ${name} fails`, () => {
    const c = clone();
    mutate(c);
    const issues = lintCard(c).filter((i) => i.rule === 'no-url');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].path, path);
    assert.equal(issues[0].deferred, false);
    assert.match(issues[0].message, /; remove links and domains from card text$/);
  });
}

test('no-url: a domain in a non-prose string field (contributor) is caught', () => {
  const c = clone();
  c.contributor = 'example.org';
  assert.deepEqual(rules(lintCard(c)), ['no-url']);
  assert.equal(lintCard(c)[0].path, '/contributor');
});

test('no-url: schema "1.0" and a 2–1 score do not match', () => {
  assert.equal(URL_RE.test('1.0'), false);
  assert.equal(URL_RE.test('2–1'), false);
  assert.equal(URL_RE.test("It's 2–1. Go on."), false);
  const c = clone();
  c.text = "It's 2–1 with a minute left. You're the keeper.";
  assert.deepEqual(lintCard(c), []);
});

test('strings() yields JSON-pointer paths for every string leaf', () => {
  const got = [...strings({ a: 'x', b: [1, 'y', { c: 'z' }] })];
  assert.deepEqual(got, [
    ['/a', 'x'],
    ['/b/1', 'y'],
    ['/b/2/c', 'z'],
  ]);
  assert.deepEqual([...strings('root')], [['/', 'root']]);
});

// ---------------------------------------------------------------- tags

test('tags: an unknown tag fails with tag-unknown', () => {
  const c = clone();
  c.tags = ['tactics'];
  const issues = lintCard(c);
  assert.deepEqual(rules(issues), ['tag-unknown']);
  assert.match(issues[0].message, /; use a tag from the CARD_TAGS list in CONTRIBUTING\.md$/);
});

test('tags: a repeated tag fails with tag-duplicate', () => {
  const c = clone();
  c.tags = ['keeper', 'keeper'];
  assert.deepEqual(rules(lintCard(c)), ['tag-duplicate']);
});

test('tags: four allow-listed tags fail with tag-count', () => {
  const c = clone();
  c.tags = ['keeper', 'laws', 'passing', 'composure'];
  assert.deepEqual(rules(lintCard(c)), ['tag-count']);
});

test('tags: no tags gives a deferred tags-missing issue', () => {
  const c = clone();
  c.tags = [];
  const issues = lintCard(c);
  assert.deepEqual(rules(issues), ['tags-missing']);
  assert.equal(issues[0].deferred, true);
});

test('tags: one tag and three tags pass', () => {
  const one = clone();
  one.tags = ['keeper'];
  assert.deepEqual(lintCard(one), []);
  const three = clone();
  three.tags = ['keeper', 'laws', 'passing'];
  assert.deepEqual(lintCard(three), []);
});

// ---------------------------------------------------------------- option balance

const withLengths = (lengths) => {
  const c = clone();
  lengths.forEach((n, i) => (c.options[i].text = fill(n)));
  return c;
};

test('option balance: 30/20/20 passes (exactly 1.5x)', () => {
  const c = withLengths([30, 20, 20]);
  assert.equal(optionBalance(c).ratio, 1.5);
  assert.equal(optionBalance(c).fails, false);
  assert.deepEqual(lintCard(c), []);
});

test('option balance: 31/20/20 passes (11 chars apart)', () => {
  assert.deepEqual(lintCard(withLengths([31, 20, 20])), []);
});

test('option balance: 33/20/20 gives a deferred option-balance issue', () => {
  const issues = lintCard(withLengths([33, 20, 20]));
  assert.deepEqual(rules(issues), ['option-balance']);
  assert.equal(issues[0].deferred, true);
  assert.match(issues[0].message, /lengths 33\/20\/20, longest is 1\.65x the shortest/);
});

test('option balance: 14/26/20 passes (ratio 1.86 but exactly 12 apart)', () => {
  const c = withLengths([14, 26, 20]);
  const b = optionBalance(c);
  assert.equal(b.longest - b.shortest, 12);
  assert.ok(b.ratio > MAX_OPTION_LENGTH_RATIO);
  assert.deepEqual(lintCard(c), []);
});

// ---------------------------------------------------------------- isFailure

test('isFailure: deferred issues fail only in strict mode', () => {
  const deferred = { rule: 'option-balance', path: '/options', message: '', deferred: true };
  assert.equal(isFailure(deferred, false), false);
  assert.equal(isFailure(deferred, true), true);
  assert.equal(isFailure(deferred), BALANCE_LINTS_STRICT);
});

test('isFailure: non-deferred issues always fail', () => {
  const hard = { rule: 'no-url', path: '/text', message: '', deferred: false };
  assert.equal(isFailure(hard, false), true);
  assert.equal(isFailure(hard, true), true);
});

test('BALANCE_LINTS_STRICT is on after the 2026-11 audit', () => {
  assert.equal(BALANCE_LINTS_STRICT, true);
});

// ---------------------------------------------------------------- checkFormat

test('checkFormat: canonical 2-space JSON with trailing newline passes', () => {
  assert.equal(checkFormat(JSON.stringify(clone(), null, 2) + '\n'), null);
});

test('checkFormat: 4-space indent fails', () => {
  assert.equal(checkFormat(JSON.stringify(clone(), null, 4) + '\n').rule, 'format');
});

test('checkFormat: missing trailing newline fails', () => {
  const f = checkFormat(JSON.stringify(clone(), null, 2));
  assert.equal(f.rule, 'format');
  assert.equal(f.deferred, false);
});

test('checkFormat: invalid JSON is left to the validator (null)', () => {
  assert.equal(checkFormat('{ not json'), null);
});

// ---------------------------------------------------------------- deckStats / lintDeck

/**
 * Synthetic card: best option at stored index `pos`, with option text
 * lengths chosen so best is the middle (25), longest (30) or shortest (20).
 */
function synth(i, { pos = 1, best = 'middle', role = 'outfield' } = {}) {
  const c = clone();
  c.id = `synth-${i}`;
  c.role = role;
  const bestLen = { shortest: 20, middle: 25, longest: 30 }[best];
  const others = [20, 25, 30].filter((n) => n !== bestLen);
  const [b, ok, poor] = c.options; // base order is best, ok, poor
  b.text = fill(bestLen);
  ok.text = fill(others[0]);
  poor.text = fill(others[1]);
  const rest = [ok, poor];
  c.options = [0, 1, 2].map((slot) => (slot === pos ? b : rest.shift()));
  return c;
}

const deck = (n, special, opts) =>
  Array.from({ length: n }, (_, i) => synth(i, i < special ? opts : {}));

test('deckStats counts best positions, longest, shortest and untagged', () => {
  const cards = [synth(0, { pos: 0, best: 'longest' }), synth(1, { pos: 2, best: 'shortest' }), synth(2)];
  cards[2].tags = [];
  const s = deckStats(cards);
  assert.equal(s.n, 3);
  assert.deepEqual(s.bestPositions, [1, 1, 1]);
  assert.equal(s.bestLongest, 1);
  assert.equal(s.bestShortest, 1);
  assert.equal(s.untagged, 1);
  assert.equal(s.ratioFails, 0);
  assert.equal(s.medianRatio, 1.5);
  assert.equal(s.maxRatio, 1.5);
});

test('deckStats on an empty deck returns zeros', () => {
  const s = deckStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.medianRatio, 0);
  assert.equal(s.maxRatio, 0);
});

test('deckStats counts best/poor/poor grade sets', () => {
  const c = clone();
  c.options[1].grade = 'poor';
  assert.equal(deckStats([c, clone()]).bestPoorPoor, 1);
});

test(`lintDeck: 19 best-first cards are skipped (below MIN_CARDS_FOR_DECK_LINT)`, () => {
  assert.deepEqual(lintDeck(deck(19, 19, { pos: 0 })), []);
});

test('lintDeck: best first on exactly 9 of 20 (0.45) is accepted', () => {
  assert.deepEqual(lintDeck(deck(20, 9, { pos: 0 })), []);
});

test('lintDeck: best first on 10 of 20 gives deferred deck-best-first', () => {
  const issues = lintDeck(deck(20, 10, { pos: 0 })).filter((i) => i.path === 'deck');
  assert.deepEqual(rules(issues), ['deck-best-first']);
  assert.equal(issues[0].deferred, true);
  assert.equal(issues[0].message, 'best option is first on 10/20 cards (50%; max 45%); shuffle option order');
});

test('lintDeck: best longest on 10 of 20 gives deck-best-longest', () => {
  const issues = lintDeck(deck(20, 10, { best: 'longest' })).filter((i) => i.path === 'deck');
  assert.deepEqual(rules(issues), ['deck-best-longest']);
  assert.match(issues[0].message, /^best option is the longest on 10\/20 cards \(50%; max 45%\); rebalance option lengths$/);
});

test('lintDeck: best shortest on 10 of 20 gives deck-best-shortest', () => {
  const issues = lintDeck(deck(20, 10, { best: 'shortest' })).filter((i) => i.path === 'deck');
  assert.deepEqual(rules(issues), ['deck-best-shortest']);
});

test('lintDeck: 20 outfield + 5 keeper cards report both deck and deck (outfield)', () => {
  const outfield = deck(20, 20, { pos: 0 });
  const keepers = Array.from({ length: 5 }, (_, i) => synth(100 + i, { role: 'keeper' }));
  const issues = lintDeck([...outfield, ...keepers]);
  assert.deepEqual(
    issues.map((i) => `${i.path}:${i.rule}`),
    ['deck:deck-best-first', 'deck (outfield):deck-best-first'],
  );
});

test('lintDeck: an outfield subset below 20 is skipped while the full deck is linted', () => {
  const outfield = deck(19, 19, { pos: 0 });
  const keeper = synth(200, { role: 'keeper', pos: 0 });
  const paths = lintDeck([...outfield, keeper]).map((i) => i.path);
  assert.deepEqual(paths, ['deck']);
});

// ---------------------------------------------------------------- checkRevBump

const swapOkPoor = (c) => {
  for (const o of c.options) {
    if (o.grade === 'ok') o.grade = 'poor';
    else if (o.grade === 'poor') o.grade = 'ok';
  }
  return c;
};

test('checkRevBump: identical cards pass', () => {
  assert.equal(checkRevBump(clone(), clone()), null);
});

test('checkRevBump: reordered options with the same grades pass (matched by id)', () => {
  const after = clone();
  after.options = [after.options[2], after.options[0], after.options[1]];
  assert.equal(checkRevBump(clone(), after), null);
});

test('checkRevBump: a regrade at the same rev must bump rev to 2', () => {
  const msg = checkRevBump(clone(), swapOkPoor(clone()));
  assert.equal(typeof msg, 'string');
  assert.match(msg, /bump rev to 2/);
  assert.match(msg, /^grade changed on option "kick-long-pitch" \(ok -> poor\)/);
});

test('checkRevBump: the same regrade with rev 2 passes', () => {
  const after = swapOkPoor(clone());
  after.rev = 2;
  assert.equal(checkRevBump(clone(), after), null);
});

test('checkRevBump: rev may not decrease', () => {
  const before = clone();
  before.rev = 2;
  const after = clone();
  after.rev = 1;
  assert.match(checkRevBump(before, after), /may not decrease/);
});

test('checkRevBump: a wording-only change passes', () => {
  const after = clone();
  after.options[0].why = 'Reworded but the same meaning.';
  after.text = 'New wording.';
  assert.equal(checkRevBump(clone(), after), null);
});

// ---------------------------------------------------------------- constants pinned

test('threshold constants are pinned', () => {
  assert.equal(MAX_OPTION_LENGTH_RATIO, 1.5);
  assert.equal(OPTION_LENGTH_SLACK_CHARS, 12);
  assert.equal(MAX_BEST_LONGEST_SHARE, 0.45);
  assert.equal(MAX_BEST_FIRST_SHARE, 0.45);
  assert.equal(MAX_BEST_SHORTEST_SHARE, 0.45);
  assert.equal(MIN_CARDS_FOR_DECK_LINT, 20);
  assert.deepEqual(FIELD_CAPS, { title: 40, text: 160, option: 64, why: 140, tip: 140 });
  assert.equal(MAX_WORDS_PER_SENTENCE, 20);
  assert.equal(MIN_TAGS, 1);
  assert.equal(MAX_TAGS, 3);
  assert.equal(CARD_TAGS.length, 21);
  assert.equal(new Set(CARD_TAGS).size, 21);
  assert.ok(Object.isFrozen(CARD_TAGS));
  assert.ok(Object.isFrozen(FIELD_CAPS));
});

test('CARD_TAGS are lowercase kebab-case and never a category name', () => {
  for (const t of CARD_TAGS) {
    assert.match(t, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(!['attack', 'defend', 'mindset'].includes(t));
  }
});

// ---------------------------------------------------------------- ReDoS sanity

test('URL_RE runs in well under 200 ms on a 5000-char adversarial string', () => {
  const s = 'a.'.repeat(2500);
  const t0 = performance.now();
  URL_RE.test(s);
  lintCard({ ...clone(), text: s });
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 200, `took ${elapsed.toFixed(1)} ms`);
});
