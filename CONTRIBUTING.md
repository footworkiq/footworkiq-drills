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

- A card's `id` (and its filename), its option `id`s and its `legacy_id` never change. Reword `text`/`why` freely and bump `rev` when the meaning or grading changes.
- `legacy_id` must be unique across cards.
- To remove a card, delete its file AND append its id to `cards/decision.retired.json`. Retired ids can never be reused, and the list is append-only. "Renaming" a card means retiring the old id and adding a new card.
- Never edit `cards/decision.bundle.json`; CI rebuilds it on `main`.

## License

By submitting a pull request, you agree that your drill JSON is released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — no rights reserved. This is required for drills to be freely distributable by the FootworkIQ app.
