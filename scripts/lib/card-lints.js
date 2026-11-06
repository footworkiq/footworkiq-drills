// Quality lints for decision cards (cards/decision/*.json).
//
// Pure functions and named threshold constants only: no file system access
// and no exiting. validate-cards.js, card-report.js and the unit tests in
// test/card-lints.test.js all import this module, so CI, the report and the
// tests can never disagree about a threshold.
//
// Rule ids (Issue.rule):
//   field-cap           title/text/tip/option text/why longer than FIELD_CAPS
//   sentence-length     a sentence with more than MAX_WORDS_PER_SENTENCE words
//   no-url              a link or bare domain in any string field
//   tag-unknown         a tag that is not in CARD_TAGS
//   tag-duplicate       the same tag listed twice
//   tag-count           more than MAX_TAGS tags
//   tags-missing        fewer than MIN_TAGS tags                      (deferred)
//   option-balance      option texts too different in length          (deferred)
//   format              file text is not JSON.stringify(card, null, 2) + '\n'
//   deck-best-longest   best option is the longest on too many cards  (deferred)
//   deck-best-first     best option is listed first on too many cards (deferred)
//   deck-best-shortest  best option is the shortest on too many cards (deferred)
//
// Deferred versus strict: issues marked `deferred: true` are balance-class.
// They only count as failures when BALANCE_LINTS_STRICT is true (or a caller
// passes strict explicitly to isFailure). Until then validators print them as
// warnings. All other issues always fail.
//
// Issue shape: { rule: string, path: string, message: string, deferred: boolean }
// Paths are JSON pointers into the card (e.g. /options/1/why); deck issues use
// the subset label ("deck" or "deck (outfield)") as their path.
//
// Lengths count UTF-16 code units (String#length). This matches AJV with
// `unicode: false` in validate-cards.js and zod's .max() in the app, so a
// string with emoji is measured the same way everywhere.
//
// Schema rules (exactly one best, coordinate bounds, enums, 3 options, unique
// option ids) are NOT re-checked here: the AJV schema already enforces them,
// and lintCard assumes a schema-valid card.

/**
 * Balance lints (option-balance, tags-missing, deck shares) fail CI only when
 * this is true. It is false until the attack, defend and mindset audit PRs
 * have all merged (D-06). Rebuild Artifacts validates main on every push, so
 * turning this on early would stop the bundle rebuild.
 */
export const BALANCE_LINTS_STRICT = false;

/**
 * Maximum ratio of the longest option text to the shortest on one card.
 * Exactly 1.5x passes. A card only fails when it is also over
 * OPTION_LENGTH_SLACK_CHARS apart.
 */
export const MAX_OPTION_LENGTH_RATIO = 1.5;

/**
 * Character slack for the option-balance rule: a card whose longest and
 * shortest options differ by at most this many chars passes whatever the
 * ratio. A difference of exactly 12 chars passes.
 */
export const OPTION_LENGTH_SLACK_CHARS = 12;

/**
 * Maximum share of cards on which the best option is the longest.
 * Exactly 0.45 is accepted; ties count as longest and as shortest.
 */
export const MAX_BEST_LONGEST_SHARE = 0.45;

/**
 * Maximum share of cards on which the best option is stored first.
 * Exactly 0.45 is accepted.
 */
export const MAX_BEST_FIRST_SHARE = 0.45;

/**
 * Maximum share of cards on which the best option is the shortest (guards
 * against over-correcting into an inverse cue). Exactly 0.45 is accepted;
 * ties count as longest and as shortest.
 */
export const MAX_BEST_SHORTEST_SHARE = 0.45;

/**
 * Deck lints are skipped below 20 cards (small --dir fixture sets would
 * otherwise always breach a share). Exactly 20 cards are linted.
 */
export const MIN_CARDS_FOR_DECK_LINT = 20;

/**
 * Per-field character caps (UTF-16 code units). A field of exactly the cap
 * passes. `option` applies to options[].text, `why` to options[].why.
 */
export const FIELD_CAPS = Object.freeze({ title: 40, text: 160, option: 64, why: 140, tip: 140 });

/**
 * Maximum words in one sentence of title, text, tip, options[].text or
 * options[].why. A sentence of exactly 20 words passes.
 */
export const MAX_WORDS_PER_SENTENCE = 20;

/** Minimum tags per card. Exactly 1 tag passes (deferred rule: tags-missing). */
export const MIN_TAGS = 1;

/** Maximum tags per card. Exactly 3 tags pass. */
export const MAX_TAGS = 3;

/**
 * Tag allow-list (D-16): lowercase kebab-case, none duplicates a category
 * name (attack/defend/mindset).
 * FROZEN vocabulary: adding or removing a tag is a policy change; update
 * CONTRIBUTING.md in the same PR.
 */
export const CARD_TAGS = Object.freeze([
  'finishing',
  'passing',
  'dribbling',
  'first-touch',
  'crossing',
  'movement',
  'heading',
  'set-piece',
  'one-v-one',
  'marking',
  'pressing',
  'defensive-shape',
  'clearing',
  'transition',
  'game-management',
  'communication',
  'keeper',
  'laws',
  'fair-play',
  'composure',
  'teamwork',
]);

/**
 * Links and domains (D-19): http:// or https://, www., or a bare domain such
 * as footworkiq.com. Linear-time: no nested quantifiers over overlapping
 * character classes. "1.0" and "2–1" do not match (the TLD needs 2+ letters).
 */
export const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:[a-z0-9-]+\.)*[a-z]{2,}\b/i;

/**
 * Balance-class rule ids. lintCard/lintDeck mark these issues deferred: they
 * fail only when BALANCE_LINTS_STRICT (or an explicit strict flag) is on.
 */
export const DEFERRED_RULES = Object.freeze([
  'tags-missing',
  'option-balance',
  'deck-best-longest',
  'deck-best-first',
  'deck-best-shortest',
]);

const CARD_TAG_SET = new Set(CARD_TAGS);

/**
 * Walks objects and arrays and yields [path, string] for every string leaf.
 * Paths are JSON pointers (/options/1/why); the root renders as "/".
 */
export function* strings(value, path = '') {
  if (typeof value === 'string') {
    yield [path || '/', value];
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}/${i}`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}/${k}`);
  }
}

/**
 * Splits text into sentences on whitespace that follows . ! or ?, so
 * `Shout "Keeper!" and go.` stays one sentence (the quote follows the !).
 */
export function sentences(s) {
  return s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Counts whitespace-separated tokens that contain at least one letter or digit. */
export function wordCount(s) {
  return s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * Option text lengths in stored order plus the balance verdict. A card fails
 * only if the longest is more than MAX_OPTION_LENGTH_RATIO x the shortest AND
 * more than OPTION_LENGTH_SLACK_CHARS longer.
 */
export function optionBalance(card) {
  const lengths = card.options.map((o) => o.text.length);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  const ratio = longest / shortest;
  const fails =
    longest > MAX_OPTION_LENGTH_RATIO * shortest && longest - shortest > OPTION_LENGTH_SLACK_CHARS;
  return { lengths, longest, shortest, ratio, fails };
}

function issue(rule, path, message, deferred = false) {
  return { rule, path, message, deferred };
}

/** The prose fields a reader sees: [path, string, capKey]. Missing fields are skipped. */
function proseFields(card) {
  const out = [];
  if (typeof card.title === 'string') out.push(['/title', card.title, 'title']);
  if (typeof card.text === 'string') out.push(['/text', card.text, 'text']);
  if (typeof card.tip === 'string') out.push(['/tip', card.tip, 'tip']);
  (card.options ?? []).forEach((o, i) => {
    if (typeof o.text === 'string') out.push([`/options/${i}/text`, o.text, 'option']);
    if (typeof o.why === 'string') out.push([`/options/${i}/why`, o.why, 'why']);
  });
  return out;
}

/**
 * Per-card quality lints. Assumes the card already passed the schema.
 * Returns Issue[] (empty when the card is clean).
 */
export function lintCard(card) {
  const issues = [];

  for (const [path, s, capKey] of proseFields(card)) {
    const cap = FIELD_CAPS[capKey];
    if (s.length > cap) {
      issues.push(issue('field-cap', path, `${path} is ${s.length} chars (max ${cap}); shorten it`));
    }
    for (const sentence of sentences(s)) {
      const n = wordCount(sentence);
      if (n > MAX_WORDS_PER_SENTENCE) {
        issues.push(
          issue(
            'sentence-length',
            path,
            `${path} has a ${n}-word sentence (max ${MAX_WORDS_PER_SENTENCE}); split it`,
          ),
        );
      }
    }
  }

  for (const [path, s] of strings(card)) {
    const m = URL_RE.exec(s);
    if (m) {
      issues.push(
        issue(
          'no-url',
          path,
          `${path} contains a link or domain ${JSON.stringify(m[0])}; remove links and domains from card text`,
        ),
      );
    }
  }

  const tags = Array.isArray(card.tags) ? card.tags : [];
  const seen = new Set();
  tags.forEach((t, i) => {
    if (!CARD_TAG_SET.has(t)) {
      issues.push(
        issue(
          'tag-unknown',
          `/tags/${i}`,
          `tag ${JSON.stringify(t)} is not in the allow-list; use a tag from the CARD_TAGS list in CONTRIBUTING.md`,
        ),
      );
    }
    if (seen.has(t)) {
      issues.push(
        issue('tag-duplicate', `/tags/${i}`, `tag ${JSON.stringify(t)} is listed twice; remove the repeat`),
      );
    }
    seen.add(t);
  });
  if (tags.length > MAX_TAGS) {
    issues.push(
      issue('tag-count', '/tags', `card has ${tags.length} tags (max ${MAX_TAGS}); keep the most relevant ${MAX_TAGS}`),
    );
  }
  // Deferred: the un-audited deck still carries the converter default `tags: []`.
  if (tags.length < MIN_TAGS) {
    issues.push(
      issue(
        'tags-missing',
        '/tags',
        `card has ${tags.length} tags (min ${MIN_TAGS}); add 1-${MAX_TAGS} tags from the CARD_TAGS list in CONTRIBUTING.md`,
        true,
      ),
    );
  }

  const bal = optionBalance(card);
  if (bal.fails) {
    issues.push(
      issue(
        'option-balance',
        '/options',
        `options are unbalanced (lengths ${bal.lengths.join('/')}, longest is ${bal.ratio.toFixed(2)}x the shortest; ` +
          `max ${MAX_OPTION_LENGTH_RATIO}x unless within ${OPTION_LENGTH_SLACK_CHARS} chars); ` +
          'trim the longest or flesh out the shortest',
        true,
      ),
    );
  }

  return issues;
}

/**
 * Formatting lint on the raw file text. Returns null when the text is exactly
 * JSON.stringify(card, null, 2) + '\n', or when it is not valid JSON (the
 * validator reports parse errors earlier).
 */
export function checkFormat(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (JSON.stringify(parsed, null, 2) + '\n' === text) return null;
  return issue(
    'format',
    '/',
    'not formatted as JSON.stringify(card, null, 2) plus a trailing newline; re-save it with 2-space indentation',
  );
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Deck metrics. Ties count as longest and as shortest. bestPositions counts
 * the best option at stored index 0 / 1 / 2.
 */
export function deckStats(cards) {
  let bestLongest = 0;
  let bestShortest = 0;
  let ratioFails = 0;
  let bestPoorPoor = 0;
  let untagged = 0;
  const bestPositions = [0, 0, 0];
  const ratios = [];
  for (const c of cards) {
    const bal = optionBalance(c);
    const bi = c.options.findIndex((o) => o.grade === 'best');
    if (bal.lengths[bi] === bal.longest) bestLongest++;
    if (bal.lengths[bi] === bal.shortest) bestShortest++;
    if (bi >= 0 && bi < 3) bestPositions[bi]++;
    if (bal.fails) ratioFails++;
    if (c.options.map((o) => o.grade).sort().join('/') === 'best/poor/poor') bestPoorPoor++;
    if (!Array.isArray(c.tags) || c.tags.length < MIN_TAGS) untagged++;
    ratios.push(bal.ratio);
  }
  ratios.sort((a, b) => a - b);
  const n = cards.length;
  let medianRatio = 0;
  if (n > 0) {
    const mid = Math.floor(n / 2);
    medianRatio = round2(n % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2);
  }
  const maxRatio = n > 0 ? round2(ratios[n - 1]) : 0;
  return {
    n,
    bestLongest,
    bestShortest,
    bestPositions,
    ratioFails,
    bestPoorPoor,
    untagged,
    medianRatio,
    maxRatio,
  };
}

function shareIssue(rule, label, what, count, n, max, remedy) {
  const pct = Math.round((count / n) * 100);
  return issue(
    rule,
    label,
    `best option is ${what} on ${count}/${n} cards (${pct}%; max ${Math.round(max * 100)}%); ${remedy}`,
    true,
  );
}

/**
 * Deck-share lints over all cards ("deck") and the role: outfield subset
 * ("deck (outfield)"). Subsets below MIN_CARDS_FOR_DECK_LINT are skipped.
 * A share strictly greater than its max is an issue (all deferred).
 */
export function lintDeck(cards) {
  const issues = [];
  const subsets = [
    ['deck', cards],
    ['deck (outfield)', cards.filter((c) => c.role === 'outfield')],
  ];
  for (const [label, subset] of subsets) {
    const s = deckStats(subset);
    if (s.n < MIN_CARDS_FOR_DECK_LINT) continue;
    if (s.bestLongest / s.n > MAX_BEST_LONGEST_SHARE) {
      issues.push(
        shareIssue('deck-best-longest', label, 'the longest', s.bestLongest, s.n, MAX_BEST_LONGEST_SHARE, 'rebalance option lengths'),
      );
    }
    if (s.bestPositions[0] / s.n > MAX_BEST_FIRST_SHARE) {
      issues.push(
        shareIssue('deck-best-first', label, 'first', s.bestPositions[0], s.n, MAX_BEST_FIRST_SHARE, 'shuffle option order'),
      );
    }
    if (s.bestShortest / s.n > MAX_BEST_SHORTEST_SHARE) {
      issues.push(
        shareIssue('deck-best-shortest', label, 'the shortest', s.bestShortest, s.n, MAX_BEST_SHORTEST_SHARE, 'rebalance option lengths'),
      );
    }
  }
  return issues;
}

/**
 * Rev-bump check against the base version of the same card (D-20). Grades are
 * matched by option id, NOT by index, so reordering options never counts as a
 * regrade. Returns a message string, or null when the change is allowed.
 */
export function checkRevBump(before, after) {
  if (after.rev < before.rev) {
    return `rev may not decrease (was ${before.rev}, now ${after.rev})`;
  }
  const grades = new Map(before.options.map((o) => [o.id, o.grade]));
  for (const o of after.options) {
    const old = grades.get(o.id);
    if (old !== o.grade && !(after.rev > before.rev)) {
      return `grade changed on option ${JSON.stringify(o.id)} (${old ?? 'none'} -> ${o.grade}); bump rev to ${before.rev + 1}`;
    }
  }
  return null;
}

/** True when the issue should fail validation in the given mode. */
export function isFailure(issue, strict = BALANCE_LINTS_STRICT) {
  return !issue.deferred || strict;
}
