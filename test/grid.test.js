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
  ZONE_CELLS,
  isAdjacent,
  kingDistance,
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

test('ZONE_CELLS maps the six 2x3 zones to cells and is frozen', () => {
  assert.deepEqual(
    { ...ZONE_CELLS },
    {
      1: { row: 1, col: 2 },
      2: { row: 1, col: 1 },
      3: { row: 2, col: 1 },
      4: { row: 2, col: 2 },
      5: { row: 2, col: 3 },
      6: { row: 1, col: 3 },
    },
  );
  assert.ok(Object.isFrozen(ZONE_CELLS));
  for (const v of Object.values(ZONE_CELLS)) assert.ok(Object.isFrozen(v));
});

test('cellOf maps integer zones through ZONE_CELLS (a copy) and rejects non-zones', () => {
  const g = PRESETS['2x3'];
  for (let z = 1; z <= 6; z++) {
    const c = cellOf(z, g);
    assert.deepEqual(c, { ...ZONE_CELLS[z] });
    assert.notEqual(c, ZONE_CELLS[z]);
    assert.ok(!Object.isFrozen(c));
  }
  assert.equal(cellOf(7, g), null);
  assert.equal(cellOf(0, g), null);
});

test('cellOf snaps 2x3 {x, y} against the app ZONE_COORDS', () => {
  const g = PRESETS['2x3'];
  // Uniform cell centres would give col 2 here; the app's zone points give col 1.
  assert.deepEqual(cellOf({ x: 0.34, y: 0.7 }, g), { row: 1, col: 1 });
  assert.deepEqual(cellOf({ x: 0.66, y: 0.3 }, g), { row: 2, col: 3 });
  // Tie between zones 1 and 4: zone 1 is checked first.
  assert.deepEqual(cellOf({ x: 0.5, y: 0.5 }, g), { row: 1, col: 2 });
});

test('cellOf leaves {row, col} and non-2x3 {x, y} unchanged', () => {
  assert.deepEqual(cellOf({ row: 2, col: 3 }, PRESETS['2x3']), { row: 2, col: 3 });
  assert.deepEqual(cellOf({ row: 3, col: 1 }, PRESETS['3x3']), { row: 3, col: 1 });
  const g = PRESETS['4x4'];
  const n = nearestCell(g, { x: 0.5, y: 0.875 });
  assert.deepEqual(cellOf({ x: 0.5, y: 0.875 }, g), { row: n.row, col: n.col });
});

test('kingDistance is the larger of the row and col deltas', () => {
  assert.equal(kingDistance({ row: 1, col: 1 }, { row: 3, col: 2 }), 2);
  const a = { row: 2, col: 2 };
  assert.equal(kingDistance(a, a), 0);
  assert.equal(kingDistance({ row: 1, col: 4 }, { row: 2, col: 1 }), 3);
});
