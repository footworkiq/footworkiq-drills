# FootworkIQ Drills

Open-source community drill catalogue for the [FootworkIQ](https://github.com/footworkiq/footworkiq) app. Drills are served via jsDelivr:

```
https://cdn.jsdelivr.net/gh/footworkiq/footworkiq-drills@main/index.json
```

## Structure

```
drills/          Individual drill JSON files (full schema)
docs/schema/     drill.schema.json — JSON Schema draft 2020-12
scripts/         build-index.js — CI-run index generator
index.json       CI-GENERATED — do not edit manually (see below)
```

## ⚠️ Do Not Edit `index.json`

`index.json` is automatically rebuilt by the **Rebuild Index** GitHub Action on every push to `main` that touches `drills/`. Manually editing it will be overwritten on the next trigger. See `.github/workflows/index.yml`.

## How to Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full PR workflow.

All drills must conform to `docs/schema/drill.schema.json` (JSON Schema draft 2020-12). The **Validate Drills** CI workflow runs AJV against every drill in a PR automatically.

## License

All drills in this repository are released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — no rights reserved.
