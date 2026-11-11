// Vendored grid port of OpenMat src/engine/grid.ts.
//
// cellCentre, cellName and nearestCell are ported verbatim, including the
// strict-< tie rule in nearestCell: a later candidate only wins when it is
// strictly closer, so ties keep the FIRST candidate in row-then-column order.
// This keeps lint messages naming {x, y} positions exactly as the app does.
//
// Presets, marker sizes and edge insets come from
// docs/schema/grid-contract.json. That file is a byte copy of the app's
// generated contract and is checked by the app's `npm run check:schema-drift`.
// Do not edit numbers here or in the JSON: regenerate it in the app and copy
// it across.
//
// Pure: reads the contract once at module load (like validate-drills.js reads
// its schema) and never writes files or exits.
//
// Row 1 is the near row (player's feet, bottom of screen) and col 1 is the
// player's left. Cell names are chess style: r1c1 = 'A1', r3c4 = 'D3'.
import { readFileSync } from 'fs';

const contractPath = new URL('../../docs/schema/grid-contract.json', import.meta.url);

/** The parsed grid contract (presets, REF_CELL_PX, markers, insets, vectors). */
export const CONTRACT = JSON.parse(readFileSync(contractPath, 'utf8'));

/** Grid presets keyed by id ('2x3', '3x3', '3x4', '4x4'): { id, rows, cols }. */
export const PRESETS = Object.freeze(
  Object.fromEntries(CONTRACT.presets.map((p) => [p.id, Object.freeze({ ...p })])),
);

/**
 * Edge insets per new grid ('3x3', '3x4', '4x4'), each { foot: {x, y}, ball: {x, y} }
 * as fractions of the mat. An {x, y} marker must sit at least this far from
 * every edge. There is no '2x3' entry (D-01).
 */
export const INSETS = Object.freeze(
  Object.fromEntries(
    Object.entries(CONTRACT.insets).map(([id, v]) => [
      id,
      Object.freeze({ foot: Object.freeze({ ...v.foot }), ball: Object.freeze({ ...v.ball }) }),
    ]),
  ),
);

/** Screen-space centre of a {row, col} cell. */
export function cellCentre(g, row, col) {
  return {
    x: (2 * col - 1) / (2 * g.cols),
    y: (2 * (g.rows - row) + 1) / (2 * g.rows),
  };
}

/** Chess-style cell name from the player's view: r1c1 = 'A1'. */
export function cellName(row, col) {
  return String.fromCharCode(64 + col) + row;
}

/**
 * The cell nearest a normalised point on a new grid. Ties keep the first
 * candidate (row 1..rows, then col 1..cols), as in the app.
 */
export function nearestCell(g, p) {
  let best = null;
  let bestD = Infinity;
  for (let row = 1; row <= g.rows; row++) {
    for (let col = 1; col <= g.cols; col++) {
      const c = cellCentre(g, row, col);
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { row, col, name: cellName(row, col) };
      }
    }
  }
  return best;
}

/** The {row, col} cell of a position: as given for {row, col}, nearest for {x, y}. */
export function cellOf(pos, g) {
  if (pos && typeof pos === 'object' && 'row' in pos && 'col' in pos) {
    return { row: pos.row, col: pos.col };
  }
  const { row, col } = nearestCell(g, pos);
  return { row, col };
}

/** True when two {row, col} cells are the same cell. */
export function sameCell(a, b) {
  return a.row === b.row && a.col === b.col;
}

/** King-move adjacency: neighbours, diagonals and the same cell all count. */
export function isAdjacent(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) <= 1;
}
