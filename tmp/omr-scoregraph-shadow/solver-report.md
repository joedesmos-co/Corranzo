# ScoreGraph solver (shadow) — hard-constraint clip

Fixtures: 1

## la-campanella
- solver vs runtime: notesΔ 0, measuresΔ 0, identical-bytes false
- changed shadow measures: 30/160 (53 clip decisions)
- solver↔runtime agreement (whole score): pitch 100%, duration 98%, onset 100%, chord 100%
- clip violation types: same-voice-overlap:53
- candidate-family measures: 80/160 (hard-constraint failures 34)
- fallbacks: identity-baseline:126, ambiguous-culprit:3, clip-unresolved:1
- shadow − runtime vs truth: duration +0.91%, onset +0.02%, pitch +0.05%, chord +0.11%, F1 -0.04%
- changed measure numbers (first 20): 14, 19, 21, 28, 29, 40, 52, 53, 54, 55, 56, 57, 62, 64, 66, 68, 69, 94, 97, 98

