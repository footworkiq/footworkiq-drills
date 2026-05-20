import { readFileSync, writeFileSync, existsSync } from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import OpenAI from 'openai';

const fullSchemaPath = new URL('../docs/schema/drill.schema.json', import.meta.url).pathname;
const strictSchemaPath = new URL('../docs/schema/drill.strict-schema.json', import.meta.url).pathname;

const fullSchemaRaw = JSON.parse(readFileSync(fullSchemaPath, 'utf8'));
const strictSchema = JSON.parse(readFileSync(strictSchemaPath, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
delete fullSchemaRaw['$schema'];
const validate = ajv.compile(fullSchemaRaw);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. export OPENAI_API_KEY=sk-... and retry.');
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const forceFlag = rawArgs.includes('--force');
const conceptArgs = rawArgs.filter(a => a !== '--force');
const concept = conceptArgs.join(' ').trim();

if (!concept) {
  console.error('Usage: npm run generate -- "<drill concept, e.g. cruyff-turn intermediate ball-control>"');
  process.exit(1);
}

const client = new OpenAI({ apiKey });

const systemPrompt = `You design football footwork drills for the OpenMat training mat.

THE MAT (from the player's perspective, looking down at their feet):
  A 6-zone grid, 3 columns x 2 rows. Zone 1 is the bottom-centre HOME position
  (nearest the player). Coordinates are screen-space, Y increases DOWNWARD.

    +-----+-----+-----+
    |  3  |  4  |  5  |   far row  (top of screen, y = 0.3)
    +-----+-----+-----+
    |  2  |  1  |  6  |   near row (bottom of screen, y = 0.7)
    +-----+-----+-----+
       x=0.2 x=0.5 x=0.8

  Zone 1 = bottom centre (home)
  Zone 2 = bottom left
  Zone 3 = top left
  Zone 4 = top centre
  Zone 5 = top right
  Zone 6 = bottom right

FOOT ACTIONS (closed enum, do not invent):
  PLANT          - stationary weight-bearing foot
  STEP           - simple step to target zone
  INSIDE_TOUCH   - inside-of-foot touch on the ball
  OUTSIDE_TOUCH  - outside-of-foot touch on the ball
  SOLE_ROLL      - sole roll across the ball
  TAP            - quick tap on the ball
  DRAG           - drag ball with sole
  STEP_OVER      - scissors / step-over feint (foot crosses over ball without touching)
  LIFT           - foot leaves the mat (e.g., in the air)

BALL ACTIONS (closed enum):
  STILL  - ball does not move
  ROLL   - ball rolls between zones (use from and to)
  PUSH   - ball pushed to a new zone (use from and to)
  LIFT   - ball is in the air

RULES:
  - Foot positions must be physically coherent: feet should not occupy the same zone
    simultaneously unless one is TAP/STEP_OVER/LIFT.
  - The ball moves continuously: if beat N has ball at zone A and beat N+1 at zone B,
    beat N+1 must use ROLL or PUSH with from=A, to=B.
  - License is always "CC0". Contributor is "FootworkIQ-AI".
  - Use kebab-case for the drill id, matching the file naming convention.
  - reps = 4, sets = 3, count_in = 1 are sensible defaults unless the concept demands otherwise.
  - time_signature is almost always "4/4" — use this unless explicitly asked.
  - subdivision = 1 (quarter notes) by default. Use 2 (eighths) for fast drills only.
`;

const userPrompt = `Generate a drill for this concept: ${concept}`;

const completion = await client.chat.completions.parse({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ],
  response_format: { type: 'json_schema', json_schema: strictSchema }
});

const choice = completion.choices[0];
if (choice.message.refusal) {
  console.error('Model refused:', choice.message.refusal);
  process.exit(1);
}

const drill = choice.message.parsed;

for (const step of drill.sequence) {
  if (step.ball && step.ball.action !== 'ROLL' && step.ball.action !== 'PUSH') {
    delete step.ball.from;
    delete step.ball.to;
  }
}

const ok = validate(drill);
if (!ok) {
  console.error('Generated drill failed AJV validation against drill.schema.json:');
  for (const err of validate.errors) {
    console.error(`  ${err.instancePath || '/'} ${err.message}`);
  }
  console.error('\nNot writing to disk. Re-run to try again.');
  process.exit(1);
}

const outPath = new URL(`../drills/${drill.metadata.id}.json`, import.meta.url).pathname;

if (existsSync(outPath) && !forceFlag) {
  console.error(`Refusing to overwrite existing drills/${drill.metadata.id}.json. Re-run with a different concept or pass --force.`);
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(drill, null, 2) + '\n');

const zones = new Set();
for (const s of drill.sequence) {
  if (typeof s.left_foot?.pos === 'number') zones.add(s.left_foot.pos);
  if (typeof s.right_foot?.pos === 'number') zones.add(s.right_foot.pos);
}

console.log(`\nWrote drills/${drill.metadata.id}.json`);
console.log(`  Beats:      ${drill.sequence.length}`);
console.log(`  Zones used: ${[...zones].sort((a, b) => a - b).join(', ')}`);
console.log(`  Difficulty: ${drill.metadata.difficulty} @ ${drill.metadata.default_bpm} BPM`);
console.log(`\nPlay-test on device before committing.`);
