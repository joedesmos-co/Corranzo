# Frozen campaign baseline

**Commit:** `541f607e230611e37f377f4a106f42ab57822c65`  
**Message:** `fix(omr): recover tempo returns and sparse dotted values`  
**Date:** 2026-07-28  

## Fantaisie tempo — fully validated (frozen)

Real-browser seek validation (Playwright against Vite `127.0.0.1:5173`):

| Seek target | Observed BPM | Label |
|-------------|--------------|-------|
| ~5s | **84** | `100% · 84 BPM` |
| ~130s | **50** | `100% · 50 BPM` |
| ~145s | **108** | `100% · 108 BPM` |
| ~240s | **168** | `100% · 168 BPM` |

Duration ≈ 312.3s (5.205 min). Tempo recovery is **fully validated and frozen** — do not modify Fantaisie tempo-word recovery or the 84→50→108→168 map in this campaign.

Evidence: terminal run `177771` (Debug React seek + tempo BPM updates).

## Baseline smoke (reconfirmed)

Real Vite UI (`127.0.0.1:5173`):

| Piece | Result |
|-------|--------|
| Fantaisie | PASS — 5.205 min; BPM 84→50→108→168 (seek-validated above) |
| Minecraft | PASS — quarter.=17; wholes=144; ties=62 |
| Evangelion | PASS — 125 measures / 4.052 min; quarter.=15 |

Evidence: `BASELINE_SMOKE.txt` and `tmp/corranzo-p1-tempo-dots/SMOKE_RESULTS.md`.

## Frozen (do not regress)

- Fantaisie structure and tempo behavior (above)
- ActiveScore / PDF cache / automatic OMR / repeats / audio
- Odd-staff grand-staff recovery / sparse whole/half glyph auth
- Minecraft dotted-duration preference, chord-dot broadcast, ties
- Note type/dot/beam propagation, ties/slurs, accidentals, articulations
- Musical structure / dynamics / Piano / Guitar / frozen semantic evaluator
- Evangelion as primary complex non-regression control
