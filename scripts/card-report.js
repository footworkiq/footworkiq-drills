// Before/after audit report for decision cards (D-01, D-07).
//
// Prints markdown to stdout: deck metrics (all, outfield, per category), deck
// lints, a per-card table and, with --base, a per-card diff against a git ref
// (options matched by option id, so a reorder never looks like a regrade).
// --json prints only the metrics object, for automated checks.
//
// All metrics come from scripts/lib/card-lints.js (deckStats, lintDeck,
// optionBalance), the same code validate-cards.js runs in CI, so the report
// and CI can never disagree. This script writes nothing to disk.
//
// --base is passed to git as an argv element (execFileSync, no shell) and must
// resolve to a commit (rev-parse --verify ^{commit}) before it is used.
//
// Usage: node scripts/card-report.js [--dir <path>] [--base <git-ref>] [--category attack|defend|mindset] [--all] [--json]
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { basename, join, resolve } from 'path';
import { deckStats, lintDeck, optionBalance } from './lib/card-lints.js';
import { isSeededOrder } from './lib/reorder.js';

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

const CATEGORIES = ['attack', 'defend', 'mindset'];
const BASE_CARDS_DIR = 'cards/decision';
const repoRoot = new URL('..', import.meta.url).pathname;

const dirArg = argValue('--dir');
const baseRef = argValue('--base');
const category = argValue('--category');
const showAll = process.argv.includes('--all');
const asJson = process.argv.includes('--json');
const cardsDir = dirArg
  ? resolve(process.cwd(), dirArg)
  : new URL('../cards/decision', import.meta.url).pathname;

if (category !== undefined && !CATEGORIES.includes(category)) {
  console.error(`Unknown --category ${category} (use attack, defend or mindset)`);
  process.exit(1);
}

const files = readdirSync(cardsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const cards = [];
for (const file of files) {
  try {
    cards.push(JSON.parse(readFileSync(join(cardsDir, file), 'utf8')));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON (${e.message})`);
    process.exit(1);
  }
}

// --- metrics ---------------------------------------------------------------

function stats(subset) {
  return { ...deckStats(subset), notSeeded: subset.filter((c) => !isSeededOrder(c)).length };
}

const metrics = {
  all: stats(cards),
  outfield: stats(cards.filter((c) => c.role === 'outfield')),
  byCategory: Object.fromEntries(CATEGORIES.map((k) => [k, stats(cards.filter((c) => c.category === k))])),
};

if (asJson) {
  console.log(JSON.stringify(metrics, null, 2));
  process.exit(0);
}

// --- helpers ---------------------------------------------------------------

/** Natural order for legacy ids: a1, a2, ... a10. */
function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true });
}

const cell = (v) =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

function row(values) {
  return `| ${values.map(cell).join(' | ')} |`;
}

function table(headers, rows) {
  return [row(headers), row(headers.map(() => '---')), ...rows.map(row)].join('\n');
}

const share = (count, n) => (n > 0 ? `${count}/${n} (${Math.round((count / n) * 100)}%)` : '0/0');

const bestIndex = (card) => card.options.findIndex((o) => o.grade === 'best');

/** longest / middle / shortest; ties count as longest. */
function bestLengthRank(card) {
  const bal = optionBalance(card);
  const len = bal.lengths[bestIndex(card)];
  if (len === bal.longest) return 'longest';
  if (len === bal.shortest) return 'shortest';
  return 'middle';
}

const canonicalText = (card) => JSON.stringify(card, null, 2) + '\n';

// --- deck metrics ----------------------------------------------------------

const out = [];
out.push('## Deck metrics', '');
const metricRows = [
  ['All', metrics.all],
  ['Outfield', metrics.outfield],
  ...CATEGORIES.map((k) => [k, metrics.byCategory[k]]),
].map(([label, s]) => [
  label,
  s.n,
  share(s.bestLongest, s.n),
  share(s.bestShortest, s.n),
  s.bestPositions.join('/'),
  s.ratioFails,
  s.bestPoorPoor,
  s.untagged,
  s.notSeeded,
  s.medianRatio,
  s.maxRatio,
]);
out.push(
  table(
    [
      'subset',
      'cards',
      'best longest',
      'best shortest',
      'best position first/middle/last',
      'ratio fails',
      'best/poor/poor',
      'untagged',
      'not seeded',
      'median ratio',
      'max ratio',
    ],
    metricRows,
  ),
  '',
);

// --- deck lints ------------------------------------------------------------

out.push('## Deck lints', '');
const deckIssues = lintDeck(cards);
if (deckIssues.length === 0) out.push('- none');
for (const i of deckIssues) out.push(`- [${i.rule}] ${i.path}: ${i.message}`);
out.push('');

// --- cards -----------------------------------------------------------------

const shown = cards
  .filter((c) => category === undefined || c.category === category)
  .sort((a, b) => naturalCompare(a.legacy_id, b.legacy_id));

out.push('## Cards', '');
out.push(
  table(
    [
      'legacy_id',
      'id',
      'rev',
      'grades',
      'option lengths',
      'ratio',
      'ratio ok',
      'best length rank',
      'best stored position',
      'age_band',
      'role',
      'difficulty',
      'tags',
    ],
    shown.map((c) => {
      const bal = optionBalance(c);
      return [
        c.legacy_id,
        c.id,
        c.rev,
        c.options.map((o) => o.grade).join('/'),
        bal.lengths.join('/'),
        bal.ratio.toFixed(2),
        bal.fails ? 'FAIL' : 'ok',
        bestLengthRank(c),
        bestIndex(c) + 1,
        c.age_band,
        c.role,
        c.difficulty,
        (c.tags ?? []).join(', '),
      ];
    }),
  ),
  '',
);

// --- changes vs base -------------------------------------------------------

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

const SCALAR_FIELDS = ['title', 'text', 'tip', 'age_band', 'role', 'difficulty', 'tags'];
const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v ?? '(none)'));

if (baseRef) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  } catch {
    console.error(`FAIL --base ${baseRef}: not a commit in this repository (fetch it first)`);
    process.exit(1);
  }

  const baseFiles = new Set(
    git(['ls-tree', '--name-only', baseRef, `${BASE_CARDS_DIR}/`])
      .split('\n')
      .map((p) => basename(p))
      .filter((f) => f.endsWith('.json')),
  );

  out.push(`## Changes vs ${baseRef}`, '');
  let sections = 0;
  for (const card of shown) {
    const file = `${card.id}.json`;
    let before = null;
    if (baseFiles.has(file)) {
      const baseText = showAtBase(`${BASE_CARDS_DIR}/${file}`);
      try {
        before = baseText === null ? null : JSON.parse(baseText);
      } catch {
        before = null;
      }
    }
    if (before && !showAll && canonicalText(before) === canonicalText(card)) continue;
    sections++;

    if (!before) {
      out.push(`### ${card.legacy_id} ${card.id} (new card)`, '');
    } else {
      out.push(`### ${card.legacy_id} ${card.id} (rev ${before.rev} → ${card.rev})`, '');
      for (const f of SCALAR_FIELDS) {
        if (JSON.stringify(before[f]) !== JSON.stringify(card[f])) {
          out.push(`- ${f}: ${fmt(before[f])} → ${fmt(card[f])}`);
        }
      }
    }

    const oldById = new Map((before?.options ?? []).map((o) => [o.id, o]));
    const newById = new Map(card.options.map((o) => [o.id, o]));
    const ids = [...card.options.map((o) => o.id), ...[...oldById.keys()].filter((id) => !newById.has(id))];
    let gradeChanged = false;
    const optRows = ids.map((id) => {
      const o = oldById.get(id);
      const n = newById.get(id);
      if (before && o?.grade !== n?.grade) gradeChanged = true;
      return [
        id,
        `${o?.grade ?? '-'} → ${n?.grade ?? '-'}`,
        o?.text ?? '-',
        n?.text ?? '-',
        n ? n.text.length : '-',
        n?.why ?? '-',
      ];
    });
    out.push('', table(['id', 'grade', 'old text', 'new text', 'new length', 'new why'], optRows), '');

    const bal = optionBalance(card);
    const revBumped = before ? card.rev > before.rev : false;
    out.push(
      `ratio ${bal.ratio.toFixed(2)} (${bal.fails ? 'FAIL' : 'ok'}) · ` +
        `best is longest: ${bestLengthRank(card) === 'longest' ? 'yes' : 'no'} · ` +
        `best stored position: ${bestIndex(card) + 1}/3 · ` +
        `grade changed: ${gradeChanged ? 'yes' : 'no'} · ` +
        `rev bumped: ${revBumped ? 'yes' : 'no'}`,
      '',
    );
  }
  if (sections === 0) out.push('- no changes', '');
}

console.log(out.join('\n'));
