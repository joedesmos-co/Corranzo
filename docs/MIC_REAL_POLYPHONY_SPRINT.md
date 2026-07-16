# Corranzo Real Mic Polyphony Sprint

Date: 2026-07-15

## Scope

Make microphone chord recognition measurable and more reliable on real instrument
timbre. Generated-only fixtures are not enough.

Corpus sources:

- University of Iowa MIS samples (redistributable)
- Developer-recorded fixtures (`CORRANZO_DEVELOPER_MODE=1`)
- Deterministic derived mixes (UIowa note mixes + synthetic electric)

## Tooling

- `npm run mic:import-uiowa-fixtures` — MIS download → derived WAV + manifest upsert
- `npm run mic:capture-real-fixture` — live mic or `--from-wav`
  - Requires `CORRANZO_DEVELOPER_MODE=1`
  - Stores WAV, trace JSON, instrument, device, dynamic, expected notes, expected
    string/frets
  - **Refuses silent captures** (peak/RMS floor)
- `npm run mic:browser-qa` — starts preview automatically unless `SMOKE_BASE_URL`
  is already set

## Metrics (offline polyphony report)

| Metric | Meaning |
| --- | --- |
| Exact chord hit rate | All expected tones matched and no wrong tones |
| Required tone recall | Matched expected tones ÷ expected tones |
| Wrong tone acceptance | Chord clips that also accepted extras |
| Time to confirmation | When the last required tone first stabilizes |
| First-attempt success | Exact chord hit with no wrong tones |
| False advances | Silence/noise detections, or chord hits with wrong tones |

## Corpus coverage

Piano: dyads, triads, four-note (Cmaj7), quiet (pp), ringing sustain, split-register.
Guitar: acoustic MIS dyads/strum, clean electric, distorted electric, open Em
high-string masking stress.

## Runtime change (evidence-based)

**Root cause:** On real MIS piano mixes, interior E4 often sits near the noise floor
while C/G (or outer chord tones) are strong. Absolute ratio/confidence gates rejected
E4 even when relative chord energy showed it was present.

**Fix:** Narrow piano companion-tone relief in `scoreInformedChordScorer.js` — only when
another expected tone is already strongly detected, recover quieter expected tones that
still clear a fund≥noise and soft ratio floor. Guitar path unchanged.

## Measured V2 results (full suite)

| Metric | Before relief (expanded corpus) | After |
| --- | ---: | ---: |
| Exact chord hit | 66.7% | **88.9%** |
| Required tone recall | 89.1% | **96.4%** |
| Wrong tone acceptance | 0% | **0%** |
| First-attempt success | 66.7% | **88.9%** |
| False advances | 0 | **0** |

Remaining hard misses (documented, not forced): `uiowa-piano-mf-cmaj7` and
`uiowa-piano-mf-split-c3-e4-g4` still drop E4 when its fundamental stays below the
noise floor across windows.

Phase 2B regression suite (synth + prior real) remains 100% chord hit / 0 FP.

## Verification

- `npm test`
- `npm run build`
- `npm run mic:accuracy-replay`
- `npm run mic:polyphony-replay`
- `npm run omr:benchmark-dashboard`
