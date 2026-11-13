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
  'bad-ball-no-touch': /but no foot on or next to it touches it/,
  'bad-ball-push-wait': /after a PUSH before a foot reaches it/,
  'bad-sole-on-ball': /(SOLE_ROLL|DRAG) in \S+ but the ball is in/,
  'bad-sole-start': /rolls the ball \S+ → \S+ but started in/,
  'bad-foot-step': /\(more than one square\)/,
  'bad-plant-moves': /is PLANT in \S+ but moves to/,
  'bad-feet-apart': /squares from the left foot/,
  'bad-feet-crossed': /is left of the left foot/,
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

// ROADMAP SC1: a 2x3 drill whose ball and feet disagree fails CI, and the
// output names the drill (FAIL line), the beat and the foot.
test('the bad-plant-moves failure names the drill, the beat and the foot', () => {
  const r = run('--dir', join(FIXTURES, `bad-plant-moves`));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /FAIL \S*2x3-pull-push\.json:/);
  assert.match(r.stderr, /beat \d+: (left|right) foot/);
  assert.match(r.stderr, /beat 2: right foot is PLANT in B1 but moves to B2 next beat/);
});

test('all live drills pass with no --dir', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All \d+ drill\(s\) valid\./);
});
