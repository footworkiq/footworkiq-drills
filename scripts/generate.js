// Generate a drill with OpenAI structured outputs.
//
//   npm run generate -- [--grid 3x3|3x4|4x4] [--out <dir>] [--force] "<concept>"
//
// Without --grid this is the original 2x3 generator (same strict schema and
// prompt, D-08). With --grid it uses that grid's strict schema
// (docs/schema/drill.strict-schema.<grid>.json) and prompt (D-09). Every
// drill must pass the full schema (Ajv) and then the grid lints before it is
// written (D-10). Set OPENAI_MODEL to override the model (default gpt-4o).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, relative } from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import OpenAI from 'openai';
import { lintDrill } from './lib/drill-lints.js';
import {
  modelName,
  parseArgs,
  postProcess,
  strictSchemaPathFor,
  systemPrompt,
  usedCellNames,
} from './lib/generate-lib.js';

const USAGE =
  'Usage: npm run generate -- [--grid 3x3|3x4|4x4] [--out <dir>] [--force] "<drill concept, e.g. cruyff-turn intermediate ball-control>"';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  console.error(USAGE);
  process.exit(1);
}

if (!args.concept) {
  console.error(USAGE);
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. export OPENAI_API_KEY=sk-... and retry.');
  process.exit(1);
}

const fullSchemaPath = new URL('../docs/schema/drill.schema.json', import.meta.url).pathname;
const fullSchemaRaw = JSON.parse(readFileSync(fullSchemaPath, 'utf8'));
const strictSchema = JSON.parse(readFileSync(strictSchemaPathFor(args.grid), 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
delete fullSchemaRaw['$schema'];
const validate = ajv.compile(fullSchemaRaw);

const client = new OpenAI({ apiKey });

const userPrompt = `Generate a drill for this concept: ${args.concept}`;

const completion = await client.chat.completions.parse({
  model: modelName(process.env),
  messages: [
    { role: 'system', content: systemPrompt(args.grid) },
    { role: 'user', content: userPrompt }
  ],
  response_format: { type: 'json_schema', json_schema: strictSchema }
});

const choice = completion.choices[0];
if (choice.message.refusal) {
  console.error('Model refused:', choice.message.refusal);
  process.exit(1);
}

const drill = postProcess(choice.message.parsed);

const ok = validate(drill);
if (!ok) {
  console.error('Generated drill failed AJV validation against drill.schema.json:');
  for (const err of validate.errors) {
    console.error(`  ${err.instancePath || '/'} ${err.message}`);
  }
  console.error('\nNot writing to disk. Re-run to try again.');
  process.exit(1);
}

// Grid lints (D-10). lintDrill returns [] for 2x3, so the no --grid path is unchanged.
const issues = lintDrill(drill);
if (issues.length > 0) {
  console.error('Generated drill failed the grid lints:');
  for (const i of issues) {
    console.error(`  ${i.message}`);
  }
  console.error('\nNot writing to disk. Re-run to try again.');
  process.exit(1);
}

const outDir = args.out ? resolve(process.cwd(), args.out) : new URL('../drills', import.meta.url).pathname;
const outPath = join(outDir, `${drill.metadata.id}.json`);
const shownPath = args.out ? relative(process.cwd(), outPath) || outPath : `drills/${drill.metadata.id}.json`;

if (existsSync(outPath) && !args.force) {
  console.error(`Refusing to overwrite existing ${shownPath}. Re-run with a different concept or pass --force.`);
  process.exit(1);
}

if (args.out) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(drill, null, 2) + '\n');

console.log(`\nWrote ${shownPath}`);
console.log(`  Beats:      ${drill.sequence.length}`);
if (args.grid) {
  console.log(`  Grid:       ${args.grid.replace('x', '×')}`);
  console.log(`  Cells used: ${usedCellNames(drill).join(', ')}`);
} else {
  const zones = new Set();
  for (const s of drill.sequence) {
    if (typeof s.left_foot?.pos === 'number') zones.add(s.left_foot.pos);
    if (typeof s.right_foot?.pos === 'number') zones.add(s.right_foot.pos);
  }
  console.log(`  Zones used: ${[...zones].sort((a, b) => a - b).join(', ')}`);
}
console.log(`  Difficulty: ${drill.metadata.difficulty} @ ${drill.metadata.default_bpm} BPM`);
console.log(`\nPlay-test on device before committing.`);
if (args.grid) {
  console.log('New-grid drills need an app version that supports schema 1.1 before they merge.');
}
