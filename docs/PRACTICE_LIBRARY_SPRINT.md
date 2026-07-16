# Corranzo Curated Practice Library Sprint

Date: 2026-07-15

## Scope

Replace generated-looking practice cards with curated Mutopia / public-domain
editions. Prefer source MusicXML timing derived from the same edition’s MIDI;
OMR remains for user uploads only.

## Catalog

| Instrument | Beginner | Intermediate | Advanced | Total |
| --- | ---: | ---: | ---: | ---: |
| Piano | 5 | 5 | 3 | 13 |
| Guitar | 5 | 5 | 3 | 13 |

Every card has: PDF, MusicXML, MIDI, license, provenance, difficulty, tags.

## What shipped

- `public/fixtures/practice-library/manifest.json` — curated catalog
- `scripts/import-practice-library.mjs` — Mutopia PDF+MIDI download → MusicXML
- Registry via `src/dev/fixturePaths.js` (license / provenance / tags)
- Search includes tags, license, and provenance
- Removed generated sketches (Amazing Grace, Saints, Aura Lee) from the library
- Kept `guitar-ode-to-joy` only as an internal TAB/OMR regression fixture

## Explicit non-goals

- No re-adding banned generator sketch ids
- No OMR for built-in library timing
- No mic / matching runtime changes

## Verification

```bash
npm run fixtures:practice-library
npm test
npm run build
```
