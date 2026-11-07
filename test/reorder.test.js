// Tests for scripts/lib/reorder.js and scripts/reorder-card-options.js (D-03).
// Tests that read the real cards in cards/decision assert invariants only
// (seeded order, best-first share, no deck-lint failures), never a deck size
// or a slot-count snapshot, so adding or retiring a card can't break them.
// The audit snapshot numbers live in docs/cards/AUDIT-2026-11.md.
// CLI, growth and retirement tests run on temp copies so the real deck is
// never rewritten. No test may assume a deck size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, shuffledOptions, bestSlot, isSeededOrder } from '../scripts/lib/reorder.js';
import {
  MAX_BEST_FIRST_SHARE,
  MIN_CARDS_FOR_DECK_LINT,
  lintDeck,
  isFailure,
} from '../scripts/lib/card-lints.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CARDS_DIR = join(repoRoot, 'cards/decision');
const RETIRED = join(repoRoot, 'cards/decision.retired.json');
const SCRIPT = join(repoRoot, 'scripts/reorder-card-options.js');
const VALIDATOR = join(repoRoot, 'scripts/validate-cards.js');
const FIXTURE = join(repoRoot, 'test/fixtures/cards/good/back-pass.json');

const cardFiles = readdirSync(CARDS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
const cards = cardFiles.map((f) => JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8')));

function slotCounts(list) {
  const counts = [0, 0, 0];
  for (const c of list) counts[bestSlot(c.id)]++;
  return counts;
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

function validate(...args) {
  return spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

function loadDeck(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/**
 * Invariants that hold for any deck size. The thresholds come from
 * scripts/lib/card-lints.js, so these tests are exactly as strict as the
 * validator and can't drift from it.
 */
function assertDeckInvariants(list, label) {
  const total = slotCounts(list);
  assert.equal(
    total[0] + total[1] + total[2],
    list.length,
    `${label}: slot counts ${JSON.stringify(total)} don't sum to ${list.length}`,
  );
  const subsets = [
    ['all', list],
    ['outfield', list.filter((c) => c.role === 'outfield')],
  ];
  for (const [name, subset] of subsets) {
    const n = subset.length;
    if (n < MIN_CARDS_FOR_DECK_LINT) continue;
    const counts = slotCounts(subset);
    assert.ok(
      counts[0] / n <= MAX_BEST_FIRST_SHARE,
      `${label} (${name}): best is first on ${counts[0]}/${n} cards (max ${MAX_BEST_FIRST_SHARE})`,
    );
  }
  assert.deepEqual(
    lintDeck(list).filter((i) => isFailure(i)),
    [],
    `${label}: deck lints fail`,
  );
}

const opt = (id, grade) => ({ id, text: id, grade, why: id });

test('canonical orders best, ok, poor and breaks ties by id', () => {
  const opts = [opt('z-poor', 'poor'), opt('b-poor', 'poor'), opt('m-ok', 'ok'), opt('q-best', 'best')];
  assert.deepEqual(
    canonical(opts).map((o) => o.id),
    ['q-best', 'm-ok', 'b-poor', 'z-poor'],
  );
  // Does not mutate its input.
  assert.equal(opts[0].id, 'z-poor');
});

test('shuffledOptions returns the same objects and is idempotent', () => {
  for (const c of cards) {
    const once = shuffledOptions(c);
    for (const o of once) assert.ok(c.options.includes(o), `${c.id}: option object was copied`);
    const twice = shuffledOptions({ ...c, options: once });
    assert.deepEqual(
      twice.map((o) => o.id),
      once.map((o) => o.id),
      `${c.id}: second shuffle changed the order`,
    );
    assert.equal(isSeededOrder({ ...c, options: once }), true);
    assert.equal(once[bestSlot(c.id)].grade, 'best');
  }
});

test('every real card is stored in seeded order', () => {
  for (const [i, card] of cards.entries()) {
    assert.ok(
      isSeededOrder(card),
      `cards/decision/${cardFiles[i]} is not in seeded order. Run: node scripts/reorder-card-options.js`,
    );
  }
});

test('live deck satisfies the deck invariants at any size', () => {
  assertDeckInvariants(cards, 'cards/decision');
});

test('bestSlot spreads synthetic ids across all three slots', () => {
  const counts = [0, 0, 0];
  for (let i = 0; i < 600; i++) counts[bestSlot(`synthetic-card-${i}`)]++;
  for (const [slot, n] of counts.entries()) {
    assert.ok(n >= 150 && n <= 252, `slot ${slot} got ${n}/600 (want 150..252): ${JSON.stringify(counts)}`);
  }
});

test('a deck with one extra valid card passes reorder, the validator and the deck invariants', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-growth-'));
  try {
    for (const f of cardFiles) copyFileSync(join(CARDS_DIR, f), join(dir, f));
    // A keeper card (role !== 'outfield') with a fresh id and no legacy_id,
    // because the fixture's legacy_id is already used by the live deck.
    const card = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    card.id = 'deck-growth-test-card';
    delete card.legacy_id;
    const seeded = shuffledOptions(card);
    card.options = [...seeded.slice(1), seeded[0]];
    assert.equal(isSeededOrder(card), false);
    writeFileSync(join(dir, `${card.id}.json`), JSON.stringify(card, null, 2) + '\n');

    let r = run('--dir', dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`written 1, unchanged ${cards.length}\\b`));

    r = run('--dir', dir, '--check');
    assert.equal(r.status, 0, r.stdout + r.stderr);

    r = validate('--dir', dir, '--retired', RETIRED);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(
      r.stdout.includes(`All ${cards.length + 1} card(s) valid (0 warning(s)).`),
      r.stdout + r.stderr,
    );

    assertDeckInvariants(loadDeck(dir), 'deck + 1 card');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deck with one retired card passes the validator and the deck invariants', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-retire-'));
  try {
    const [gone, ...kept] = cardFiles;
    const goneId = JSON.parse(readFileSync(join(CARDS_DIR, gone), 'utf8')).id;
    const cardsDir = join(dir, 'decision');
    const retiredPath = join(dir, 'decision.retired.json');
    mkdirSync(cardsDir);
    for (const f of kept) copyFileSync(join(CARDS_DIR, f), join(cardsDir, f));
    const retired = JSON.parse(readFileSync(RETIRED, 'utf8'));
    writeFileSync(retiredPath, JSON.stringify([...retired, goneId], null, 2) + '\n');

    const r = validate('--dir', cardsDir, '--retired', retiredPath);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`All ${cards.length - 1} card(s) valid`), r.stdout + r.stderr);

    assertDeckInvariants(loadDeck(cardsDir), 'deck - 1 card');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regrading a non-best option never moves best', () => {
  for (const c of cards) {
    const before = shuffledOptions(c).findIndex((o) => o.grade === 'best');
    for (const [from, to] of [
      ['ok', 'poor'],
      ['poor', 'ok'],
    ]) {
      const idx = c.options.findIndex((o) => o.grade === from);
      if (idx === -1) continue;
      const regraded = {
        ...c,
        options: c.options.map((o, i) => (i === idx ? { ...o, grade: to } : o)),
      };
      const after = shuffledOptions(regraded).findIndex((o) => o.grade === 'best');
      assert.equal(after, before, `${c.id}: ${from} -> ${to} moved best`);
      assert.equal(after, bestSlot(c.id));
    }
  }
});

test('CLI: --check, write, idempotent rewrite, category filter, bad category', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reorder-'));
  try {
    // Three real attack cards, each written with its seeded order rotated by
    // one so the copies are out of order even after the real deck is reordered.
    const picked = cards.filter((c) => c.category === 'attack').slice(0, 3);
    assert.equal(picked.length, 3);
    for (const c of picked) {
      const seeded = shuffledOptions(c);
      const rotated = { ...c, options: [...seeded.slice(1), seeded[0]] };
      assert.equal(isSeededOrder(rotated), false);
      writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(rotated, null, 2) + '\n');
    }

    let r = run('--dir', dir, '--check');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /options not in seeded order/);

    r = run('--dir', dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Reordered 3 card\(s\) \(written 3, unchanged 0\)\./);

    r = run('--dir', dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /written 0, unchanged 3/);

    r = run('--dir', dir, '--check');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /All 3 card\(s\) in seeded order\./);

    for (const f of readdirSync(dir)) {
      const t = readFileSync(join(dir, f), 'utf8');
      assert.equal(t, JSON.stringify(JSON.parse(t), null, 2) + '\n', `${f} is not canonically formatted`);
    }

    r = run('--dir', dir, '--category', 'defend');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Reordered 0 card\(s\)/);

    r = run('--dir', dir, '--category', 'keeper');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown --category keeper \(use attack, defend or mindset\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
