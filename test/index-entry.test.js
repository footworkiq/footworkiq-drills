// Tests for scripts/lib/index-entry.js: index.json keeps today's bytes for
// 2x3 / schema 1.0 drills and only appends grid/schema for new grids (D-06, D-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildIndexEntry } from '../scripts/lib/index-entry.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const BASE_META = {
  id: 'a-drill',
  name: 'A Drill',
  contributor: 'Someone',
  difficulty: 'Beginner',
  default_bpm: 90,
  tags: ['rhythm'],
  time_signature: '4/4',
  count_in: 2,
  loop_count: 4,
};
const BASE_KEYS = ['id', 'name', 'contributor', 'difficulty', 'default_bpm', 'tags'];

test('a 2x3 drill with no grid keeps exactly the whitelist keys', () => {
  const e = buildIndexEntry({ schema: '1.0', metadata: { ...BASE_META }, sequence: [] });
  assert.deepEqual(Object.keys(e), BASE_KEYS);
});

test('description is included only when present, in its usual place', () => {
  const e = buildIndexEntry({ metadata: { ...BASE_META, description: 'Hi.' } });
  assert.deepEqual(Object.keys(e), [...BASE_KEYS, 'description']);
  assert.equal(e.description, 'Hi.');
});

test("explicit grid '2x3' and schema '1.0' add no keys", () => {
  const e = buildIndexEntry({ schema: '1.0', metadata: { ...BASE_META, grid: '2x3' } });
  assert.deepEqual(Object.keys(e), BASE_KEYS);
  assert.equal('grid' in e, false);
  assert.equal('schema' in e, false);
});

test('a 3x3 schema 1.1 drill appends grid then schema after the existing keys', () => {
  const e = buildIndexEntry({
    schema: '1.1',
    metadata: { ...BASE_META, description: 'D.', grid: '3x3' },
  });
  assert.deepEqual(Object.keys(e), [...BASE_KEYS, 'description', 'grid', 'schema']);
  assert.equal(e.grid, '3x3');
  assert.equal(e.schema, '1.1');
});

test('the good 3x3 fixture yields grid 3x3 and schema 1.1', () => {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'test/fixtures/drills/good/3x3-box-roll.json'), 'utf8'),
  );
  const e = buildIndexEntry(raw);
  assert.equal(e.grid, '3x3');
  assert.equal(e.schema, '1.1');
});

test('rebuilding drills/ reproduces the committed index.json byte for byte', () => {
  const drillsDir = join(repoRoot, 'drills');
  const index = readdirSync(drillsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(drillsDir, f), 'utf8')))
    .filter((raw) => raw?.metadata?.id)
    .map(buildIndexEntry);
  const built = JSON.stringify(index, null, 2) + '\n';
  assert.equal(built, readFileSync(join(repoRoot, 'index.json'), 'utf8'));
});
