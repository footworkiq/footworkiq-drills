// Grid-aware semantic lints for drills (stub; implemented in the next commit).

/** Foot actions that may share a cell with the other foot (D-03). */
export const FEET_EXEMPT_ACTIONS = Object.freeze(['TAP', 'STEP_OVER', 'LIFT']);

/** Ball actions that may move the ball to a new cell (D-02). */
export const BALL_MOVE_ACTIONS = Object.freeze(['ROLL', 'PUSH']);

export function lintDrill() {
  return [];
}
