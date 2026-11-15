// Pure helpers for scripts/generate.js (CONTENT-05, D-08..D-10).
//
// Argument parsing, the per-grid ASCII mat and system prompts, strict schema
// paths, the from/to post-process, the model name and the cell summary all
// live here so they can be unit-tested offline (test/generate-lib.test.js).
// No file writes, no exiting, no network.
//
// LEGACY_SYSTEM_PROMPT is the 2x3 prompt moved verbatim from generate.js
// (D-08) plus the Phase 46 ball/foot rules (LEGACY_BALL_FOOT_RULES); a test
// strips those rules and checks the rest byte for byte against the pre-grid
// prompt. Grid prompts never mention {x, y} positions (D-09).
import { PRESETS, cellName } from './grid.js';

/**
 * Ball/foot rule bullets for the prompts (Phase 46 D-01, D-02): the same
 * rules lintDrill enforces on every grid. `unit` is "zone" (2x3) or "cell".
 */
function ballFootRules(unit) {
  return `  - "Next to" means one ${unit} away in any direction, diagonals included. The
    drill loops, so the beat after the last beat is beat 1.
  - The ball moves only on a beat when a foot that was on or next to its ${unit}
    touches it (INSIDE_TOUCH, OUTSIDE_TOUCH, SOLE_ROLL, TAP, DRAG or LIFT) and
    ends on or next to the ball's new ${unit}. PLANT, STEP and STEP_OVER never move the ball.
  - After a PUSH, the ball waits in its new ${unit} until a foot reaches that ${unit}.
  - A SOLE_ROLL or DRAG foot keeps its sole on the ball: it is in the ball's ${unit},
    and when it rolls the ball it started in the ${unit} the ball left.
  - A foot moves at most one ${unit} per beat.
  - Use PLANT only when the foot stays in the same ${unit} next beat. A foot that
    moves next beat is a STEP (or a touch) this beat.
  - Keep the feet within two ${unit}s of each other, and never put the right foot
    left of the left foot, except during a STEP_OVER.
  - The ball never jumps a ${unit}, including from the last beat back to beat 1.
`;
}

/**
 * The ball/foot rules added to the 2x3 prompt in Phase 46. Exported so the
 * test can strip it and compare the rest byte for byte with the pre-grid prompt.
 */
export const LEGACY_BALL_FOOT_RULES = `${ballFootRules('zone')}  - Zones next to each other: 1 and 4 touch every zone; 2 touches 1, 3, 4;
    3 touches 1, 2, 4; 5 touches 1, 4, 6; 6 touches 1, 4, 5.
`;

/** The original 2x3 system prompt plus LEGACY_BALL_FOOT_RULES (Phase 46). */
export const LEGACY_SYSTEM_PROMPT = `You design football footwork drills for the OpenMat training mat.

THE MAT (from the player's perspective, looking down at their feet):
  A 6-zone grid, 3 columns x 2 rows. Zone 1 is the bottom-centre HOME position
  (nearest the player). Coordinates are screen-space, Y increases DOWNWARD.

    +-----+-----+-----+
    |  3  |  4  |  5  |   far row  (top of screen, y = 0.3)
    +-----+-----+-----+
    |  2  |  1  |  6  |   near row (bottom of screen, y = 0.7)
    +-----+-----+-----+
       x=0.2 x=0.5 x=0.8

  Zone 1 = bottom centre (home)
  Zone 2 = bottom left
  Zone 3 = top left
  Zone 4 = top centre
  Zone 5 = top right
  Zone 6 = bottom right

FOOT ACTIONS (closed enum, do not invent):
  PLANT          - stationary weight-bearing foot
  STEP           - simple step to target zone
  INSIDE_TOUCH   - inside-of-foot touch on the ball
  OUTSIDE_TOUCH  - outside-of-foot touch on the ball
  SOLE_ROLL      - sole roll across the ball
  TAP            - quick tap on the ball
  DRAG           - drag ball with sole
  STEP_OVER      - scissors / step-over feint (foot crosses over ball without touching)
  LIFT           - foot leaves the mat (e.g., in the air)

BALL ACTIONS (closed enum):
  STILL  - ball does not move
  ROLL   - ball rolls between zones (use from and to)
  PUSH   - ball pushed to a new zone (use from and to)
  LIFT   - ball is in the air

RULES:
  - Foot positions must be physically coherent: feet should not occupy the same zone
    simultaneously unless one is TAP/STEP_OVER/LIFT.
  - The ball moves continuously: if beat N has ball at zone A and beat N+1 at zone B,
    beat N+1 must use ROLL or PUSH with from=A, to=B.
${LEGACY_BALL_FOOT_RULES}  - License is always "CC0". Contributor is "FootworkIQ-AI".
  - Use kebab-case for the drill id, matching the file naming convention.
  - reps = 4, sets = 3, count_in = 1 are sensible defaults unless the concept demands otherwise.
  - time_signature is almost always "4/4" — use this unless explicitly asked.
  - subdivision = 1 (quarter notes) by default. Use 2 (eighths) for fast drills only.
`;

const GRID_IDS = Object.freeze(['3x3', '3x4', '4x4']);

/**
 * Parse generate.js arguments. Throws on a bad --grid so the CLI can fail
 * before it ever reads OPENAI_API_KEY.
 * @returns {{ force: boolean, grid: string|null, out: string|null, concept: string }}
 */
export function parseArgs(argv) {
  const out = { force: false, grid: null, out: null, concept: [] };
  let gridGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--grid') {
      gridGiven = true;
      out.grid = argv[++i] ?? '';
    } else if (a.startsWith('--grid=')) {
      gridGiven = true;
      out.grid = a.slice('--grid='.length);
    } else if (a === '--out') out.out = argv[++i] ?? null;
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else out.concept.push(a);
  }
  if (gridGiven && !GRID_IDS.includes(out.grid)) {
    throw new Error(`--grid must be 3x3, 3x4 or 4x4 (got ${out.grid || 'nothing'}); omit it for 2x3`);
  }
  return { force: out.force, grid: out.grid, out: out.out || null, concept: out.concept.join(' ').trim() };
}

/**
 * ASCII picture of a new grid from the player's view: far row on top, near
 * row (row 1) at the bottom, chess names in every cell.
 */
export function asciiMat(gridId) {
  const { rows, cols } = PRESETS[gridId];
  const letters = Array.from({ length: cols }, (_, i) => String.fromCharCode(65 + i));
  const header = ' '.repeat(5) + letters.map((l) => `  ${l}     `).join('').trimEnd();
  const lines = [header];
  for (let row = rows; row >= 1; row--) {
    const cells = [];
    for (let col = 1; col <= cols; col++) cells.push(`[ ${cellName(row, col)} ]`);
    let line = `  ${row}  ${cells.join('  ')}`;
    if (row === rows) line += '   far row';
    if (row === 1) line += '   (near row, your feet)';
    lines.push(line);
  }
  return lines.join('\n');
}

/** System prompt: the unchanged legacy prompt for 2x3, a grid prompt otherwise. */
export function systemPrompt(gridId) {
  if (gridId == null) return LEGACY_SYSTEM_PROMPT;
  const { rows, cols } = PRESETS[gridId];
  const last = cellName(rows, cols);
  return `You design football footwork drills for the FootworkIQ training mat.

THE MAT (from the player's perspective, looking down at their feet):
  A ${rows}x${cols} grid: ${rows} rows x ${cols} columns. Row 1 is the near row (at the
  player's feet, bottom of the screen); row ${rows} is the far row. Column 1 is the
  player's left; column ${cols} is the player's right.

${asciiMat(gridId)}

  Every position (foot pos, ball pos, ball from, ball to) is a cell written as
  {"row": R, "col": C} with row 1..${rows} and col 1..${cols}. Cells are named chess
  style from the player's view: the letter is the column (A = col 1) and the
  number is the row, so A1 = {"row": 1, "col": 1} and ${last} = {"row": ${rows}, "col": ${cols}}.

  The drill's "schema" must be "1.1" and metadata.grid must be "${gridId}".

FOOT ACTIONS (closed enum, do not invent):
  PLANT          - stationary weight-bearing foot
  STEP           - simple step to target cell
  INSIDE_TOUCH   - inside-of-foot touch on the ball
  OUTSIDE_TOUCH  - outside-of-foot touch on the ball
  SOLE_ROLL      - sole roll across the ball
  TAP            - quick tap on the ball
  DRAG           - drag ball with sole
  STEP_OVER      - scissors / step-over feint (foot crosses over ball without touching)
  LIFT           - foot leaves the mat (e.g., in the air)

BALL ACTIONS (closed enum):
  STILL  - ball does not move
  ROLL   - ball rolls to a neighbouring cell (use from and to)
  PUSH   - ball pushed to a neighbouring cell (use from and to)
  LIFT   - ball is in the air

RULES:
  - The ball moves at most one cell per beat, in any direction including
    diagonals (like a king in chess). Never jump the ball two cells.
  - When the ball changes cell, that beat must use ROLL or PUSH with
    from = the previous beat's ball cell and to = the new ball cell.
    When the ball stays in its cell, use STILL or LIFT and set from and to
    to the ball's cell.
  - The drill loops: the last beat's ball cell must be the same as, or next
    to, beat 1's ball cell.
  - Never put both feet in the same cell unless one foot is doing TAP,
    STEP_OVER or LIFT.
${ballFootRules('cell')}  - Every beat gives left_foot, right_foot and ball.
  - License is always "CC0". Contributor is "FootworkIQ-AI".
  - Use kebab-case for the drill id, matching the file naming convention.
  - reps = 4, sets = 3, count_in = 1 are sensible defaults unless the concept demands otherwise.
  - time_signature is almost always "4/4" — use this unless explicitly asked.
  - subdivision = 1 (quarter notes) by default. Use 2 (eighths) for fast drills only.
`;
}

/** Absolute path of the strict OpenAI schema for a grid (null = 2x3 template). */
export function strictSchemaPathFor(gridId) {
  const file = gridId == null ? 'drill.strict-schema.json' : `drill.strict-schema.${gridId}.json`;
  return new URL(`../../docs/schema/${file}`, import.meta.url).pathname;
}

/** Drop ball from/to unless the ball is moving (ROLL/PUSH). Mutates and returns the drill. */
export function postProcess(drill) {
  for (const step of drill.sequence) {
    if (step.ball && step.ball.action !== 'ROLL' && step.ball.action !== 'PUSH') {
      delete step.ball.from;
      delete step.ball.to;
    }
  }
  return drill;
}

/**
 * The OpenAI model to use. gpt-4o snapshots shut down 2027-01-14, so set
 * OPENAI_MODEL to a current structured-outputs model when that happens.
 */
export function modelName(env) {
  return env.OPENAI_MODEL?.trim() || 'gpt-4o';
}

/** Sorted unique chess names of every {row, col} foot and ball position. */
export function usedCellNames(drill) {
  const names = new Set();
  const add = (p) => {
    if (p && typeof p === 'object' && 'row' in p && 'col' in p) names.add(cellName(p.row, p.col));
  };
  for (const s of drill.sequence) {
    add(s.left_foot?.pos);
    add(s.right_foot?.pos);
    add(s.ball?.pos);
    add(s.ball?.from);
    add(s.ball?.to);
  }
  return [...names].sort();
}
