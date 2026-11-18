// Scene-word lints for scan cards (app Phase 50, CARD-08, D-14/D-15).
//
// docs/schema/scan-rules.json and docs/scan-allowlist.json are byte copies of
// the app's canonical files; the app's `npm run check:schema-drift` checks
// scan-rules.json. Do not edit the words here or in the JSON: change them in
// the app and copy the files across.
//
// Pure functions and frozen constants only: no exits, no writes. The rules and
// the allow-list are read once at module load. validate-cards.js and
// test/scan-lints.test.js both import this module, and the test runs the same
// flag/pass vectors as the app's matcher (scripts/lib/scanLint.cjs), so the
// two repos can never disagree about a rule.
//
// A scan prompt gives the situation, not the scene: the player has to look to
// find out who is free.
//
// What is checked (scan cards only; a card without `scan` returns []):
//   scan.prompt      sceneWords + player counts   -> scan-prompt-word
//                    longer than promptMaxChars   -> scan-prompt-length
//   text             sceneWords + player counts   -> scan-text-word
//   options[i].text  optionWords + player counts, minus optionExclusions
//                                                 -> scan-option-word
//   scan.area        not in areas[category] for an attack/defend card
//                                                 -> scan-area-side
//   why and tip are never checked. Glimpse range, pitch-only, schema version
//   and category are schema errors (docs/schema/card.schema.json).
//
// Matching reuses the copy-lint compile rule: case-insensitive, word-bounded
// ((?<![A-Za-z0-9]) ... (?![A-Za-z0-9])), a space or hyphen in a phrase
// matches [\s-]+. A player count is a number word or digits, an optional
// single word, then a count noun ("two defenders", "2 opponents", "three more
// players"); its span is reported once and not again as a single word. An
// option hit inside an optionExclusions phrase ("open your body", "free
// kick", "near post") is not a hit.
//
// Exceptions: docs/scan-allowlist.json, an array of { "text", "reason" }. An
// entry suppresses issues only on a field whose whole string equals its text
// exactly. There is no inline-disable mechanism.
//
// Issue shape: { rule, field, phrase, message }.
import { readFileSync } from 'fs';
import { compileRules, findPhrases } from './copy-lints.js';

const rulesPath = new URL('../../docs/schema/scan-rules.json', import.meta.url);
const allowlistPath = new URL('../../docs/scan-allowlist.json', import.meta.url);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The parsed shared scan rules. */
export const SCAN_RULES = deepFreeze(JSON.parse(readFileSync(rulesPath, 'utf8')));

/** The scan allow-list: [{ text, reason }]. */
export const SCAN_ALLOWLIST = deepFreeze(JSON.parse(readFileSync(allowlistPath, 'utf8')));

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(phrases) {
  return phrases.map((p) => escapeRegExp(p).replace(/[ -]/g, '[\\s-]+')).join('|');
}

const SCENE_WORDS = compileRules(SCAN_RULES.sceneWords);
const OPTION_WORDS = compileRules(SCAN_RULES.optionWords);
const OPTION_EXCLUSIONS = Object.freeze(
  compileRules(SCAN_RULES.optionExclusions).map((r) => new RegExp(r.re.source, 'gi')),
);
// Bounded: one optional middle word, no nested quantifiers.
const COUNT_RE = new RegExp(
  '(?<![A-Za-z0-9])(?:' +
    alternation(SCAN_RULES.countNumbers) +
    '|\\d+)\\s+(?:[A-Za-z]+\\s+)?(?:' +
    alternation(SCAN_RULES.countNouns) +
    ')(?![A-Za-z0-9])',
  'gi',
);

function blank(text, re) {
  return text.replace(re, (m) => ' '.repeat(m.length));
}

/** Player counts in text, then the remaining word hits from compiled. */
function findWords(text, compiled, exclusions) {
  if (typeof text !== 'string' || text === '') return [];
  let rest = text;
  for (const re of exclusions) rest = blank(rest, re);
  const counts = rest.match(COUNT_RE) || [];
  rest = blank(rest, COUNT_RE);
  return [...findPhrases(rest, compiled), ...counts];
}

/** Scene-word hits for scan.prompt and the question text. */
export function findSceneWords(text) {
  return findWords(text, SCENE_WORDS, []);
}

/** Option-word hits for an option label. */
export function findOptionWords(text) {
  return findWords(text, OPTION_WORDS, OPTION_EXCLUSIONS);
}

function wordIssues(rule, field, phrases, describe) {
  return phrases.map((phrase) => ({
    rule,
    field,
    phrase,
    message: `${field} uses "${phrase}", which ${describe}. Give the situation, not the scene.`,
  }));
}

/**
 * Scan lint issues for one card. Returns [] for a card without a scan block.
 * options.allowlist: [{ text, reason }] exact-string exceptions (defaults to
 * docs/scan-allowlist.json).
 */
export function lintScanCard(card, { allowlist = SCAN_ALLOWLIST } = {}) {
  if (!card || typeof card !== 'object' || card.scan === undefined || card.scan === null) return [];
  const allowed = new Set((allowlist || []).map((e) => e.text));
  const scan = card.scan;
  const issues = [];

  const prompt = typeof scan.prompt === 'string' ? scan.prompt : null;
  if (prompt !== null && !allowed.has(prompt)) {
    issues.push(
      ...wordIssues('scan-prompt-word', 'scan.prompt', findSceneWords(prompt), 'describes the scene the player should look for'),
    );
    const length = Array.from(prompt).length;
    if (length > SCAN_RULES.promptMaxChars) {
      issues.push({
        rule: 'scan-prompt-length',
        field: 'scan.prompt',
        phrase: '',
        message: `scan.prompt is ${length} characters; the cap is ${SCAN_RULES.promptMaxChars}.`,
      });
    }
  }

  if (typeof card.text === 'string' && !allowed.has(card.text)) {
    issues.push(
      ...wordIssues('scan-text-word', 'text', findSceneWords(card.text), 'describes the scene the player should look for'),
    );
  }

  if (Array.isArray(card.options)) {
    card.options.forEach((option, i) => {
      const label = option && typeof option.text === 'string' ? option.text : null;
      if (label === null || allowed.has(label)) return;
      const field = `options[${i}].text`;
      issues.push(...wordIssues('scan-option-word', field, findOptionWords(label), 'gives away what the scan should show'));
    });
  }

  if (card.category === 'attack' || card.category === 'defend') {
    const side = SCAN_RULES.areas[card.category];
    if (!side.includes(scan.area)) {
      issues.push({
        rule: 'scan-area-side',
        field: 'scan.area',
        phrase: String(scan.area),
        message: `scan.area "${String(scan.area)}" is not a ${card.category} area (${side.join(', ')}).`,
      });
    }
  }

  return issues;
}
