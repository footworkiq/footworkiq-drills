// Beat-level before/after report for drill fixes (Phase 46 D-09).
//
// For every drills/*.json whose text differs from the same file at --base,
// prints a markdown section with the lint rules the change cleared (lintDrill
// on the base version), any metadata edits (a fix should have none, D-08) and
// one table row per changed marker per beat. Drill files added or removed
// since --base are listed under "Not a fix". The last line is the count.
//
// The lint results come from scripts/lib/drill-lints.js, the same code
// validate-drills.js runs in CI. This script writes nothing to disk.
//
// --base is passed to git as an argv element (execFileSync, no shell) and must
// resolve to a commit (rev-parse --verify ^{commit}) before it is used.
//
// Usage: node scripts/drill-diff.js --base <git-ref>
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { lintDrill } from './lib/drill-lints.js';

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

const BASE_DRILLS_DIR = 'drills';
const repoRoot = new URL('..', import.meta.url).pathname;
const drillsDir = join(repoRoot, BASE_DRILLS_DIR);

const baseRef = argValue('--base');
if (baseRef === undefined) {
  console.error('Usage: node scripts/drill-diff.js --base <git-ref>');
  process.exit(1);
}

/** Run git in the repo root; returns stdout, or throws with git's message. */
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function showAtBase(path) {
  try {
    return git(['show', `${baseRef}:${path}`]);
  } catch {
    return null;
  }
}

try {
  git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
} catch {
  console.error(`FAIL --base ${baseRef}: not a commit in this repository (fetch it first)`);
  process.exit(1);
}

// --- rendering ---------------------------------------------------------------

const MARKERS = [
  ['left_foot', 'left foot'],
  ['right_foot', 'right foot'],
  ['ball', 'ball'],
];

/** Zone integer, rRcC for a cell, or x,y. */
function fmtPos(p) {
  if (p === undefined || p === null) return '?';
  if (typeof p === 'number') return String(p);
  if (typeof p === 'object' && 'row' in p && 'col' in p) return `r${p.row}c${p.col}`;
  if (typeof p === 'object' && 'x' in p && 'y' in p) return `${p.x},${p.y}`;
  return JSON.stringify(p);
}

function fmtMarker(m) {
  if (!m) return '(none)';
  let s = `${fmtPos(m.pos)} ${m.action ?? '?'}`;
  if (m.from !== undefined || m.to !== undefined) s += ` (${fmtPos(m.from)} → ${fmtPos(m.to)})`;
  return s;
}

const fmtValue = (v) => (v === undefined ? '(none)' : Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function byBeat(drill) {
  const m = new Map();
  for (const step of drill.sequence ?? []) m.set(step.beat, step);
  return m;
}

// --- compare -----------------------------------------------------------------

const currentFiles = readdirSync(drillsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const baseFiles = new Set(
  git(['ls-tree', '--name-only', baseRef, `${BASE_DRILLS_DIR}/`])
    .split('\n')
    .map((p) => basename(p))
    .filter((f) => f.endsWith('.json')),
);

const out = [`## Drill changes vs ${baseRef}`, ''];
const notAFix = [];
let changed = 0;

for (const file of currentFiles) {
  if (!baseFiles.has(file)) {
    notAFix.push(`- added: ${BASE_DRILLS_DIR}/${file}`);
    continue;
  }
  const afterText = readFileSync(join(drillsDir, file), 'utf8');
  const beforeText = showAtBase(`${BASE_DRILLS_DIR}/${file}`);
  if (beforeText === null || beforeText === afterText) continue;

  let before;
  let after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch (e) {
    out.push(`### ${file}`, '', `Invalid JSON on one side (${e.message}).`, '');
    changed++;
    continue;
  }
  changed++;

  const id = after.metadata?.id ?? file.replace(/\.json$/, '');
  out.push(`### ${id}`, '');

  // (a) rules cleared
  const cleared = lintDrill(before);
  out.push('Rules cleared:');
  if (cleared.length === 0) out.push('- none');
  for (const i of cleared) out.push(`- ${i.rule}: ${i.message}`);
  const remaining = lintDrill(after);
  if (remaining.length > 0) {
    out.push('', 'Still failing:');
    for (const i of remaining) out.push(`- ${i.rule}: ${i.message}`);
  }
  out.push('');

  // (b) metadata changes
  const mb = before.metadata ?? {};
  const ma = after.metadata ?? {};
  const keys = [...new Set([...Object.keys(mb), ...Object.keys(ma)])];
  const metaChanges = keys.filter((k) => !same(mb[k], ma[k]));
  out.push('Metadata changes:');
  if (metaChanges.length === 0) out.push('- none');
  for (const k of metaChanges) out.push(`- ${k}: ${fmtValue(mb[k])} -> ${fmtValue(ma[k])}`);
  for (const k of ['schema']) {
    if (!same(before[k], after[k])) out.push(`- (top level) ${k}: ${fmtValue(before[k])} -> ${fmtValue(after[k])}`);
  }
  out.push('');

  // (c) per-beat marker table
  const bb = byBeat(before);
  const ba = byBeat(after);
  const beats = [...new Set([...bb.keys(), ...ba.keys()])].sort((a, b) => a - b);
  const rows = [];
  for (const beat of beats) {
    const sb = bb.get(beat);
    const sa = ba.get(beat);
    for (const [key, label] of MARKERS) {
      const b = sb?.[key];
      const a = sa?.[key];
      if (same(b, a)) continue;
      rows.push(`| ${beat} | ${label} | ${sb ? fmtMarker(b) : '(no beat)'} | ${sa ? fmtMarker(a) : '(no beat)'} |`);
    }
  }
  if (rows.length === 0) {
    out.push('No marker changes (formatting only).', '');
  } else {
    out.push('| beat | marker | before | after |', '|------|--------|--------|-------|', ...rows, '');
  }
}

const current = new Set(currentFiles);
for (const file of [...baseFiles].sort()) {
  if (!current.has(file)) notAFix.push(`- removed: ${BASE_DRILLS_DIR}/${file}`);
}

out.push('## Not a fix', '');
out.push(...(notAFix.length ? notAFix : ['- none']), '');
out.push(`${changed} drill(s) changed`);

console.log(out.join('\n'));
