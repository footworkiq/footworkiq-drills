// Unit tests for scripts/lib/generate-lib.js (CONTENT-05, D-08..D-10).
// Everything here runs offline: no OpenAI calls, no file writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import {
  LEGACY_SYSTEM_PROMPT,
  asciiMat,
  modelName,
  parseArgs,
  postProcess,
  strictSchemaPathFor,
  systemPrompt,
  usedCellNames,
} from '../scripts/lib/generate-lib.js';

const repoRoot = new URL('..', import.meta.url).pathname;

// ---------------------------------------------------------------- parseArgs

test('parseArgs reads --grid <g> and joins the concept', () => {
  assert.deepEqual(parseArgs(['--grid', '3x4', 'cruyff', 'turn']), {
    force: false,
    grid: '3x4',
    out: null,
    concept: 'cruyff turn',
  });
});

test('parseArgs reads --grid=<g> and --force', () => {
  const a = parseArgs(['--grid=4x4', '--force', 'x']);
  assert.equal(a.grid, '4x4');
  assert.equal(a.force, true);
  assert.equal(a.concept, 'x');
});

test('parseArgs reads --out <dir> and --out=<dir>', () => {
  assert.equal(parseArgs(['--out', 'tmp-out', 'x']).out, 'tmp-out');
  assert.equal(parseArgs(['--out=elsewhere', 'x']).out, 'elsewhere');
  assert.equal(parseArgs(['--out', 'tmp-out', 'x']).concept, 'x');
});

test('parseArgs without --grid gives grid null (2x3)', () => {
  const a = parseArgs(['x']);
  assert.equal(a.grid, null);
  assert.equal(a.out, null);
  assert.equal(a.force, false);
});

test('parseArgs rejects unknown grids and 2x3 with a clear message', () => {
  for (const argv of [['--grid', '5x5', 'x'], ['--grid', '2x3', 'x'], ['--grid=9x9', 'x'], ['--grid']]) {
    assert.throws(
      () => parseArgs(argv),
      (e) => e.message.includes('--grid must be 3x3, 3x4 or 4x4') && e.message.includes('omit it for 2x3'),
    );
  }
});

// ---------------------------------------------------------------- prompts

test('systemPrompt(null) is the legacy 2x3 prompt', () => {
  assert.equal(systemPrompt(null), LEGACY_SYSTEM_PROMPT);
  assert.equal(systemPrompt(undefined), LEGACY_SYSTEM_PROMPT);
});

// Pinned to the last commit before the grid refactor: main now holds the
// refactored generate.js, which no longer has the inline prompt.
const PRE_GRID_GENERATOR = 'dedbb92';

test('LEGACY_SYSTEM_PROMPT is byte-identical to the pre-grid prompt in scripts/generate.js', (t) => {
  let src;
  try {
    src = execFileSync('git', ['show', `${PRE_GRID_GENERATOR}:scripts/generate.js`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    t.skip(`${PRE_GRID_GENERATOR} is not available locally`);
    return;
  }
  const start = src.indexOf('const systemPrompt = `');
  assert.ok(start >= 0, 'pre-grid generate.js has a systemPrompt template literal');
  const bodyStart = start + 'const systemPrompt = `'.length;
  const end = src.indexOf('`;', bodyStart);
  assert.equal(LEGACY_SYSTEM_PROMPT, src.slice(bodyStart, end));
});

test('systemPrompt(3x4) has the mat, cell rules and actions, and no zones or {x, y}', () => {
  const p = systemPrompt('3x4');
  assert.ok(p.includes(asciiMat('3x4')));
  for (const s of ['near row', 'A1', 'D3', 'ROLL', 'PUSH', 'TAP', 'STEP_OVER', 'LIFT', '"row"', '"col"', '"1.1"', '"3x4"']) {
    assert.ok(p.includes(s), `prompt mentions ${s}`);
  }
  assert.ok(!p.includes('Zone 1'));
  assert.ok(!p.includes('"x"'));
});

test('systemPrompt differs per grid', () => {
  assert.notEqual(systemPrompt('3x3'), systemPrompt('4x4'));
  assert.ok(systemPrompt('4x4').includes('D4'));
  assert.ok(!systemPrompt('3x3').includes('D3'));
});

test('asciiMat(3x3) puts the far row on top and marks the near row', () => {
  const lines = asciiMat('3x3').split('\n');
  const cellLines = lines.filter((l) => l.includes('[ '));
  assert.equal(cellLines.length, 3);
  assert.match(cellLines[0], /^\s*3\s/);
  assert.ok(cellLines[0].includes('[ A3 ]') && cellLines[0].includes('[ C3 ]'));
  assert.match(cellLines[2], /^\s*1\s/);
  assert.ok(cellLines[2].includes('[ A1 ]'));
  assert.ok(cellLines[2].includes('(near row, your feet)'));
  assert.ok(!cellLines[0].includes('(near row, your feet)'));
  const header = lines.find((l) => /\bA\b/.test(l) && !l.includes('['));
  assert.match(header, /A\s+B\s+C\s*$/);
});

test('asciiMat(4x4) has 4 rows and 4 columns', () => {
  const cellLines = asciiMat('4x4').split('\n').filter((l) => l.includes('[ '));
  assert.equal(cellLines.length, 4);
  assert.ok(cellLines[0].includes('[ D4 ]'));
});

// ---------------------------------------------------------------- schema path

test('strictSchemaPathFor picks the template for 2x3 and the grid file otherwise', () => {
  assert.ok(strictSchemaPathFor(null).endsWith('docs/schema/drill.strict-schema.json'));
  assert.ok(strictSchemaPathFor('3x3').endsWith('docs/schema/drill.strict-schema.3x3.json'));
  for (const g of [null, '3x3', '3x4', '4x4']) {
    JSON.parse(readFileSync(strictSchemaPathFor(g), 'utf8'));
  }
});

// ---------------------------------------------------------------- postProcess

test('postProcess drops ball from/to unless ROLL or PUSH', () => {
  const cell = (row, col) => ({ row, col });
  const drill = {
    sequence: [
      { beat: 1, ball: { pos: cell(1, 1), action: 'STILL', from: cell(1, 1), to: cell(1, 1) } },
      { beat: 2, ball: { pos: cell(1, 2), action: 'ROLL', from: cell(1, 1), to: cell(1, 2) } },
      { beat: 3, ball: { pos: cell(2, 2), action: 'PUSH', from: cell(1, 2), to: cell(2, 2) } },
      { beat: 4, ball: { pos: cell(2, 2), action: 'LIFT', from: cell(2, 2), to: cell(2, 2) } },
      { beat: 5 },
    ],
  };
  const out = postProcess(drill);
  assert.equal(out, drill);
  assert.deepEqual(Object.keys(drill.sequence[0].ball), ['pos', 'action']);
  assert.ok('from' in drill.sequence[1].ball && 'to' in drill.sequence[1].ball);
  assert.ok('from' in drill.sequence[2].ball && 'to' in drill.sequence[2].ball);
  assert.deepEqual(Object.keys(drill.sequence[3].ball), ['pos', 'action']);
});

// ---------------------------------------------------------------- model

test('modelName defaults to gpt-4o and honours OPENAI_MODEL', () => {
  assert.equal(modelName({}), 'gpt-4o');
  assert.equal(modelName({ OPENAI_MODEL: 'gpt-6-luna' }), 'gpt-6-luna');
});

// ---------------------------------------------------------------- usedCellNames

test('usedCellNames lists the sorted unique cells of feet and ball', () => {
  const sample = JSON.parse(
    readFileSync(new URL('./fixtures/strict/3x3-sample.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(usedCellNames(sample), ['A1', 'B1', 'B2', 'C1']);
});
