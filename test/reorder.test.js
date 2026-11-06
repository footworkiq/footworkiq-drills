// Tests for scripts/lib/reorder.js and scripts/reorder-card-options.js (D-03).
// Distribution tests read the real cards in cards/decision; CLI tests run on
// temp copies so the real deck is never rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, shuffledOptions, bestSlot, isSeededOrder } from '../scripts/lib/reorder.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CARDS_DIR = join(repoRoot, 'cards/decision');
const SCRIPT = join(repoRoot, 'scripts/reorder-card-options.js');

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

test('best slot distribution over the real deck is 26/20/26', () => {
  assert.equal(cards.length, 72);
  assert.deepEqual(slotCounts(cards), [26, 20, 26]);
});

test('best slot distribution without the keeper cards (d6, d14, d22) is 25/19/25', () => {
  const outfield = cards.filter((c) => !['d6', 'd14', 'd22'].includes(c.legacy_id));
  assert.equal(outfield.length, 69);
  assert.deepEqual(slotCounts(outfield), [25, 19, 25]);
});

test('best slot distribution per category', () => {
  const by = (cat) => slotCounts(cards.filter((c) => c.category === cat));
  assert.deepEqual(by('attack'), [13, 7, 12]);
  assert.deepEqual(by('defend'), [8, 9, 7]);
  assert.deepEqual(by('mindset'), [5, 4, 7]);
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
