# P1 Campaign — Review Summaries

## Provisional accept

Both phases accepted after live Vite UI smoke (`SMOKE_RESULTS.md`). No further recognition changes.

## Frozen production behavior

1. **Later-page tempo-word recovery** — mapped tempo words / `a tempo` are not discarded by the later-page top-band header filter.
2. **Moderato / Presto classification** — leading/embedded tempo phrases recognized on all pages; BPM only from `TEMPO_WORD_BPM`.
3. **Written dotted duration over sparse X-gap** — on sparse filled-head onsets, explicit augmentation-dot 1.5× values outrank whitespace gap promotion to half/dotted-half.
4. **Chord-level augmentation-dot broadcast** — one printed rhythm-dot applies to same-onset chord tones (same clef, near-identical X).
5. **Unsafe dy loosening remains reverted** — Evangelion false-dot regression; tight augmentation geometry kept.

## Smoke verdict (2026-07-28)

| Piece | Result |
|-------|--------|
| Fantaisie | PASS — 5.205 min; BPM 84→50→108→168 through UI seek/play |
| Minecraft | PASS — 17 dotted quarters; wholes 144; ties 62 |
| Evangelion | PASS — 125 measures / 4.052 min; quarter. unchanged at 15 |

## Out of scope / residual

- Hungarian dense recognition untouched.
- Minecraft dotted-quarter recall still partial (17/49 truth).
- Whole count −7 vs `b818184` documented and smoke-bounded.
- Evaluator untouched; no audio changes; no duration clamps.
