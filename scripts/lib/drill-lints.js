// Grid-aware semantic lints for drills (drills/*.json), CONTENT-04 and CONTENT-08.
//
// Pure functions and frozen constants only: no file system writes and no
// exiting. validate-drills.js, the generator and the unit tests in
// test/drill-lints.test.js all import this module, so CI, generation and the
// tests can never disagree about a rule. Grid maths and edge insets come from
// ./grid.js, the vendored port of the app's grid.ts.
//
// Every drill is linted on every grid, 2x3 included (D-02). Integer 2x3 zones
// map to cells through ZONE_CELLS, and {x, y} positions snap to the nearest
// cell (on 2x3 against the app's ZONE_COORDS, ties to the lower zone) before
// any rule runs (D-03).
//
// Rule ids (Issue.rule):
//   cell-range      a {row, col} outside the drill's rows x cols
//   xy-edge         an {x, y} closer to an edge than half that grid's marker
//                   (grid-only: 2x3 has no insets) (D-22)
//   feet-same-cell  both feet in one cell, unless either is doing TAP,
//                   STEP_OVER or LIFT; now on 2x3 too (D-22)
//   ball-jump       the ball changes to a cell that is not a king-move
//                   neighbour, including the loop wrap from the last beat back
//                   to beat 1 between reps; now on 2x3 too (D-22)
//   ball-action     the ball changes cell with an action other than ROLL/PUSH
//                   (grid-only) (D-22)
//   ball-from-to    a moving ball's from/to don't match the previous and new
//                   cells, or a ROLL/PUSH has no from/to or a non-adjacent pair
//                   (grid-only) (D-22)
//   ball-no-touch   the ball changes cell but no foot doing a touch action at
//                   that beat was within one square of the ball before the move
//                   and within one square of it after (D-01)
//   ball-push-wait  after a PUSH moves the ball to Q at beat N, the ball moves
//                   off Q at beat M before any foot stood in Q at a beat in
//                   [N, M-1] (D-01)
//   sole-on-ball    a foot doing SOLE_ROLL or DRAG is not in the ball's cell (D-01)
//   sole-start      a SOLE_ROLL/DRAG foot rolls the ball into its cell but was
//                   not in the ball's previous cell the beat before (D-01)
//   foot-step       a foot moves more than one square between beats (D-01)
//   plant-moves     a foot is PLANT at a beat but in a different cell the next
//                   beat (the engine holds a PLANT foot, then teleports it) (D-01)
//   feet-apart      the feet are more than two squares apart (D-01)
//   feet-crossed    the right foot is left of the left foot (same column is
//                   fine), unless either foot is doing STEP_OVER (D-01)
//
// lintDrill assumes an Ajv-valid drill. An unknown grid id returns [].
//
// Beats are walked in beat order with carry-forward state, as the engine
// does: a beat without a marker keeps that marker where it was, and before
// the first marker the grid's home positions apply (app homePositions). The
// drill loops, so the D-01 rules are cyclic: the beat before the first is
// the last, and the beat after the last is the first. Adjacency is king-move.
// Cells in messages use chess names from the player's view: r1c1 = 'A1'.
//
// Issue shape: { rule: string, beat: number, marker: string, message: string }
// marker is 'left foot', 'right foot' or 'ball'. Every message starts
// 'beat N: <marker>' except the loop-wrap ball-jump ('loop: ...'). Issues are
// returned sorted by beat (stable).

import {
  INSETS,
  PRESETS,
  cellCentre,
  cellName,
  cellOf,
  isAdjacent,
  kingDistance,
  sameCell,
} from './grid.js';

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

/**
 * Foot actions that can move the ball (D-01). STEP_OVER is a feint, not a
 * touch; PLANT and STEP don't touch the ball.
 */
export const TOUCH_ACTIONS = Object.freeze(['INSIDE_TOUCH', 'OUTSIDE_TOUCH', 'SOLE_ROLL', 'TAP', 'DRAG', 'LIFT']);

/** Foot actions with the sole on the ball: the foot must be in the ball's cell (D-01). */
export const SOLE_ACTIONS = Object.freeze(['SOLE_ROLL', 'DRAG']);

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function issue(rule, beat, marker, message) {
  return { rule, beat, marker, message };
}

const fmt = (n) => n.toFixed(3);
const name = (c) => cellName(c.row, c.col);
const isRowCol = (p) => p !== null && typeof p === 'object' && 'row' in p && 'col' in p;
const isXY = (p) => p !== null && typeof p === 'object' && 'x' in p && 'y' in p;

/** The app's homePositions(g) as cells: where markers start before their first beat. */
function homeCells(g) {
  if (g.id === '2x3') return { left: cellOf(2, g), right: cellOf(6, g), ball: cellOf(1, g) };
  return {
    left: { row: 1, col: 1 },
    right: { row: 1, col: g.cols },
    ball: cellOf({ x: 0.5, y: cellCentre(g, 1, 1).y }, g),
  };
}

/**
 * Check one position and return its cell, or null when it can't be placed
 * (an unknown zone, out of range, or not a position). Pushes cell-range and
 * (on grids with insets) xy-edge issues.
 */
function checkPos(pos, g, kind, beat, marker, issues) {
  if (typeof pos === 'number') {
    // Integer zones are 2x3 only; cellOf returns null for a non-zone.
    return g.id === '2x3' ? cellOf(pos, g) : null;
  }
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
    if (hasOwn(INSETS, g.id)) {
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
    }
    return cellOf(pos, g);
  }
  return null;
}

/**
 * Grid-aware lints for one drill. Assumes the drill already passed the
 * schema. Returns Issue[] sorted by beat (empty when the drill is clean or
 * its grid id is unknown).
 */
export function lintDrill(drill) {
  const id = drill?.metadata?.grid ?? '2x3';
  if (!hasOwn(PRESETS, id)) return [];
  const g = PRESETS[id];
  const gridOnly = id !== '2x3'; // ball-action and ball-from-to (D-22)
  const issues = [];

  const beats = [...(drill.sequence ?? [])].sort((a, b) => a.beat - b.beat);
  const n = beats.length;
  if (n === 0) return issues;

  // ---- 1. Snapped carry-forward table --------------------------------------
  // S[i] = { beat, L, R, B } with L/R = { cell, action } and
  // B = { cell, action, from, to, authored } (from/to cells or undefined).
  const home = homeCells(g);
  let L = { cell: home.left, action: undefined };
  let R = { cell: home.right, action: undefined };
  let B = { cell: home.ball, action: undefined, authored: false };
  const S = [];
  for (const step of beats) {
    const beat = step.beat;
    if (step.left_foot) {
      L = { cell: checkPos(step.left_foot.pos, g, 'foot', beat, 'left foot', issues), action: step.left_foot.action };
    }
    if (step.right_foot) {
      R = { cell: checkPos(step.right_foot.pos, g, 'foot', beat, 'right foot', issues), action: step.right_foot.action };
    }
    if (step.ball) {
      const ball = step.ball;
      B = {
        cell: checkPos(ball.pos, g, 'ball', beat, 'ball', issues),
        action: ball.action,
        from: ball.from === undefined ? undefined : checkPos(ball.from, g, 'ball', beat, 'ball', issues),
        to: ball.to === undefined ? undefined : checkPos(ball.to, g, 'ball', beat, 'ball', issues),
        authored: true,
      };
    } else if (B.authored) {
      // Carried forward: not a new ball entry at this beat.
      B = { cell: B.cell, action: B.action, authored: true, carried: true };
    }
    S.push({ beat, L, R, B, hasFoot: Boolean(step.left_foot || step.right_foot), hasBall: Boolean(step.ball) });
  }

  // ---- 2. Existing ball rules (authored ball beats, in order) ---------------
  let lastBall = null;
  let firstBall = null;
  let firstBallBeat = null;
  for (const cur of S) {
    if (!cur.hasBall) continue;
    const beat = cur.beat;
    const { cell, from, to, action } = cur.B;
    const moving = BALL_MOVE_ACTIONS.includes(action);
    let reported = false;

    if (lastBall && cell && !sameCell(lastBall, cell)) {
      if (!isAdjacent(lastBall, cell)) {
        // The jump is the root cause; from/to mismatches it implies aren't repeated.
        issues.push(
          issue('ball-jump', beat, 'ball', `beat ${beat}: ball jumps ${name(lastBall)} → ${name(cell)} (not adjacent)`),
        );
        reported = true;
      } else if (gridOnly && !moving) {
        issues.push(
          issue(
            'ball-action',
            beat,
            'ball',
            `beat ${beat}: ball moves ${name(lastBall)} → ${name(cell)} with ${action}; use ROLL or PUSH`,
          ),
        );
        reported = true;
      } else if (
        gridOnly &&
        (from === undefined || to === undefined || (from && !sameCell(from, lastBall)) || (to && !sameCell(to, cell)))
      ) {
        issues.push(
          issue(
            'ball-from-to',
            beat,
            'ball',
            `beat ${beat}: ball ${action} from/to must be ${name(lastBall)} → ${name(cell)}`,
          ),
        );
        reported = true;
      }
    }

    if (gridOnly && moving && !reported) {
      if (from === undefined || to === undefined) {
        issues.push(issue('ball-from-to', beat, 'ball', `beat ${beat}: ball ${action} needs from and to`));
      } else if (from && to && !isAdjacent(from, to)) {
        issues.push(
          issue('ball-from-to', beat, 'ball', `beat ${beat}: ball ${action} from ${name(from)} to ${name(to)} (not adjacent)`),
        );
      }
    }

    lastBall = cell;
    if (firstBallBeat === null) {
      firstBall = cell;
      firstBallBeat = beat;
    }
  }

  // Loop wrap (D-21): adjacency only, no action or from/to requirement.
  if (firstBall && lastBall && !isAdjacent(lastBall, firstBall)) {
    issues.push(
      issue(
        'ball-jump',
        firstBallBeat,
        'ball',
        `loop: ball jumps ${name(lastBall)} → ${name(firstBall)} between reps (not adjacent)`,
      ),
    );
  }

  // ---- 3. One cyclic pass: feet and ball/foot rules (D-01) ------------------
  const feetOf = (st) => [
    ['left foot', st.L],
    ['right foot', st.R],
  ];
  const footAt = (st, marker) => (marker === 'left foot' ? st.L : st.R);

  for (let i = 0; i < n; i++) {
    const cur = S[i];
    const prev = S[(i - 1 + n) % n];
    const next = S[(i + 1) % n];
    const beat = cur.beat;
    const ballCell = cur.B.cell;

    for (const [marker, f] of feetOf(cur)) {
      if (!f.cell) continue;
      const pf = footAt(prev, marker);
      const nf = footAt(next, marker);
      if (pf.cell && kingDistance(pf.cell, f.cell) > 1) {
        issues.push(
          issue('foot-step', beat, marker, `beat ${beat}: ${marker} moves ${name(pf.cell)} → ${name(f.cell)} (more than one square)`),
        );
      }
      if (f.action === 'PLANT' && nf.cell && !sameCell(nf.cell, f.cell)) {
        issues.push(
          issue(
            'plant-moves',
            beat,
            marker,
            `beat ${beat}: ${marker} is PLANT in ${name(f.cell)} but moves to ${name(nf.cell)} next beat`,
          ),
        );
      }
      if (SOLE_ACTIONS.includes(f.action) && ballCell && !sameCell(f.cell, ballCell)) {
        issues.push(
          issue(
            'sole-on-ball',
            beat,
            marker,
            `beat ${beat}: ${marker} ${f.action} in ${name(f.cell)} but the ball is in ${name(ballCell)}`,
          ),
        );
      }
    }

    if (cur.L.cell && cur.R.cell) {
      const d = kingDistance(cur.L.cell, cur.R.cell);
      if (d > 2) {
        issues.push(issue('feet-apart', beat, 'right foot', `beat ${beat}: right foot is ${d} squares from the left foot`));
      }
      const stepOver = cur.L.action === 'STEP_OVER' || cur.R.action === 'STEP_OVER';
      if (!stepOver && cur.L.cell.col > cur.R.cell.col) {
        issues.push(
          issue(
            'feet-crossed',
            beat,
            'right foot',
            `beat ${beat}: right foot in ${name(cur.R.cell)} is left of the left foot in ${name(cur.L.cell)}`,
          ),
        );
      }
      // Existing rule: checked on beats that place a foot.
      if (cur.hasFoot && sameCell(cur.L.cell, cur.R.cell)) {
        const exempt = FEET_EXEMPT_ACTIONS.includes(cur.L.action) || FEET_EXEMPT_ACTIONS.includes(cur.R.action);
        if (!exempt) {
          issues.push(
            issue('feet-same-cell', beat, 'right foot', `beat ${beat}: right foot shares ${name(cur.L.cell)} with the left foot`),
          );
        }
      }
    }

    const from = prev.B.cell;
    const to = ballCell;
    if (from && to && !sameCell(from, to)) {
      const touched = feetOf(cur).some(([marker, f]) => {
        const pf = footAt(prev, marker);
        return (
          TOUCH_ACTIONS.includes(f.action) &&
          f.cell &&
          pf.cell &&
          kingDistance(pf.cell, from) <= 1 &&
          kingDistance(f.cell, to) <= 1
        );
      });
      for (const [marker, f] of feetOf(cur)) {
        const pf = footAt(prev, marker);
        if (SOLE_ACTIONS.includes(f.action) && f.cell && sameCell(f.cell, to) && pf.cell && !sameCell(pf.cell, from)) {
          issues.push(
            issue(
              'sole-start',
              beat,
              marker,
              `beat ${beat}: ${marker} ${f.action} rolls the ball ${name(from)} → ${name(to)} but started in ${name(pf.cell)}`,
            ),
          );
        }
      }
      if (!touched) {
        issues.push(
          issue(
            'ball-no-touch',
            beat,
            'ball',
            `beat ${beat}: ball moves ${name(from)} → ${name(to)} but no foot on or next to it touches it`,
          ),
        );
      }
    }
  }

  // ---- 4. ball-push-wait (cyclic) -------------------------------------------
  // After a PUSH lands the ball on Q at index i, its next move off Q at index
  // j needs a foot IN Q at some index in [i, j-1] (j itself doesn't count).
  for (let i = 0; i < n; i++) {
    const prevB = S[(i - 1 + n) % n].B;
    const Q = S[i].B.cell;
    if (!(Q && prevB.cell && !sameCell(Q, prevB.cell) && S[i].B.action === 'PUSH')) continue;
    let reached = false;
    for (let k = 1; k < n; k++) {
      const j = (i + k) % n;
      const w = S[(j - 1 + n) % n];
      if ([w.L.cell, w.R.cell].some((c) => c && sameCell(c, Q))) reached = true;
      const bj = S[j].B.cell;
      if (bj && !sameCell(bj, Q)) {
        if (!reached) {
          issues.push(
            issue(
              'ball-push-wait',
              S[j].beat,
              'ball',
              `beat ${S[j].beat}: ball moves off ${name(Q)} after a PUSH before a foot reaches it`,
            ),
          );
        }
        break;
      }
    }
  }

  // Stable sort by beat (Array.prototype.sort is stable in Node 12+).
  return issues.sort((a, b) => a.beat - b.beat);
}
