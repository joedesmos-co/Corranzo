# Corranzo Curated Practice Library Sprint

Date: 2026-07-15

## Scope

Keep the built-in Practice Library small, public-domain only, and better balanced by difficulty. Do not dump synthetic piano sketches or previously rejected style studies.

## Catalog before / after

| Instrument | Before | After |
| --- | --- | --- |
| Piano | Intermediate Minuet, Advanced Hungarian Dance | Unchanged (beginner piano still needs a typeset PD score — generator sketches remain banned) |
| Guitar | 3 Beginner | 3 Beginner + **Aura Lee (Intermediate)** |

Total built-ins: **5 → 6**.

## What shipped

- Generated `guitar-aura-lee` PDF / MusicXML / MIDI under `public/fixtures/practice-library/`
- Registered the piece in `src/dev/fixturePaths.js` with short skill-tag `teaches`
- Extended `scripts/generate-practice-library-fixtures.mjs`
- Updated library / demo fixture tests for count, guitar filter order, and Intermediate grouping
- Documented curation policy in `public/fixtures/practice-library/README.md`

## Explicit non-goals

- No re-adding removed ids (`piano-twinkle-twinkle`, `guitar-greensleeves`, style studies, etc.)
- No generated piano sketches
- No OMR / mic / matching runtime changes

## Remaining gap

Piano still has no Beginner built-in. Fill that only with a hand-checked public-domain typeset score (aligned PDF + MusicXML + MIDI), never a generator sketch.

## Verification

- `npm run fixtures:practice-library`
- `npm test`
- `npm run build`
- `npm run mic:accuracy-replay`
- `npm run mic:polyphony-replay`
- `npm run omr:benchmark-dashboard`
