// Unit tests for scripts/lib/drill-lints.js. Run with `npm test`.
//
// Fixtures live in test/fixtures/drills/<case>/. `good/` holds three
// lint-clean grid drills; every bad-* directory holds one of those drills with
// exactly one defect, and the directory name says what is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { BALL_MOVE_ACTIONS, FEET_EXEMPT_ACTIONS, lintDrill } from '../scripts/lib/drill-lints.js';

const fixture = (dir, file) =>
  JSON.parse(readFileSync(new URL(`./fixtures/drills/${dir}/${file}`, import.meta.url), 'utf8'));

const GOOD = ['3x3-box-roll.json', '3x4-wide-push.json', '4x4-diagonal-xy.json'];

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

test('every live 2x3 drill in drills/ has no lint issues (D-01)', () => {
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

test('a 2x3 drill whose ball skips a zone is not linted (absent grid)', () => {
  assert.equal(validate(ZONE_SKIP), true, JSON.stringify(validate.errors));
  assert.deepEqual(lintDrill(ZONE_SKIP), []);
});

test("a drill with grid '2x3' is not linted", () => {
  const d = JSON.parse(JSON.stringify(ZONE_SKIP));
  d.metadata.grid = '2x3';
  assert.deepEqual(lintDrill(d), []);
});

// ---------------------------------------------------------------- bad drills

const BAD = [
  {
    dir: 'bad-ball-jump',
    file: '4x4-diagonal-xy.json',
    issues: [{ rule: 'ball-jump', beat: 4, marker: 'ball', message: 'beat 4: ball jumps C2 → C4 (not adjacent)' }],
  },
  {
    dir: 'bad-ball-jump-loop',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'ball-jump', beat: 1, marker: 'ball', message: 'loop: ball jumps B3 → B1 between reps (not adjacent)' },
    ],
  },
  {
    dir: 'bad-ball-action',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'ball-action', beat: 2, marker: 'ball', message: 'beat 2: ball moves B1 → C2 with STILL; use ROLL or PUSH' },
    ],
  },
  {
    dir: 'bad-ball-from-to',
    file: '3x4-wide-push.json',
    issues: [{ rule: 'ball-from-to', beat: 2, marker: 'ball', message: 'beat 2: ball PUSH from/to must be B1 → C1' }],
  },
  {
    dir: 'bad-feet-same-cell',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'feet-same-cell', beat: 7, marker: 'right foot', message: 'beat 7: left and right foot both in A1' },
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
          'beat 1: left foot at x 0.030, y 0.550 is too close to the edge (keep x between 0.063 and 0.937, y between 0.094 and 0.906)',
      },
    ],
  },
  {
    dir: 'bad-cell-range',
    file: '3x3-box-roll.json',
    issues: [
      { rule: 'cell-range', beat: 3, marker: 'right foot', message: 'beat 3: right foot cell row 4 col 3 is outside the 3×3 mat' },
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
  const [i] = lintDrill(fixture('bad-ball-jump-loop', '3x3-box-roll.json'));
  assert.ok(i.message.startsWith('loop: ball jumps '));
  assert.ok(i.message.endsWith(' between reps (not adjacent)'));
});

// ---------------------------------------------------------------- feet exemption (D-03)

for (const action of ['TAP', 'STEP_OVER', 'LIFT']) {
  for (const side of ['left_foot', 'right_foot']) {
    test(`feet sharing a cell are fine when the ${side.replace('_', ' ')} does ${action}`, () => {
      const d = fixture('bad-feet-same-cell', '3x3-box-roll.json');
      d.sequence[6][side].action = action;
      assert.equal(validate(d), true);
      assert.deepEqual(lintDrill(d), []);
    });
  }
}

test('feet sharing a cell are compared by cell for {x, y} positions', () => {
  const d = fixture('good', '3x3-box-roll.json');
  // (0.2, 0.75) is nearest A1, where the left foot is planted on beat 7.
  d.sequence[6].right_foot = { pos: { x: 0.2, y: 0.75 }, action: 'PLANT' };
  assert.deepEqual(rules(lintDrill(d)), ['feet-same-cell']);
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
  const d = fixture('good', '3x4-wide-push.json');
  d.sequence[0].ball = { pos: { row: 1, col: 2 }, action: 'PUSH', from: { row: 1, col: 4 }, to: { row: 1, col: 2 } };
  assert.deepEqual(lintDrill(d), [
    { rule: 'ball-from-to', beat: 1, marker: 'ball', message: 'beat 1: ball PUSH from D1 to B1 (not adjacent)' },
  ]);
});

test('a ball that stays put with STILL is fine', () => {
  const d = fixture('good', '3x3-box-roll.json');
  d.sequence.push({ beat: 8, ball: { pos: { row: 1, col: 2 }, action: 'STILL' } });
  assert.deepEqual(lintDrill(d), []);
});

test('an {x, y} ball too near the bottom edge uses the ball insets', () => {
  const d = fixture('good', '3x3-box-roll.json');
  d.sequence[6].ball = { pos: { x: 0.5, y: 0.95 }, action: 'STILL' };
  const issues = lintDrill(d);
  assert.deepEqual(rules(issues), ['xy-edge']);
  assert.equal(issues[0].marker, 'ball');
  assert.match(issues[0].message, /^beat 7: ball at x 0\.500, y 0\.950 is too close to the edge/);
});
