# OMR benchmark fixtures

Stable location for the score PDF + MusicXML (`.mxl`) files used by the OMR
accuracy dashboard (`npm run omr:benchmark-dashboard`).

## Why these are not in the repo

The benchmark scores are third-party engravings (some copyrighted). They are
**not vendored** into git. Instead, `benchmarks/omr-benchmark.manifest.json`
records, per fixture:

- the **filename** (not a machine-specific absolute path),
- a list of **search paths** to look in, and
- a **sha256 checksum** for both the PDF and the truth `.mxl`.

This makes the suite reproducible: any machine that drops the exact expected
files here will get byte-identical runs, and mismatched/corrupted files are
detected instead of silently skewing results.

## Setup

1. Place each fixture's `.pdf` and `.mxl` in **one** of the manifest
   `fixtureSearchPaths` (checked in order):
   - `benchmarks/omr-fixtures/` (this folder — preferred, stable)
   - `~/Downloads/` (legacy location)
   - `tmp/sprint1/` (scratch)

2. Verify the checksums match the manifest:

```bash
node scripts/omr-benchmark-dashboard.mjs --check-fixtures
```

This prints each fixture's resolved path, whether it exists, and whether the
sha256 matches — without running OMR.

## Expected files & checksums

| Fixture id | File | sha256 |
|------------|------|--------|
| `clean` | `gymnopedie-no-1-satie.pdf` | `da31557942…3758bae` |
| `clean` | `gymnopedie-no-1-satie.mxl` | `a655f6bb40…65f314d` |
| `dense` | `a-cruel-angels-thesis-neon-genesis-evangelion.pdf` | `9710272721…310c68d` |
| `dense` | `a-cruel-angels-thesis-neon-genesis-evangelion.mxl` | `6c1d8d7530…a32ff91` |
| `simple` | `twinkle-twinkle-little-star-easy.pdf` | `b13d213151…5ec10f8` |
| `simple` | `twinkle-twinkle-little-star-easy.mxl` | `4515c53ffb…a5e26d1` |
| `campanella-grandes` *(optional)* | `la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf` | `3ab86a247c…84cc8b60` |
| `campanella-grandes` *(optional)* | `la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.mxl` | `2da9b32995…990324bd` |
| `campanella-etude` *(optional)* | `etude-s-1413-in-g-minor-la-campanella-liszt.pdf` | `5c40124f2a…a5afbd7d` |
| `campanella-etude` *(optional)* | `etude-s-1413-in-g-minor-la-campanella-liszt.mxl` | `2e17943683…c68b8130a` |

Full checksums live in the manifest (`checksums.pdf` / `checksums.truth`). The
table above is truncated for readability only.

To recompute a checksum locally:

```bash
shasum -a 256 benchmarks/omr-fixtures/gymnopedie-no-1-satie.pdf
```

## Optional / diagnostic-only fixtures

`campanella-grandes` and `campanella-etude` are marked `optional` and
`diagnosticOnly` in the manifest:

- **optional** — if the files are absent, the dashboard **skips** them (no
  error, no failure).
- **diagnosticOnly** — they have **no pass/fail thresholds**, so they can never
  block the dashboard. They exist to surface error buckets on extreme input.

Regular fixtures (`clean`, `dense`, `simple`) still error if missing, unless you
pass `--allow-missing`.

## Rules

- Do **not** commit the score binaries here.
- Do **not** change OMR algorithms or thresholds to make a fixture pass.
- If you replace a fixture file, update its checksum in the manifest in the same
  change.
