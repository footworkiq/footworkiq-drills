// Deterministic builder for cards/decision.bundle.json.
//
// Output: { schema: '1.0', deck: 'decision', cards: [...sorted by id] },
// written as JSON.stringify(bundle, null, 2) + '\n' with no timestamp, so two
// runs over the same input are byte-identical.
//
// This script does NOT validate against the schema; CI runs validate-cards.js
// first. It does exit 1 on invalid JSON, a missing id or a duplicate id (never
// skips a file), so a bundle with colliding ids is never published.
//
// Usage: node scripts/build-card-bundle.js [--dir <path>] [--out <path>]
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

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

const dirArg = argValue('--dir');
const outArg = argValue('--out');
const cardsDir = dirArg
  ? resolve(process.cwd(), dirArg)
  : new URL('../cards/decision', import.meta.url).pathname;
const outPath = outArg
  ? resolve(process.cwd(), outArg)
  : new URL('../cards/decision.bundle.json', import.meta.url).pathname;

const files = readdirSync(cardsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const cards = [];
const seenIds = new Map(); // id -> file
let failed = 0;

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(cardsDir, file), 'utf8'));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON — ${e.message}`);
    failed++;
    continue;
  }
  if (typeof data?.id !== 'string' || data.id.length === 0) {
    console.error(`FAIL ${file}: missing or non-string id`);
    failed++;
    continue;
  }
  if (seenIds.has(data.id)) {
    console.error(`FAIL ${file}: duplicate id "${data.id}" (also in ${seenIds.get(data.id)})`);
    failed++;
    continue;
  }
  seenIds.set(data.id, file);
  cards.push(data);
}

if (failed > 0) {
  console.error(`\n${failed} file(s) could not be bundled.`);
  process.exit(1);
}

cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const bundle = { schema: '1.0', deck: 'decision', cards };
writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n');

console.log(`Built decision.bundle.json with ${cards.length} cards.`);
