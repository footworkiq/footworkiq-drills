# Contributing Drills

Thank you for contributing to the FootworkIQ community drill catalogue!

## PR Workflow

1. **Fork** this repository.
2. Add your drill as `drills/<your-drill-id>.json` — the filename must match the `metadata.id` field inside.
3. Open a **pull request** targeting `main`.
4. The **Validate Drills** CI workflow runs AJV against your file using `docs/schema/drill.schema.json`. The PR cannot be merged until it passes.
5. A maintainer reviews and merges.
6. On merge, the **Rebuild Index** action automatically updates `index.json`.

## Required Schema

Drills must conform to `docs/schema/drill.schema.json` (JSON Schema draft 2020-12).

### Required metadata fields

| Field | Type | Example |
|-------|------|---------|
| `id` | string | `"inside-outside"` |
| `name` | string | `"Inside-Outside Shuffle"` |
| `contributor` | string | `"YourGitHubUsername"` |
| `difficulty` | enum | `"Beginner"`, `"Intermediate"`, or `"Advanced"` |
| `default_bpm` | integer | `100` |
| `tags` | string[] | `["ball-control", "rhythm"]` |

### Optional metadata fields

| Field | Type |
|-------|------|
| `description` | string |

### Do not include in metadata

`sequence` and other drill-execution fields belong inside the `sequence` array, not in `metadata`.

## ⚠️ Do Not Edit `index.json`

`index.json` is CI-generated. Any manual edits will be overwritten by the **Rebuild Index** action on the next `drills/` push. Never edit this file in a PR.

## Decision Cards: Frozen Ids

Decision cards live in `cards/decision/<id>.json` and are validated by `node scripts/validate-cards.js`. The app records answers against card and option ids, so on a PR CI also checks the cards against the base branch (`--base origin/main`):

- A card's `id` (and its filename), its option `id`s and its `legacy_id` never change. Reword `text`/`why` freely. If you change any option's `grade`, you must also increase the card's `rev`: CI fails a PR that changes a grade without a higher `rev`. CI can't spot a change of meaning, so bump `rev` by hand when the situation or the lesson of a card changes.
- `legacy_id` must be unique across cards.
- To remove a card, delete its file AND append its id to `cards/decision.retired.json`. Retired ids can never be reused, and the list is append-only. "Renaming" a card means retiring the old id and adding a new card.
- Never edit `cards/decision.bundle.json`; CI rebuilds it on `main`.

## Decision Cards: Metadata

Every card sets `age_band`, `role`, `difficulty` and `tags`. The app uses the first two to decide which players see the card.

**`age_band`** is the youngest age band the card suits. The bands are ordered U9 < U12 < U16, and a card shows to its own band and every older band. So a `U12` card shows to U12 and U16 players, but not to U9 players. `all` is the same as the lowest band and is the default. Use a higher band when the card depends on a law or skill that younger players don't use yet, such as offside or heading.

**`role`** is `outfield` or `keeper`. Outfield profiles see only `outfield` cards. Keeper profiles see `keeper` and `outfield` cards, because young keepers play outfield too. Use `keeper` only for cards written from the keeper's point of view. There is no `both` value.

**`difficulty`** follows these rules of thumb:

| Difficulty | Meaning |
|------------|---------|
| `Beginner` | One visible cue and an obvious safe answer |
| `Intermediate` | Two cues to weigh. Most cards are here |
| `Advanced` | The player has to read unseen runners, lines or laws |

**`tags`**: 1 to 3 tags per card, from this list only; don't repeat the category. A tag of `attack`, `defend` or `mindset` is not allowed because `category` already says that.

| Tag | Use it for |
|-----|------------|
| `finishing` | Shooting and scoring chances |
| `passing` | Choosing and playing a pass |
| `dribbling` | Running with the ball and beating a player |
| `first-touch` | Controlling the ball as it arrives |
| `crossing` | Balls into the box from wide areas |
| `movement` | Runs and positions off the ball |
| `heading` | Playing the ball with the head |
| `set-piece` | Corners, free kicks, throw-ins, goal kicks and penalties |
| `one-v-one` | Duels with a single opponent |
| `marking` | Tracking and staying close to an opponent |
| `pressing` | Closing down the ball and winning it back |
| `defensive-shape` | Team positions and lines when defending |
| `clearing` | Getting the ball out of danger |
| `transition` | The moments just after the ball changes hands |
| `game-management` | Using the score, the clock and the state of the game |
| `communication` | Talking to teammates on the pitch |
| `keeper` | Goalkeeping situations |
| `laws` | Cards that depend on a law of the game |
| `fair-play` | Sportsmanship and respect |
| `composure` | Staying calm under pressure or after a mistake |
| `teamwork` | Supporting and encouraging teammates |

The tag list is fixed. Adding or removing a tag is a policy change, so it needs its own PR that updates this table and `CARD_TAGS` in `scripts/lib/card-lints.js` together.

## Decision Cards: Quality Lints

`node scripts/validate-cards.js` checks every card with the rules below. The thresholds are named constants in `scripts/lib/card-lints.js`, so CI, the card report and the tests always agree. A value exactly at a limit passes.

| Rule | Constant | Value | Strict or warning |
|------|----------|-------|-------------------|
| Field length caps, in characters | `FIELD_CAPS` | title 40, text 160, option 64, why 140, tip 140 | Strict |
| Words per sentence, in title, text, tip, option text and why | `MAX_WORDS_PER_SENTENCE` | 20 | Strict |
| No links or domains in any text (`http://`, `www.` or a bare domain) | none | | Strict |
| Tags come from the tag list above | `CARD_TAGS` | 21 tags | Strict |
| No tag listed twice | none | | Strict |
| At most 3 tags | `MAX_TAGS` | 3 | Strict |
| File format: 2-space indent plus a trailing newline | none | | Strict |
| A grade change needs a higher `rev` (PRs only, checked against `main`) | none | | Strict |
| At least one tag | `MIN_TAGS` | 1 | Warning until the 2026-11 audit completes, then strict |
| Option balance: the longest option is at most 1.5 times the shortest, unless they are within 12 characters of each other | `MAX_OPTION_LENGTH_RATIO`, `OPTION_LENGTH_SLACK_CHARS` | 1.5, 12 | Warning until the 2026-11 audit completes, then strict |
| Share of cards where the best option is the longest (ties count) | `MAX_BEST_LONGEST_SHARE` | 0.45 | Warning until the 2026-11 audit completes, then strict |
| Share of cards where the best option is stored first | `MAX_BEST_FIRST_SHARE` | 0.45 | Warning until the 2026-11 audit completes, then strict |
| Share of cards where the best option is the shortest (ties count) | `MAX_BEST_SHORTEST_SHARE` | 0.45 | Warning until the 2026-11 audit completes, then strict |

The three share rules look at the whole deck. They are checked over all cards and again over `outfield` cards only, and they are skipped when there are fewer than `MIN_CARDS_FOR_DECK_LINT` (20) cards.

Some problems are schema errors, which always fail: a card with two best options or no best option, scene coordinates out of bounds, and a missing or invalid `age_band` or `role`.

Write in short, plain sentences. Don't use abbreviations with full stops, such as "e.g." or "i.e.", because they confuse the sentence counter: it treats each full stop as the end of a sentence.

### Before you open a card PR

1. Run `npm test`.
2. Run `node scripts/validate-cards.js --strict-balance` to see the warning-level rules as failures.
3. Run `node scripts/reorder-card-options.js`. It stores each card's options in a fixed shuffled order, so the best answer isn't always first. Commit the result.
4. Run `node scripts/card-report.js --base origin/main` to see your changes, including any grade changes and whether `rev` went up.

## License

By submitting a pull request, you agree that your drill and card JSON is released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — no rights reserved. This is required for drills and cards to be freely distributable by the FootworkIQ app.
