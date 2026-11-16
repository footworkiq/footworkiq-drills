// Shared copy-lint rules (app Phase 47, CUE-02, D-09).
//
// docs/schema/copy-rules.json is a byte copy of the app's canonical file; the
// app's `npm run check:schema-drift` checks it. Do not edit the phrases here or
// in the JSON: change them in the app and copy the file across.
//
// Pure functions and frozen constants only: no exits, no writes. The rules and
// the allow-list are read once at module load. validate-drills.js,
// validate-cards.js and test/copy-lints.test.js all import this module, so CI
// and the tests can never disagree about a rule.
//
// The matcher is built exactly like the app's (scripts/lib/copyLint.cjs): each
// phrase becomes one case-insensitive regex with (?<![A-Za-z0-9]) and
// (?![A-Za-z0-9]) look-arounds, and a space or hyphen in a phrase matches any
// run of whitespace or hyphens. "FootworkIQ" and "booster" do not match.
//
// Text that is checked (user-facing copy):
//   cards  title, text, tip, every options[].text, every options[].why, and
//          scan.prompt when present
//   drills metadata.name, metadata.description and every metadata.tags[]
//          (the schema's other metadata strings are ids, enums, a URI or a
//          contributor handle)
//
// Exceptions: docs/copy-allowlist.json, an array of { "text", "reason" }, the
// same entries as the app's. An entry suppresses only a string that equals its
// text exactly. There is no inline-disable mechanism.
//
// Issue shape: { rule: 'copy-claim', field: string, phrase: string, message: string }
// field is a path such as 'options[0].why' or 'metadata.name'.
import { readFileSync } from 'fs';

const rulesPath = new URL('../../docs/schema/copy-rules.json', import.meta.url);
const allowlistPath = new URL('../../docs/copy-allowlist.json', import.meta.url);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The parsed shared rules: { version, phrases, vectors: { flag, pass } }. */
export const COPY_RULES = deepFreeze(JSON.parse(readFileSync(rulesPath, 'utf8')));

/** The allow-list: [{ text, reason }]. */
export const COPY_ALLOWLIST = deepFreeze(JSON.parse(readFileSync(allowlistPath, 'utf8')));

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One case-insensitive, word-bounded regex per phrase; space or hyphen between words. */
export function compileRules(phrases) {
  return Object.freeze(
    phrases.map((phrase) =>
      Object.freeze({
        phrase,
        re: new RegExp(
          '(?<![A-Za-z0-9])' + escapeRegExp(phrase).replace(/[ -]/g, '[\\s-]+') + '(?![A-Za-z0-9])',
          'i',
        ),
      }),
    ),
  );
}

/** The phrases (in rules order) that occur in text. */
export function findPhrases(text, compiled) {
  const hits = [];
  for (const rule of compiled) if (rule.re.test(text)) hits.push(rule.phrase);
  return hits;
}

const COMPILED = compileRules(COPY_RULES.phrases);
const ALLOWED = new Set(COPY_ALLOWLIST.map((e) => e.text));

function lintStrings(entries) {
  const issues = [];
  for (const [field, text] of entries) {
    if (typeof text !== 'string' || ALLOWED.has(text)) continue;
    for (const phrase of findPhrases(text, COMPILED)) {
      issues.push({
        rule: 'copy-claim',
        field,
        phrase,
        message: `${field}: "${phrase}" is a banned claim phrase (docs/schema/copy-rules.json) in "${text}"`,
      });
    }
  }
  return issues;
}

/** Copy-claim issues in one decision card. */
export function lintCardCopy(card) {
  const entries = [
    ['title', card?.title],
    ['text', card?.text],
    ['tip', card?.tip],
  ];
  (Array.isArray(card?.options) ? card.options : []).forEach((option, i) => {
    entries.push([`options[${i}].text`, option?.text]);
    entries.push([`options[${i}].why`, option?.why]);
  });
  if (card?.scan && typeof card.scan === 'object') entries.push(['scan.prompt', card.scan.prompt]);
  return lintStrings(entries);
}

/** Copy-claim issues in one drill. */
export function lintDrillCopy(drill) {
  const meta = drill?.metadata ?? {};
  const entries = [
    ['metadata.name', meta.name],
    ['metadata.description', meta.description],
  ];
  (Array.isArray(meta.tags) ? meta.tags : []).forEach((tag, i) => {
    entries.push([`metadata.tags[${i}]`, tag]);
  });
  return lintStrings(entries);
}
