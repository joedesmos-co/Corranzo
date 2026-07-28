# Phase 3 — Hungarian Dance Dense Multi-Voice Recognition

**Status: NO SAFE PRODUCTION FIX** (RCA documented; production unchanged)

Date: 2026-07-28  
Depends on: Phase 1 + Phase 2 accepted

---

## Reproduced behavior

| Metric | Generated | Truth (approx) |
|---|---|---|
| Measures | 105 | 104 |
| Notes | 1501 | 1512 |
| Written minutes | ~3.2 (performed ~4.8 with 1 backward) | edition ~4–5 |
| Page systems | 6+6+6+2 | dense 2/4 piano |

First ~45 measures type skew:

| Type | Truth | Gen |
|---|---|---|
| eighth | 361 | 179 |
| 16th | 123 | 34 |
| quarter | 41 | **284** |
| dotted-quarter | 39 | 0 |
| half | 18 | 86 |

Note inventory is close; **rhythm type / beam packing** is wrong. Chord-tone count similar (260 vs 261). Backups present (145) but voice labels differ from truth.

## Error taxonomy (ranked by frequency × impact)

1. **Wrong duration / false quarter promotion** — dominant (eighth/16th → quarter)
2. **Beam grouping failure** — path-heavy engraving; low recovered beams vs density
3. **Missing dotted quarters** — 0 recovered in sample
4. **Half inflation** — secondary
5. **Wrong onset / serialization** — dense accompaniment patterns
6. **False chord merge / sequentialization** — present but chord counts near truth
7. **Wrong voice** — voice IDs differ; backups exist
8. **Missing rests** — gen rests≈0 in sample vs truth 19
9. **Grace-note duration** — not primary in opening sample
10. **Duplicate / decorative path notes** — possible but note totals match

## First failing stage (honest)

Dense vector rhythm packing + weak beam topology on path-heavy pages — **not** a single odd-stave or whole-glyph bug. No first measure with a unique mechanical failure comparable to Fantaisie page 4.

## Attempted approaches

- Considered beam-floor / eighth preference on dense black heads — overlaps existing `refineEventDurationsFromBeamEvidence`; risk of Evangelion regression without multi-measure verified beam evidence on Hungarian.
- Considered chord-tolerance changes — **forbidden** by campaign.
- Considered global dense thinning / 2/4 hardcode — **forbidden**.

## Decision

**Keep production unchanged for Phase 3.** Ship only the Phase 1 + Phase 2 fixes. Hungarian remains the dense multi-voice accuracy class for a future campaign with a verified 35–50 measure set and beam-topology-focused general fixes.

## Controls (no Phase 3 code)

Phase 1/2 gates still hold; no Phase 3 diff to revert.

## Remaining limitations

Hungarian OMR stays inaccurate on beamed rapid figures and 2/4 packing quality despite plausible duration and note count.
