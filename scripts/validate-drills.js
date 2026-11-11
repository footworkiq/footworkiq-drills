import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { lintDrill } from './lib/drill-lints.js';

// Usage: node scripts/validate-drills.js [--dir <path>]
// Each drill must pass the JSON Schema (Ajv) and then the grid-aware lints in
// ./lib/drill-lints.js. Lints run only on schema-valid drills.

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
const drillsDir = dirArg
  ? resolve(process.cwd(), dirArg)
  : new URL('../drills', import.meta.url).pathname;
const schemaPath = new URL('../docs/schema/drill.schema.json', import.meta.url).pathname;

// validateSchema: false — skip meta-schema lookup for the $schema declaration
const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
delete schema['$schema']; // prevent AJV meta-schema lookup — constraints still fully enforced
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
    continue;
  }
  const issues = lintDrill(data);
  if (issues.length > 0) {
    console.error(`FAIL ${file}:`);
    for (const issue of issues) {
      console.error(`  ${issue.message}`);
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
