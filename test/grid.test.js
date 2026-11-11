// Unit tests for scripts/lib/grid.js (vendored port of the app's grid.ts).
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT,
  INSETS,
  PRESETS,
  cellCentre,
  cellName,
  cellOf,
  isAdjacent,
  nearestCell,
  sameCell,
} from '../scripts/lib/grid.js';

test('every shared contract vector names the same cell as the app', () => {
  assert.ok(CONTRACT.vectors.length > 0);
  for (const v of CONTRACT.vectors) {
    const got = nearestCell(PRESETS[v.grid], { x: v.x, y: v.y }).name;
    assert.equal(got, v.cell, `${v.grid} (${v.x}, ${v.y})`);
  }
});

test('tie points keep the first candidate', () => {
  assert.equal(nearestCell(PRESETS['4x4'], { x: 0.5, y: 0.875 }).name, 'B1');
  assert.equal(nearestCell(PRESETS['4x4'], { x: 0.125, y: 0.5 }).name, 'A2');
});

test('vendored insets are consistent with the contract marker sizes', () => {
  const { FOOT_W, FOOT_H, BALL_SIZE } = CONTRACT.markers;
  for (const id of ['3x3', '3x4', '4x4']) {
    const g = PRESETS[id];
    const w = g.cols * CONTRACT.REF_CELL_PX;
    const h = g.rows * CONTRACT.REF_CELL_PX;
    assert.equal(INSETS[id].foot.x, FOOT_W / 2 / w, `${id} foot.x`);
    assert.equal(INSETS[id].foot.y, FOOT_H / 2 / h, `${id} foot.y`);
    assert.equal(INSETS[id].ball.x, BALL_SIZE / 2 / w, `${id} ball.x`);
    assert.equal(INSETS[id].ball.y, BALL_SIZE / 2 / h, `${id} ball.y`);
  }
  assert.equal(INSETS['3x3'].foot.x, CONTRACT.markers.FOOT_W / 2 / (3 * CONTRACT.REF_CELL_PX));
});

test('presets cover all four grids; insets skip 2x3', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['2x3', '3x3', '3x4', '4x4']);
  assert.deepEqual(PRESETS['3x4'], { id: '3x4', rows: 3, cols: 4 });
  assert.equal('2x3' in INSETS, false);
  assert.ok(Object.isFrozen(PRESETS) && Object.isFrozen(INSETS));
});

test('cellName uses chess notation from the player view', () => {
  assert.equal(cellName(1, 1), 'A1');
  assert.equal(cellName(3, 4), 'D3');
});

test('cellCentre puts row 1 at the bottom and col 1 on the left', () => {
  assert.deepEqual(cellCentre(PRESETS['4x4'], 1, 1), { x: 0.125, y: 0.875 });
  assert.deepEqual(cellCentre(PRESETS['3x3'], 3, 2), { x: 0.5, y: 1 / 6 });
});

test('isAdjacent is a king move (same cell counts)', () => {
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 2, col: 2 }), true);
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 1 }), true);
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 3 }), false);
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 3, col: 1 }), false);
});

test('cellOf and sameCell handle both position kinds', () => {
  const g = PRESETS['3x3'];
  assert.deepEqual(cellOf({ row: 2, col: 3 }, g), { row: 2, col: 3 });
  assert.deepEqual(cellOf({ x: 0.45, y: 0.55 }, g), { row: 2, col: 2 });
  assert.equal(sameCell(cellOf({ x: 0.5, y: 0.5 }, g), { row: 2, col: 2 }), true);
  assert.equal(sameCell({ row: 1, col: 2 }, { row: 2, col: 1 }), false);
});
