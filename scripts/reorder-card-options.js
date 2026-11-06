// Stores each decision card's options in its seeded order (D-03).
//
// The order comes from scripts/lib/reorder.js: PERMS[sha256(id) % 6] over the
// canonical order (best, ok, poor). It is deterministic and idempotent, so a
// second run changes nothing. A file is only rewritten when its text changes,
// and it is written as JSON.stringify(card, null, 2) + '\n' (the format the
// validator enforces).
//
// --check writes nothing and exits 1 if any card is not in seeded order.
//
// Usage: node scripts/reorder-card-options.js [--dir <path>] [--category attack|defend|mindset] [--check]
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { shuffledOptions, isSeededOrder } from './lib/reorder.js';

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`Missing value for ${name}`);
    process.exit(1);
  }
  return v;
}

const CATEGORIES = ['attack', 'defend', 'mindset'];

const dirArg = argValue('--dir');
const category = argValue('--category');
const check = process.argv.includes('--check');
const cardsDir = dirArg
  ? resolve(process.cwd(), dirArg)
  : new URL('../cards/decision', import.meta.url).pathname;

if (category !== undefined && !CATEGORIES.includes(category)) {
  console.error(`Unknown --category ${category} (use attack, defend or mindset)`);
  process.exit(1);
}

const files = readdirSync(cardsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

let total = 0;
let written = 0;
let unchanged = 0;
let mismatched = 0;

for (const file of files) {
  const path = join(cardsDir, file);
  const text = readFileSync(path, 'utf8');
  let card;
  try {
    card = JSON.parse(text);
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON (${e.message})`);
    process.exit(1);
  }
  if (category !== undefined && card.category !== category) continue;
  total++;

  if (check) {
    if (!isSeededOrder(card)) {
      console.error(`FAIL ${file}: options not in seeded order; run node scripts/reorder-card-options.js`);
      mismatched++;
    }
    continue;
  }

  card.options = shuffledOptions(card);
  const out = JSON.stringify(card, null, 2) + '\n';
  if (out === text) {
    unchanged++;
  } else {
    writeFileSync(path, out);
    written++;
  }
}

if (check) {
  if (mismatched > 0) process.exit(1);
  console.log(`All ${total} card(s) in seeded order.`);
} else {
  console.log(`Reordered ${total} card(s) (written ${written}, unchanged ${unchanged}).`);
}
