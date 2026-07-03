# Real Mic Browser QA Report

**Generated:** 2026-07-03T16:44:06.755Z

**Passed:** 14 · **Failed:** 0

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

## What failed
- (none)

## Notes
- __SCOREFLOW_MIC_DEBUG__ not exposed (production build?)
- Mic test panel not visible — may still be calibrating in fake stream
- Guitar WFY mic panel visible after switch: true

## Documented failures (no threshold tuning)
- (none — all clip scenarios passed or were informational)

**Constants tuned:** no

## V2 dev default recommendation
- V2 can stay default for dev — no confirmed integration bugs in this pass.
