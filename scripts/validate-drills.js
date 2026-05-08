import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const drillsDir = new URL('../drills', import.meta.url).pathname;
const schemaPath = new URL('../docs/schema/drill.schema.json', import.meta.url).pathname;

// validateSchema: false — skip meta-schema lookup for the $schema declaration
const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

const files = readdirSync(drillsDir).filter((f) => f.endsWith('.json'));
let failed = 0;

for (const file of files) {
  const filePath = join(drillsDir, file);
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON — ${e.message}`);
    failed++;
    continue;
  }
  const valid = validate(data);
  if (!valid) {
    console.error(`FAIL ${file}:`);
    for (const err of validate.errors) {
      console.error(`  ${err.instancePath || '/'} ${err.message}`);
    }
    failed++;
  } else {
    console.log(`OK   ${file}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} drill(s) valid.`);
