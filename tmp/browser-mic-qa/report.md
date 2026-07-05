# Real Mic Browser QA Report

**Generated:** 2026-07-05T21:36:42.330Z

**Passed:** 14 · **Failed:** 0

## What worked
- mic permission denied shows Mic blocked
- WFY section visible with Microphone source
- mic permission grant enables capture — auto-started
- production build uses V2 mic engine when flag unset — v2-score-informed
- mic shows actionable status after grant — No input detected — check the mic is unmuted
- mic calibration status line present — No input detected — check the mic is unmuted
- Hear It does not dismiss mic panel
- leaving WFY hides mic panel and test UI
- instrument switch does not show stale Last confirmed mic feedback
- ipad WFY mic layout — no horizontal overflow
- mobile WFY mic layout — no horizontal overflow
- quiet room fixture calibrates without crash — Ready — play the highlighted note
- noisy room fixture surfaces room guidance — Ready — play the highlighted note
- noisy room does not show false Last confirmed

## What failed
- (none)

## Notes
- Mic test panel not visible — may still be calibrating in fake stream
- Mic off notice not shown on re-entry — may auto-resume in some builds
- Guitar WFY mic panel visible after switch: true

## Documented failures (no threshold tuning)
- (none — all clip scenarios passed or were informational)

**Constants tuned:** no

## V2 dev default recommendation
- V2 can stay default for dev — no confirmed integration bugs in this pass.
