// Unit tests for scripts/lib/drill-lints.js. Run with `npm test`.
//
// Fixtures live in test/fixtures/drills/<case>/. `good/` holds four
// lint-clean drills (2x3, 3x3, 3x4 and a 4x4 with {x, y} positions), byte
// copies of live drills. Every bad-* directory holds one of those drills with
// exactly one defect, and the directory name says what is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  BALL_MOVE_ACTIONS,
  FEET_EXEMPT_ACTIONS,
  SOLE_ACTIONS,
  TOUCH_ACTIONS,
  lintDrill,
} from '../scripts/lib/drill-lints.js';

const fixture = (dir, file) =>
  JSON.parse(readFileSync(new URL(`./fixtures/drills/${dir}/${file}`, import.meta.url), 'utf8'));

const GOOD = ['2x3-pull-push.json', '3x3-box-roll.json', '3x4-wide-cut-and-turn.json', '4x4-diagonal-xy.json'];

const rules = (issues) => issues.map((i) => i.rule);

const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
const schema = JSON.parse(
  readFileSync(new URL('../docs/schema/drill.schema.json', import.meta.url), 'utf8'),
);
delete schema['$schema'];
const validate = ajv.compile(schema);

// ---------------------------------------------------------------- constants

test('exempt and move action lists are frozen and exact', () => {
  assert.deepEqual([...FEET_EXEMPT_ACTIONS], ['TAP', 'STEP_OVER', 'LIFT']);
  assert.deepEqual([...BALL_MOVE_ACTIONS], ['ROLL', 'PUSH']);
  assert.ok(Object.isFrozen(FEET_EXEMPT_ACTIONS));
  assert.ok(Object.isFrozen(BALL_MOVE_ACTIONS));
  assert.deepEqual([...TOUCH_ACTIONS], ['INSIDE_TOUCH', 'OUTSIDE_TOUCH', 'SOLE_ROLL', 'TAP', 'DRAG', 'LIFT']);
  assert.deepEqual([...SOLE_ACTIONS], ['SOLE_ROLL', 'DRAG']);
  assert.ok(Object.isFrozen(TOUCH_ACTIONS));
  assert.ok(Object.isFrozen(SOLE_ACTIONS));
});

// ---------------------------------------------------------------- good drills

for (const file of GOOD) {
  test(`good/${file} passes the schema and has no lint issues`, () => {
    const d = fixture('good', file);
    assert.equal(validate(d), true, JSON.stringify(validate.errors));
    assert.deepEqual(lintDrill(d), []);
  });
}

test('good/4x4-diagonal-xy.json exercises an {x, y} position', () => {
  const d = fixture('good', '4x4-diagonal-xy.json');
  assert.ok(d.sequence.some((b) => b.left_foot && 'x' in b.left_foot.pos));
});

test('every live drill in drills/ has no lint issues (D-01, D-02)', () => {
  const dir = new URL('../drills/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(lintDrill(d), [], f);
  }
});

const ZONE_SKIP = {
  schema: '1.0',
  metadata: {
    id: 'zone-skip',
    name: 'Zone Skip',
    contributor: 'FootworkIQ',
    difficulty: 'Beginner',
    default_bpm: 80,
    tags: ['test'],
    license: 'CC0',
  },
  sequence: [
    { beat: 1, left_foot: { pos: 2, action: 'PLANT' }, right_foot: { pos: 6, action: 'PLANT' }, ball: { pos: 3, action: 'STILL' } },
    { beat: 2, left_foot: { pos: 2, action: 'PLANT' }, right_foot: { pos: 2, action: 'PLANT' }, ball: { pos: 5, action: 'STILL' } },
  ],
};

// 2x3 is linted like every other grid (D-02): the old 2x3 skip is gone.
test('a 2x3 drill whose ball skips a zone is linted (absent grid)', () => {
  assert.equal(validate(ZONE_SKIP), true, JSON.stringify(validate.errors));
  const issues = lintDrill(ZONE_SKIP);
  assert.ok(issues.some((i) => i.rule === 'ball-jump' && i.message === 'beat 2: ball jumps A2 → C2 (not adjacent)'));
  assert.ok(issues.some((i) => i.rule === 'feet-same-cell' && i.message === 'beat 2: right foot shares A1 with the left foot'));
});

test("a drill with grid '2x3' is linted", () => {
  const d = JSON.parse(JSON.stringify(ZONE_SKIP));
  d.metadata.grid = '2x3';
  assert.deepEqual(lintDrill(d), lintDrill(ZONE_SKIP));
  assert.ok(rules(lintDrill(d)).includes('ball-jump'));
  assert.ok(rules(lintDrill(d)).includes('feet-same-cell'));
});

test('a 2x3 ROLL without from/to is not reported (ball-from-to is grid-only, D-22)', () => {
  const d = fixture('good', '2x3-pull-push.json');
  delete d.sequence[3].ball.from;
  delete d.sequence[3].ball.to;
  assert.equal(d.sequence[3].ball.action, 'ROLL');
  assert.deepEqual(lintDrill(d), []);
});

// ---------------------------------------------------------------- bad drills

const BAD = [
  {
    dir: 'bad-ball-jump',
    file: '3x4-wide-cut-and-turn.json',
    issues: [{ rule: 'ball-jump', beat: 4, marker: 'ball', message: 'beat 4: ball jumps D1 → B2 (not adjacent)' }],
  },
  {
    // The last ball beat is B3, so the loop back to B1 jumps. Moving the last
    // ball to B3 is itself a jump from beat 7's B1, so both are reported.
    dir: 'bad-ball-jump-loop',
    file: '3x4-wide-cut-and-turn.json',
    issues: [
      { rule: 'ball-jump', beat: 1, marker: 'ball', message: 'loop: ball jumps B3 → B1 between reps (not adjacent)' },
      { rule: 'ball-jump', beat: 8, marker: 'ball', message: 'beat 8: ball jumps B1 → B3 (not adjacent)' },
    ],
  },
  {
    dir: 'bad-ball-action',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'ball-action', beat: 2, marker: 'ball', message: 'beat 2: ball moves B1 → B2 with STILL; use ROLL or PUSH' },
    ],
  },
  {
    dir: 'bad-ball-from-to',
    file: '3x3-box-roll.json',
    issues: [{ rule: 'ball-from-to', beat: 2, marker: 'ball', message: 'beat 2: ball ROLL from/to must be B1 → B2' }],
  },
  {
    dir: 'bad-feet-same-cell',
    file: '3x4-wide-cut-and-turn.json',
    issues: [
      { rule: 'feet-same-cell', beat: 5, marker: 'right foot', message: 'beat 5: right foot shares B2 with the left foot' },
    ],
  },
  {
    dir: 'bad-xy-edge',
    file: '4x4-diagonal-xy.json',
    issues: [
      {
        rule: 'xy-edge',
        beat: 1,
        marker: 'left foot',
        message:
          'beat 1: left foot at x 0.030, y 0.850 is too close to the edge (keep x between 0.063 and 0.937, y between 0.094 and 0.906)',
      },
    ],
  },
  {
    dir: 'bad-cell-range',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'cell-range', beat: 7, marker: 'left foot', message: 'beat 7: left foot cell row 1 col 4 is outside the 3×3 mat' },
    ],
  },
];

for (const c of BAD) {
  test(`${c.dir}/${c.file} reports exactly ${c.issues.map((i) => i.rule).join(', ')}`, () => {
    assert.deepEqual(lintDrill(fixture(c.dir, c.file)), c.issues);
  });
}

test('every bad fixture except bad-cell-range passes the schema', () => {
  for (const c of BAD) {
    const ok = validate(fixture(c.dir, c.file));
    assert.equal(ok, c.dir !== 'bad-cell-range', c.dir);
  }
});

test('the loop message has the agreed prefix and suffix', () => {
  const [i] = lintDrill(fixture('bad-ball-jump-loop', '3x4-wide-cut-and-turn.json'));
  assert.ok(i.message.startsWith('loop: ball jumps '));
  assert.ok(i.message.endsWith(' between reps (not adjacent)'));
});

test('the loop wrap is checked when beat 1 has no ball (WR-04)', () => {
  // No ball on beat 1; the first authored ball is C1 on beat 2 and the last
  // is B3 on beat 8. B3 -> C1 between reps is not adjacent and must be
  // reported against beat 2. The schema already rejects a grid drill whose
  // ball is missing on beat 1, and both validate-drills and generate run the
  // schema first, so this is defence in depth: lintDrill must not depend on
  // that ordering.
  const d = fixture('bad-ball-jump-loop', '3x4-wide-cut-and-turn.json');
  delete d.sequence[0].ball;
  assert.equal(validate(d), false);
  assert.deepEqual(lintDrill(d), [
    { rule: 'ball-jump', beat: 2, marker: 'ball', message: 'loop: ball jumps B3 → C1 between reps (not adjacent)' },
    { rule: 'ball-jump', beat: 8, marker: 'ball', message: 'beat 8: ball jumps B1 → B3 (not adjacent)' },
  ]);
});

test('the loop wrap passes when beat 1 has no ball and the wrap is adjacent', () => {
  const d = fixture('good', '3x4-wide-cut-and-turn.json');
  delete d.sequence[0].ball;
  // First ball is now C1 (beat 2); last is B1, which is adjacent.
  assert.deepEqual(lintDrill(d), []);
});

// ---------------------------------------------------------------- feet exemption (D-03)

for (const action of ['TAP', 'STEP_OVER', 'LIFT']) {
  for (const side of ['left_foot', 'right_foot']) {
    test(`feet sharing a cell are fine when the ${side.replace('_', ' ')} does ${action}`, () => {
      const d = fixture('bad-feet-same-cell', '3x4-wide-cut-and-turn.json');
      d.sequence[4][side].action = action;
      assert.equal(validate(d), true);
      // The right foot DRAGs the ball C2 -> B2 on beat 5. A STEP_OVER is a
      // feint, not a touch, so relabelling it leaves the move untouched.
      const expected = side === 'right_foot' && action === 'STEP_OVER' ? ['ball-no-touch'] : [];
      assert.deepEqual(rules(lintDrill(d)), expected);
    });
  }
}

test('feet sharing a cell are compared by cell for {x, y} positions', () => {
  const d = fixture('good', '3x4-wide-cut-and-turn.json');
  // (0.4, 0.52) is nearest B2, where the right foot DRAGs the ball on beat 5.
  d.sequence[4].left_foot.pos = { x: 0.4, y: 0.52 };
  assert.deepEqual(lintDrill(d), [
    { rule: 'feet-same-cell', beat: 5, marker: 'right foot', message: 'beat 5: right foot shares B2 with the left foot' },
  ]);
});

// ---------------------------------------------------------------- ball details

test('a ROLL with no from/to is reported, even on beat 1', () => {
  const d = fixture('good', '3x3-box-roll.json');
  d.sequence[0].ball = { pos: { row: 1, col: 2 }, action: 'ROLL' };
  assert.deepEqual(lintDrill(d), [
    { rule: 'ball-from-to', beat: 1, marker: 'ball', message: 'beat 1: ball ROLL needs from and to' },
  ]);
});

test('a beat-1 PUSH whose from and to are not adjacent is reported', () => {
  const d = fixture('good', '3x4-wide-cut-and-turn.json');
  d.sequence[0].ball = { pos: { row: 1, col: 2 }, action: 'PUSH', from: { row: 1, col: 4 }, to: { row: 1, col: 2 } };
  assert.deepEqual(lintDrill(d), [
    { rule: 'ball-from-to', beat: 1, marker: 'ball', message: 'beat 1: ball PUSH from D1 to B1 (not adjacent)' },
  ]);
});

test('a ball that stays put with STILL is fine', () => {
  const d = fixture('good', '3x3-box-roll.json');
  d.sequence.push({ beat: 9, ball: { pos: { row: 1, col: 2 }, action: 'STILL' } });
  assert.deepEqual(lintDrill(d), []);
});

test('an {x, y} ball too near the bottom edge uses the ball insets', () => {
  const d = fixture('good', '3x3-box-roll.json');
  // Beat 8's ball is a STILL in B1; (0.5, 0.95) still snaps to B1.
  d.sequence[7].ball = { pos: { x: 0.5, y: 0.95 }, action: 'STILL' };
  const issues = lintDrill(d);
  assert.deepEqual(rules(issues), ['xy-edge']);
  assert.equal(issues[0].marker, 'ball');
  assert.match(issues[0].message, /^beat 8: ball at x 0\.500, y 0\.950 is too close to the edge/);
});
