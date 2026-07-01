# OMR Deep Benchmark Sprint

Generated: 2026-07-01T00:10:30-04:00

## Final Result

| Fixture | Pitch | Duration | Onset | Chord | F1 | Measure delta | Note delta | Wrong pitch | Wrong duration | Wrong onset | Chord mismatch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean | 100.00% | 99.79% | 100.00% | 100.00% | 100.00% | 0 | 0 | 0 | 1 | 0 | 0 |
| dense baseline | 93.67% | 95.23% | 95.55% | 92.43% | 98.95% | 0 | -3 | 147 | 103 | 94 | 221 |
| dense final | 93.67% | 95.59% | 95.55% | 93.09% | 98.95% | 0 | -3 | 147 | 93 | 94 | 201 |

## Sprint Attempts

| Target | Diagnosis | Attempted fix | Kept? | Before | After | Reports |
| --- | --- | --- | --- | --- | --- | --- |
| m25/m29/m89 phantom-column chord grouping | Family B signature: solo columns at div%4===3 linked to stack columns two sixteenths later. Simulation showed stack realignment helped while deleting phantom solos regressed. | Runtime `applyPhantomColumnCorrection` after inner-voice phase correction; shift linked stacks -1 division, preserve note/measure count. | Kept | chord 92.43%, mismatches 221 | chord 93.09%, mismatches 201; pitch/onset/duration unchanged | `phantom-sim-current/summary.md`, `phantom-runtime/report.md` |
| Page-8 residual pitch | Current pitch errors remain mixed after existing staff-gap normalization; many are matching/onset coupled or accidental/register residue. | Diagnosis only; no pitch/staff mapping change. | Not changed | wrong pitch 147 | unchanged | `post-phantom-pitch-analysis.json`, `final-pitch-analysis.json` |
| Pure chord-only m113/m94/m57 | m113 correction fires later than its remaining opening mismatch; tightening/skipping inner-voice rule would not fix the measured error. m94/m57 are smaller and similar opening/serialization cases. | Diagnosis only; no runtime change. | Not changed | chord mismatches 201 after phantom | unchanged | `final-rerank.json` |
| Terminal same-clef chord duration | Remaining independent 1q->0.5q bucket had repeated terminal treble chords at beat-grid starts, no beam evidence, no later same-clef attack. Simulation improved duration with no clean/onset/chord/pitch regression. | Add terminal same-clef chord quarter floor; re-apply the same narrow rule after phantom realignment for stacks that become terminal after shifting. | Kept | duration 95.23%, wrong durations 103 | duration 95.59%, wrong durations 93; pitch/onset/chord unchanged from post-phantom | `terminal-quarter-sim/summary.md`, `terminal-quarter-runtime/report.md`, `final-duration-analysis.json` |

## Stop Point

Remaining dense errors are no longer a small obvious patch target:

- Chord mismatches are still largest raw count, but top hotspots are entangled with missing/extra/onset or opening serialization.
- Wrong pitch remains concentrated in mixed matching/onset/staff residuals after staff-gap normalization; no safe direct pitch-map fix was evident.
- Wrong duration is now 93, with 49 onset-coupled and the remaining independent categories split into small patterns.

Avoid next:

- Broad beam duration caps.
- Beam ownership event splitting or voice serialization runtime promotion.
- Global staff-y offsets or broad clef/staff remaps.
- Broad foreign-clef duration extension.
- Opening-column broadening or global snap changes.

Verification:

- `npm run omr:benchmark-dashboard`: pass.
- `npm run build`: pass.
- `npm test -- --testTimeout 30000`: pass, 138 files / 1315 tests / 5 skipped.
- Plain `npm test` hit the existing 5s timeout in real-PDF Spider Dance tests; rerun with 30s timeout passed.
