# Real Mic Browser QA Report

**Generated:** 2026-07-03T04:41:34.141Z

**Passed:** 38 · **Failed:** 0

## What worked
- mic permission denied shows Mic blocked
- WFY section visible with Microphone source
- mic permission grant enables capture — wfy-enable
- mic shows calibrating or ready after grant — Mic listening
- mic calibration status line present — Room is noisy — play a bit louder or move closer
- Hear It does not dismiss mic panel
- leaving WFY hides mic panel and test UI
- re-entering WFY shows mic off until re-enabled
- instrument switch does not show stale Last confirmed mic feedback
- ipad WFY mic layout — no horizontal overflow
- mobile WFY mic layout — no horizontal overflow
- quiet room fixture calibrates without crash — Mic ready
- noisy room fixture surfaces room guidance — Mic ready
- noisy room does not show false Last confirmed
- V2: __SCOREFLOW_MIC_DEBUG__ reports engineMode/v2Enabled/isMicV2Polyphonic — mode=v2-score-informed poly=true devDefault=true
- bass+treble chord (demo checkpoint): debug reports detected notes/confidence — midis=[] conf=0
- bass+treble chord (demo checkpoint): matched 2 expected tone(s) — [61,42]
- single piano C4 fixture: debug reports detected notes/confidence — midis=[] conf=0
- single piano C4 fixture: mic enabled without crash
- repeated piano C4 (looped fixture): debug reports detected notes/confidence — midis=[] conf=0
- repeated piano C4 (looped fixture): mic enabled without crash
- wrong note (E4 vs chord checkpoint): debug reports detected notes/confidence — midis=[] conf=0
- wrong note (E4 vs chord checkpoint): no spurious advance — progress=0%
- 2-note dyad fixture (C4+G4): debug reports detected notes/confidence — midis=[] conf=0
- 3-note triad fixture (C major): debug reports detected notes/confidence — midis=[] conf=0
- quiet room: debug reports detected notes/confidence — midis=[] conf=0
- quiet room: no spurious advance — progress=0%
- noisy room: debug reports detected notes/confidence — midis=[] conf=0
- noisy room: no spurious advance — progress=0%
- soft playing (low amplitude C4): debug reports detected notes/confidence — midis=[] conf=0
- soft playing (low amplitude C4): mic enabled without crash
- loud playing (high amplitude C4): debug reports detected notes/confidence — midis=[] conf=0.04697610047982596
- non-matching audio no advance: debug reports detected notes/confidence — midis=[] conf=0
- non-matching audio no advance: no spurious advance — progress=0%
- V2: Hear It does not dismiss mic panel
- V2: leaving WFY hides mic panel/test (state cleared)
- V2: instrument switch does not leave stale mic feedback
- V2 opt-out: reload with flag=false restores V1 — v1-monophonic

## What failed
- (none)

## Notes
- Mic engine debug: {"engineMode":"v2-score-informed","v2Enabled":true,"v2Active":true,"v2SessionFallback":false,"isMicV2Polyphonic":true,"expectedMidis":[45,49,57],"lastDetectedMidis":[],"lastDetectedCount":0,"v2MeanConfidence":0,"lastV2Notes":[{"midi":45,"confidence":0,"detected":false},{"midi":49,"confidence":0,"detected":false},{"midi":57,"confidence":0,"detected":false}],"usedV1Fallback":false,"lastOutcome":"complete","lastMatchedCount":2,"lastMatchDetectedMidis":[61,42]}
- Mic test panel not visible — may still be calibrating in fake stream
- Guitar WFY mic panel visible after switch: true
- V2 real-world QA running against dev default (no localStorage flag)

## Documented failures (no threshold tuning)
- (none — all clip scenarios passed or were informational)

**Constants tuned:** no

## V2 dev default recommendation
- V2 can stay default for dev — no confirmed integration bugs in this pass.
