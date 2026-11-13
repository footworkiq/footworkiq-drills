// Spawn-based tests for scripts/validate-drills.js over test/fixtures/drills/<case>/.
// The good directory holds lint-clean drills (2x3 and grid); each bad-* directory holds
// one drill with exactly one defect. Every rejection test asserts the reason,
// not just the exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = 'test/fixtures/drills';

function run(...args) {
  return spawnSync(process.execPath, ['scripts/validate-drills.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('good grid fixtures pass Ajv and the lints', () => {
  const r = run('--dir', join(FIXTURES, 'good'));
  assert.equal(r.status, 0, r.stderr);
  const oks = r.stdout.split('\n').filter((l) => l.startsWith('OK   '));
  assert.equal(oks.length, 4);
  assert.match(r.stdout, /All 4 drill\(s\) valid\./);
});

const BAD_CASES = {
  'bad-cell-range': /^ {2}\/\S* .+/m, // an Ajv error line: "  /instance/path message"
  'bad-ball-jump': /ball jumps/,
  'bad-ball-jump-loop': /between reps \(not adjacent\)/,
  'bad-ball-action': /use ROLL or PUSH/,
  'bad-ball-from-to': /from\/to|needs from and to/,
  'bad-feet-same-cell': /right foot shares \S+ with the left foot/,
  'bad-xy-edge': /too close to the edge/,
};

for (const [caseName, reason] of Object.entries(BAD_CASES)) {
  test(`${caseName} fails with its reason`, () => {
    const r = run('--dir', join(FIXTURES, caseName));
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /FAIL \S+\.json:/);
    assert.match(r.stderr, reason);
    assert.match(r.stderr, /1 file\(s\) failed validation\./);
  });
}

test('all live drills pass with no --dir', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All \d+ drill\(s\) valid\./);
});
