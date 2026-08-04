# Real Mic Browser QA Report

**Generated:** 2026-08-01T02:20:37.581Z

**Passed:** 27 · **Failed:** 0

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
- recent mic trace export contains live browser frames — frames=102
- mic shows actionable status after grant — No input — check mic
- mic calibration status line present — No input — check mic
- leaving WFY hides mic panel and test UI
- instrument switch does not show stale Last confirmed mic feedback
- ipad WFY mic layout — no horizontal overflow
- mobile WFY mic layout — no horizontal overflow
- quiet room fixture — mic enabled without crash
- noisy room fixture — mic enabled without crash
- noisy room does not show false Last confirmed

## What failed
- (none)

## Notes
- Mic test panel not visible — may still be calibrating in fake stream
- Hear It not visible — checkpoint may not be a note yet
- Mic off notice not shown on re-entry — may auto-resume in some builds
- Guitar WFY mic panel visible after switch: true
- Quiet room calibration text: Mic listening
- Noisy room calibration: Mic listening

## Documented failures (no threshold tuning)
- (none — all clip scenarios passed or were informational)

**Constants tuned:** no

## V2 dev default recommendation
- V2 can stay default for dev — no confirmed integration bugs in this pass.
