# Real Mic Browser QA Report

**Generated:** 2026-07-07T20:04:25.655Z

**Passed:** 28 · **Failed:** 0

## What worked
- frame replay: next different note advances while previous rings
- frame replay: sustained note does not skip checkpoints
- frame replay: repeated same note requires fresh attack
- frame replay: repeated same note accepts fresh attack
- frame replay: speech over ringing instrument does not advance
- frame replay: room noise does not advance
- frame replay: quiet piano note advances
- frame replay: quiet acoustic guitar note advances
- frame replay: quiet electric-style guitar note advances
- frame replay: guitar double-stop with one weak tone advances
- frame replay: one double-stop tone alone does not advance
- frame replay: staggered guitar double-stop advances
- frame replay: wrong guitar double-stop does not advance
- mic permission denied shows Mic blocked
- WFY section visible with Microphone source
- mic permission grant enables capture — auto-started
- production build uses V2 mic engine when flag unset — v2-score-informed
- recent mic trace export contains live browser frames — frames=120
- mic shows actionable status after grant — Ready — play the highlighted note
- mic calibration status line present — Ready — play the highlighted note
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
