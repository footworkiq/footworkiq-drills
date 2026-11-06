// Spawn-based tests for scripts/validate-cards.js over test/fixtures/cards/<case>/.
// Each fixture directory holds one back-pass.json that is the `good` card plus
// exactly one defect. Lint fixtures stay schema-valid apart from that defect,
// and every rejection test asserts the reason, not just the exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BALANCE_LINTS_STRICT } from '../scripts/lib/card-lints.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = 'test/fixtures/cards';
const EMPTY_RETIRED = 'test/fixtures/empty-retired.json';

function run(caseName, ...extra) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-cards.js', '--dir', join(FIXTURES, caseName), '--retired', EMPTY_RETIRED, ...extra],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

const SCHEMA_CASES = {
  'two-best': '/options',
  'no-best': '/options',
  'coord-x-out-of-bounds': '/scene/you/x',
  'coord-y-out-of-bounds': '/scene/ball/y',
  'missing-age-band': 'age_band',
  'bad-age-band': 'age_band',
  'missing-role': 'role',
  'bad-role': 'role',
};

const LINT_CASES = {
  'url-in-why': 'no-url',
  'www-in-text': 'no-url',
  'bare-domain-in-tip': 'no-url',
  'option-too-long': 'field-cap',
  'long-sentence': 'sentence-length',
  'unknown-tag': 'tag-unknown',
  'duplicate-tag': 'tag-duplicate',
  'too-many-tags': 'tag-count',
  misformatted: 'format',
};

const DEFERRED_CASES = {
  'unbalanced-options': 'option-balance',
  'no-tags': 'tags-missing',
};

const ALL_CASES = ['good', ...Object.keys(SCHEMA_CASES), ...Object.keys(LINT_CASES), ...Object.keys(DEFERRED_CASES)];

test('fixture guard: every case directory exists and holds exactly back-pass.json', () => {
  assert.ok(ALL_CASES.length >= 20, `expected at least 20 cases, got ${ALL_CASES.length}`);
  for (const name of ALL_CASES) {
    const dir = join(repoRoot, FIXTURES, name);
    assert.ok(existsSync(dir), `missing fixture directory ${name}`);
    assert.deepEqual(readdirSync(dir), ['back-pass.json'], `${name} must hold exactly back-pass.json`);
  }
  const onDisk = readdirSync(join(repoRoot, FIXTURES)).sort();
  assert.deepEqual(onDisk, [...ALL_CASES].sort(), 'every fixture directory must have a test');
});

test('good: passes in default mode', () => {
  const r = run('good');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK {3}back-pass\.json/);
});

test('good: passes with --strict-balance', () => {
  const r = run('good', '--strict-balance');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK {3}back-pass\.json/);
});

for (const [name, needle] of Object.entries(SCHEMA_CASES)) {
  test(`schema: ${name} is rejected (${needle})`, () => {
    const r = run(name);
    assert.equal(r.status, 1, r.stdout);
    assert.ok(r.stderr.includes('FAIL back-pass.json:'), r.stderr);
    assert.ok(r.stderr.includes(needle), `expected ${needle} in stderr:\n${r.stderr}`);
  });
}

for (const [name, rule] of Object.entries(LINT_CASES)) {
  test(`lint: ${name} is rejected [${rule}]`, () => {
    const r = run(name);
    assert.equal(r.status, 1, r.stdout);
    assert.ok(r.stderr.includes(`FAIL back-pass.json: [${rule}]`), r.stderr);
    assert.ok(!r.stdout.includes('OK   back-pass.json'), r.stdout);
  });
}

for (const [name, rule] of Object.entries(DEFERRED_CASES)) {
  test(`deferred: ${name} follows BALANCE_LINTS_STRICT in default mode [${rule}]`, () => {
    const r = run(name);
    assert.equal(r.status, BALANCE_LINTS_STRICT ? 1 : 0, r.stderr);
    const prefix = BALANCE_LINTS_STRICT ? 'FAIL' : 'WARN';
    assert.ok(r.stderr.includes(`${prefix} back-pass.json: [${rule}]`), r.stderr);
  });

  test(`deferred: ${name} fails with --strict-balance [${rule}]`, () => {
    const r = run(name, '--strict-balance');
    assert.equal(r.status, 1, r.stdout);
    assert.ok(r.stderr.includes(`FAIL back-pass.json: [${rule}]`), r.stderr);
  });
}

test('real deck: cards/decision passes in default mode', () => {
  const r = spawnSync(process.execPath, ['scripts/validate-cards.js', '--dir', 'cards/decision'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All \d+ card\(s\) valid \(\d+ warning\(s\)\)\./);
});
