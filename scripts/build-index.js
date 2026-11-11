import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildIndexEntry } from './lib/index-entry.js';

const drillsDir = new URL('../drills', import.meta.url).pathname;
const files = readdirSync(drillsDir).filter((f) => f.endsWith('.json'));

const index = [];
for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(drillsDir, file), 'utf8'));
  } catch (e) {
    console.error(`Skipping ${file}: invalid JSON — ${e.message}`);
    continue;
  }
  if (!raw?.metadata?.id) {
    console.error(`Skipping ${file}: missing metadata.id`);
    continue;
  }
  index.push(buildIndexEntry(raw));
}

writeFileSync(
  new URL('../index.json', import.meta.url).pathname,
  JSON.stringify(index, null, 2) + '\n',
);

console.log(`Built index.json with ${index.length} drills.`);
