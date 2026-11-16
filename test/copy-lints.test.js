// Unit tests for scripts/lib/copy-lints.js. Run with `npm test`.
//
// The flag/pass vectors come from docs/schema/copy-rules.json, the byte copy
// of the app's file, and the app runs the same vectors, so the two matchers
// cannot drift apart (app Phase 47 D-09). The live-content tests keep every
// current card and drill clean and the allow-list free of stale entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import {
  COPY_ALLOWLIST,
  COPY_RULES,
  compileRules,
  findPhrases,
  lintCardCopy,
  lintDrillCopy,
} from '../scripts/lib/copy-lints.js';

const compiled = compileRules(COPY_RULES.phrases);

const readDir = (dir) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      data: JSON.parse(readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8')),
    }));

const cards = readDir('cards/decision');
const drills = readDir('drills');

test('rules file has phrases and both vector lists', () => {
  assert.ok(COPY_RULES.phrases.length > 0);
  assert.ok(COPY_RULES.vectors.flag.length > 0);
  assert.ok(COPY_RULES.vectors.pass.length > 0);
});

test('every flag vector flags', () => {
  for (const s of COPY_RULES.vectors.flag) {
    assert.ok(findPhrases(s, compiled).length > 0, `expected a flag: ${s}`);
  }
});

test('every pass vector passes', () => {
  for (const s of COPY_RULES.vectors.pass) {
    assert.deepEqual(findPhrases(s, compiled), [], `expected a pass: ${s}`);
  }
});

test('matching is case-insensitive and word-bounded', () => {
  assert.deepEqual(findPhrases('BOOST your game', compiled), ['boost']);
  assert.deepEqual(findPhrases('a boosted shot', compiled), []);
  assert.deepEqual(findPhrases('FootworkIQ', compiled), []);
});

test('a space or hyphen in a phrase matches either', () => {
  assert.deepEqual(findPhrases('Reaction-time drills', compiled), ['reaction time']);
  assert.deepEqual(findPhrases('reaction  time', compiled), ['reaction time']);
  assert.deepEqual(findPhrases('Science backed', compiled), ['science-backed']);
});

test('a card with why "Boost your brain" gives two copy-claim issues', () => {
  const card = {
    title: 'Test',
    text: 'A situation.',
    options: [{ id: 'a', text: 'Pass it', grade: 'best', why: 'Boost your brain' }],
  };
  const issues = lintCardCopy(card);
  assert.equal(issues.length, 2);
  for (const issue of issues) {
    assert.equal(issue.rule, 'copy-claim');
    assert.equal(issue.field, 'options[0].why');
  }
  assert.deepEqual(issues.map((i) => i.phrase).sort(), ['boost', 'brain']);
});

test('card scan.prompt, title and tip are checked', () => {
  const issues = lintCardCopy({ title: 'Get smarter', tip: 'Proven', scan: { prompt: 'Sharpen up' } });
  assert.deepEqual(issues.map((i) => i.field), ['title', 'tip', 'scan.prompt']);
});

test('drill name, description and tags are checked', () => {
  const issues = lintDrillCopy({
    metadata: { name: 'Boost drill', description: 'Train your brain', tags: ['cognitive'] },
  });
  assert.deepEqual(issues.map((i) => i.field), ['metadata.name', 'metadata.description', 'metadata.tags[0]']);
});

test('an allow-listed string is skipped only on an exact match', () => {
  const text = COPY_ALLOWLIST[0].text;
  assert.deepEqual(lintCardCopy({ options: [{ why: text }] }), []);
  assert.equal(lintCardCopy({ options: [{ why: `${text} ` }] }).length, 1);
});

test('every real card has zero copy-claim issues', () => {
  assert.ok(cards.length > 0);
  for (const { file, data } of cards) assert.deepEqual(lintCardCopy(data), [], file);
});

test('every real drill has zero copy-claim issues', () => {
  assert.ok(drills.length > 0);
  for (const { file, data } of drills) assert.deepEqual(lintDrillCopy(data), [], file);
});

test('every allow-list entry has a reason, is still needed and is used by a real card', () => {
  const cardStrings = new Set();
  for (const { data } of cards) {
    for (const s of [data.title, data.text, data.tip, ...(data.options ?? []).flatMap((o) => [o.text, o.why])]) {
      cardStrings.add(s);
    }
  }
  for (const entry of COPY_ALLOWLIST) {
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.trim().length > 0, `empty reason for: ${entry.text}`);
    assert.ok(findPhrases(entry.text, compiled).length > 0, `entry no longer needs an exception: ${entry.text}`);
    assert.ok(cardStrings.has(entry.text), `stale allow-list entry: ${entry.text}`);
  }
});
