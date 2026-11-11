// Writes docs/schema/drill.strict-schema.<grid>.json for every new grid from
// the 2x3 template. Run after changing the template or the grid contract:
//   npm run build-strict-schemas
// test/strict-schemas.test.js fails if the committed files are stale.
import { readFileSync, writeFileSync } from 'fs';
import { STRICT_GRIDS, buildStrictSchema } from './lib/strict-schema.js';

const schemaDir = new URL('../docs/schema/', import.meta.url);
const template = JSON.parse(readFileSync(new URL('drill.strict-schema.json', schemaDir), 'utf8'));

for (const grid of STRICT_GRIDS) {
  const file = `drill.strict-schema.${grid}.json`;
  writeFileSync(new URL(file, schemaDir), JSON.stringify(buildStrictSchema(template, grid), null, 2) + '\n');
  console.log(`Wrote docs/schema/${file}`);
}
