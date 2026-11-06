// Seeded option order for decision cards (D-03).
//
// Each card's options are stored in an order picked by its id alone:
// PERMS[sha256(id) % 6] applied to a canonical order (best, ok, poor, ties by
// option id). Over the 72 current ids this puts best first/middle/last on
// 26/20/26 cards.
//
// - Best is always canonical index 0, so its stored slot depends only on the
//   card id. Regrading a non-best option (ok <-> poor) never moves best.
// - The order is idempotent: shuffledOptions(card) applied to an already
//   shuffled card returns the same order, because canonical() sorts first.
// - Player history is unaffected: answers are recorded by option id, not by
//   index. The frozen-id and rev-bump checks in validate-cards.js also match
//   options by id, so a reorder never trips them.
//
// Pure functions only: no file system access.
import { createHash } from 'node:crypto';

/**
 * The six orderings of three options, indexed by sha256(id) % 6.
 * FROZEN: changing this array (or its order) moves every card's options.
 */
export const PERMS = Object.freeze([
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]);

/** Canonical grade order: best first, then ok, then poor. */
export const GRADE_RANK = Object.freeze({ best: 0, ok: 1, poor: 2 });

function hashIndex(id) {
  return createHash('sha256').update(id).digest().readUInt32BE(0) % PERMS.length;
}

/** A sorted copy of options: by GRADE_RANK, then by option id (code-unit order). */
export function canonical(options) {
  return [...options].sort((a, b) => {
    const g = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
    if (g !== 0) return g;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The card's options in seeded order. Returns the SAME option objects (not
 * copies), so each option's key order is preserved when re-serialised.
 */
export function shuffledOptions(card) {
  const canon = canonical(card.options);
  return PERMS[hashIndex(card.id)].map((i) => canon[i]);
}

/** Stored index (0-2) of the best option for a card with this id. */
export function bestSlot(id) {
  return PERMS[hashIndex(id)].indexOf(0);
}

/** True when the card's stored option ids already match the seeded order. */
export function isSeededOrder(card) {
  const want = shuffledOptions(card).map((o) => o.id);
  return card.options.every((o, i) => o.id === want[i]);
}
