import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const drillsDir = new URL('../drills', import.meta.url).pathname;
const files = readdirSync(drillsDir).filter((f) => f.endsWith('.json'));

const index = files.map((file) => {
  const raw = JSON.parse(readFileSync(join(drillsDir, file), 'utf8'));
  const { id, name, contributor, difficulty, default_bpm, tags, description } =
    raw.metadata;
  return description !== undefined
    ? { id, name, contributor, difficulty, default_bpm, tags, description }
    : { id, name, contributor, difficulty, default_bpm, tags };
});

writeFileSync(
  new URL('../index.json', import.meta.url).pathname,
  JSON.stringify(index, null, 2) + '\n',
);

console.log(`Built index.json with ${index.length} drills.`);
