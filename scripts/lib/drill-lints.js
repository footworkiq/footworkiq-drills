// Grid-aware semantic lints for drills (drills/*.json), CONTENT-04.
//
// Pure functions and frozen constants only: no file system writes and no
// exiting. validate-drills.js, the generator and the unit tests in
// test/drill-lints.test.js all import this module, so CI, generation and the
// tests can never disagree about a rule. Grid maths and edge insets come from
// ./grid.js, the vendored port of the app's grid.ts.
//
// Rule ids (Issue.rule):
//   cell-range      a {row, col} outside the drill's rows x cols
//   xy-edge         an {x, y} closer to an edge than half that grid's marker (D-04)
//   feet-same-cell  both feet in one cell, unless either is doing TAP,
//                   STEP_OVER or LIFT (D-03)
//   ball-jump       the ball changes to a cell that is not a king-move
//                   neighbour, including the loop wrap from the last beat back
//                   to beat 1 between reps (D-02, D-21)
//   ball-action     the ball changes cell with an action other than ROLL/PUSH (D-02)
//   ball-from-to    a moving ball's from/to don't match the previous and new
//                   cells, or a ROLL/PUSH has no from/to or a non-adjacent pair (D-02)
//
// lintDrill assumes an Ajv-valid drill and only lints 3x3, 3x4 and 4x4. A
// drill whose grid is '2x3' or absent returns [] (D-01): live 2x3 drills skip
// zones by design.
//
// Beats are walked in beat order with carry-forward state, as the engine
// does: a beat without a marker keeps that marker where it was. Cells in
// messages use chess names from the player's view (D-05): r1c1 = 'A1'.
// {x, y} positions are named by the cell nearest them (grid.js nearestCell).
//
// Issue shape: { rule: string, beat: number, marker: string, message: string }
// marker is 'left foot', 'right foot' or 'ball'.

import { INSETS, PRESETS, cellName, cellOf, isAdjacent, sameCell } from './grid.js';

/**
 * Foot actions that may share a cell with the other foot (D-03): a tap,
 * step-over or lifted foot isn't standing there.
 */
export const FEET_EXEMPT_ACTIONS = Object.freeze(['TAP', 'STEP_OVER', 'LIFT']);

/**
 * Ball actions that may move the ball to a new cell (D-02). A moving ball
 * also needs from = previous cell and to = new cell.
 */
export const BALL_MOVE_ACTIONS = Object.freeze(['ROLL', 'PUSH']);

function issue(rule, beat, marker, message) {
  return { rule, beat, marker, message };
}

const fmt = (n) => n.toFixed(3);
const name = (c) => cellName(c.row, c.col);
const isRowCol = (p) => p !== null && typeof p === 'object' && 'row' in p && 'col' in p;
const isXY = (p) => p !== null && typeof p === 'object' && 'x' in p && 'y' in p;

/**
 * Check one position and return its cell, or null when it can't be placed
 * (out of range, or not a position on a new grid). Pushes cell-range and
 * xy-edge issues.
 */
function checkPos(pos, g, kind, beat, marker, issues) {
  if (isRowCol(pos)) {
    if (pos.row < 1 || pos.row > g.rows || pos.col < 1 || pos.col > g.cols) {
      issues.push(
        issue(
          'cell-range',
          beat,
          marker,
          `beat ${beat}: ${marker} cell row ${pos.row} col ${pos.col} is outside the ${g.rows}×${g.cols} mat`,
        ),
      );
      return null;
    }
    return { row: pos.row, col: pos.col };
  }
  if (isXY(pos)) {
    const inset = INSETS[g.id][kind];
    const { x, y } = pos;
    if (x < inset.x || x > 1 - inset.x || y < inset.y || y > 1 - inset.y) {
      issues.push(
        issue(
          'xy-edge',
          beat,
          marker,
          `beat ${beat}: ${marker} at x ${fmt(x)}, y ${fmt(y)} is too close to the edge ` +
            `(keep x between ${fmt(inset.x)} and ${fmt(1 - inset.x)}, ` +
            `y between ${fmt(inset.y)} and ${fmt(1 - inset.y)})`,
        ),
      );
    }
    return cellOf(pos, g);
  }
  return null;
}

/**
 * Grid-aware lints for one drill. Assumes the drill already passed the
 * schema. Returns Issue[] (empty when the drill is clean or is 2x3).
 */
export function lintDrill(drill) {
  const id = drill?.metadata?.grid ?? '2x3';
  if (id === '2x3' || !Object.prototype.hasOwnProperty.call(PRESETS, id)) return [];
  if (!Object.prototype.hasOwnProperty.call(INSETS, id)) return [];
  const g = PRESETS[id];
  const issues = [];

  const beats = [...(drill.sequence ?? [])].sort((a, b) => a.beat - b.beat);

  let L = null; // { cell, action }
  let R = null;
  let B = null;
  let firstBall = null;

  beats.forEach((step, i) => {
    const beat = step.beat;

    // Feet
    if (step.left_foot) {
      const cell = checkPos(step.left_foot.pos, g, 'foot', beat, 'left foot', issues);
      L = { cell, action: step.left_foot.action };
    }
    if (step.right_foot) {
      const cell = checkPos(step.right_foot.pos, g, 'foot', beat, 'right foot', issues);
      R = { cell, action: step.right_foot.action };
    }
    if ((step.left_foot || step.right_foot) && L?.cell && R?.cell && sameCell(L.cell, R.cell)) {
      const exempt = FEET_EXEMPT_ACTIONS.includes(L.action) || FEET_EXEMPT_ACTIONS.includes(R.action);
      if (!exempt) {
        issues.push(
          issue('feet-same-cell', beat, 'right foot', `beat ${beat}: left and right foot both in ${name(L.cell)}`),
        );
      }
    }

    // Ball
    const ball = step.ball;
    if (!ball) return;
    const cell = checkPos(ball.pos, g, 'ball', beat, 'ball', issues);
    const from = ball.from === undefined ? undefined : checkPos(ball.from, g, 'ball', beat, 'ball', issues);
    const to = ball.to === undefined ? undefined : checkPos(ball.to, g, 'ball', beat, 'ball', issues);
    const moving = BALL_MOVE_ACTIONS.includes(ball.action);
    const prev = B?.cell ?? null;
    let reported = false;

    if (prev && cell && !sameCell(prev, cell)) {
      if (!isAdjacent(prev, cell)) {
        // The jump is the root cause; from/to mismatches it implies aren't repeated.
        issues.push(
          issue('ball-jump', beat, 'ball', `beat ${beat}: ball jumps ${name(prev)} → ${name(cell)} (not adjacent)`),
        );
        reported = true;
      } else if (!moving) {
        issues.push(
          issue(
            'ball-action',
            beat,
            'ball',
            `beat ${beat}: ball moves ${name(prev)} → ${name(cell)} with ${ball.action}; use ROLL or PUSH`,
          ),
        );
        reported = true;
      } else if (
        from === undefined ||
        to === undefined ||
        (from && !sameCell(from, prev)) ||
        (to && !sameCell(to, cell))
      ) {
        issues.push(
          issue(
            'ball-from-to',
            beat,
            'ball',
            `beat ${beat}: ball ${ball.action} from/to must be ${name(prev)} → ${name(cell)}`,
          ),
        );
        reported = true;
      }
    }

    if (moving && !reported) {
      if (from === undefined || to === undefined) {
        issues.push(issue('ball-from-to', beat, 'ball', `beat ${beat}: ball ${ball.action} needs from and to`));
      } else if (from && to && !isAdjacent(from, to)) {
        issues.push(
          issue(
            'ball-from-to',
            beat,
            'ball',
            `beat ${beat}: ball ${ball.action} from ${name(from)} to ${name(to)} (not adjacent)`,
          ),
        );
      }
    }

    B = { cell, action: ball.action };
    if (i === 0) firstBall = cell;
  });

  // Loop wrap (D-21): adjacency only, no action or from/to requirement.
  const last = B?.cell ?? null;
  if (firstBall && last && !isAdjacent(last, firstBall)) {
    issues.push(
      issue('ball-jump', 1, 'ball', `loop: ball jumps ${name(last)} → ${name(firstBall)} between reps (not adjacent)`),
    );
  }

  return issues;
}
