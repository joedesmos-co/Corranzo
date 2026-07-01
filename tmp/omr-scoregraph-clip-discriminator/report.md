# ScoreGraph Clip Promotion Discriminator Analysis

Runtime/default behavior was not changed. This report analyzes saved default and `promoteScoreGraphClips=true` benchmark outputs plus a diagnostic-only `includeScoreGraph` extraction.

## Benchmark Outcome

- Clean Gymnopedie duration: 100.00% -> 83.80% (-16.20pp); wrong durations 0 -> 76.
- Dense Cruel Angel duration: 95.59% -> 95.77% (+0.18pp); wrong durations 93 -> 88.
- Dense onset slightly regressed: 95.55% -> 95.52% (-0.03pp); wrong onsets 94 -> 95.

## Clean False Positives

- Full diagnostic extraction found 76 clean clip decisions across 74 promoted measures.
- 76 / 76 were same-voice-overlap clips; no overflow cases.
- 76 / 76 clipped dotted-half-length events (12 divisions = 3q) down to quarter notes (4 divisions = 1q).
- 74 / 76 were bass-clef/voice-2; the only voice-1 cases were measures 37 and 76, also 12->4 sustained-tone clips.
- 76 / 76 occurred in 3/4.
- 76 / 76 had zero beam candidates; 76 / 76 had no beamed-current-long disagreement.
- 76 / 76 were in measures whose original/default runtime duration matching was already clean.

Interpretation: the solver treated a musically valid sustained voice as a hard same-voice overlap. In Gymnopedie, the bass note at measure start is a sustained dotted-half/pedal tone while other same-clef notes enter later. The current hard-constraint model collapses those independent voices into one clef-based voice, sees the later onset as an overlap, and clips the sustained note to the next onset. That creates the 76 too-short duration errors.

## Dense Promotions

| m | decision | margin | wrongDur before->after | wrongOnset before->after | beam attach | graph long | mixed/split |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | same-voice-overlap v2 8->4 | 0.25 | 2->5 | 2->2 | 0.4286 | 3 | 0/0 |
| 9 | same-voice-overlap v2 10->2 | 0.5 | 4->3 | 18->18 | 0.2368 | 0 | 2/0 |
| 27 | same-voice-overlap v2 2->1 | 0.0625 | 0->0 | 1->1 | 0.5152 | 8 | 1/0 |
| 29 | same-voice-overlap v2 2->1 | 0.25 | 1->0 | 0->1 | 0 | 0 | 0/0 |
| 29 | same-voice-overlap v2 2->1 | 0.25 | 1->0 | 0->1 | 0 | 0 | 0/0 |
| 29 | same-voice-overlap v1 5->4 | 0.25 | 1->0 | 0->1 | 0 | 0 | 0/0 |
| 29 | same-voice-overlap v1 4->3 | 0.25 | 1->0 | 0->1 | 0 | 0 | 0/0 |
| 33 | overflow v2 3->2 | 0.125 | 0->0 | 0->0 | 0.2667 | 8 | 1/1 |
| 33 | overflow v1 3->2 | 0.125 | 0->0 | 0->0 | 0.2667 | 8 | 1/1 |
| 56 | same-voice-overlap v1 12->3 | 0.5625 | 1->0 | 0->0 | 0.9524 | 3 | 0/0 |
| 58 | same-voice-overlap v1 12->3 | 0.5625 | 1->0 | 0->0 | 0.9524 | 2 | 1/1 |
| 59 | same-voice-overlap v2 12->3 | 0.625 | 4->0 | 0->0 | 0.6364 | 3 | 0/0 |
| 59 | same-voice-overlap v1 4->3 | 0.625 | 4->0 | 0->0 | 0.6364 | 3 | 0/0 |
| 89 | same-voice-overlap v2 2->1 | 0.25 | 0->0 | 0->0 | 0 | 0 | 1/0 |
| 89 | same-voice-overlap v2 2->1 | 0.25 | 0->0 | 0->0 | 0 | 0 | 1/0 |
| 89 | same-voice-overlap v1 5->4 | 0.25 | 0->0 | 0->0 | 0 | 0 | 1/0 |
| 89 | same-voice-overlap v1 4->3 | 0.25 | 0->0 | 0->0 | 0 | 0 | 1/0 |
| 94 | same-voice-overlap v2 3->2 | 0.1875 | 0->0 | 0->0 | 0.1481 | 4 | 3/1 |
| 94 | overflow v2 3->2 | 0.1875 | 0->0 | 0->0 | 0.1481 | 4 | 3/1 |
| 94 | overflow v1 3->2 | 0.1875 | 0->0 | 0->0 | 0.1481 | 4 | 3/1 |

Dense takeaways:

- m56, m58, and m59 are the useful family: beam-heavy measures with graph-beamed-current-long evidence, reducing wrong durations by 6 total and not changing onset errors.
- m5 is a false positive even though it has some beam evidence: wrong durations worsen 2 -> 5. Its beam attachment is only 0.4286.
- m29 improves one duration but introduces one onset error, and has no beam candidates; m89 is no-beam and neutral.
- m27, m33, and m94 are neutral on duration; they are not enough to justify the clean risk.

## Candidate Discriminator

Best available guard from current diagnostics:

```text
only consider clip promotion when:
  beamAttachmentRate >= 0.60
  and graphBeamedButCurrentLong > 0
```

This rejects 76/76 clean false-positive decisions and keeps 0 clean decisions.
On dense, it keeps measures 56, 58, 59 and rejects 5, 9, 27, 29, 33, 89, 94.
Using per-measure attribution from the enabled run, the kept dense measures account for wrongDuration delta -6 and wrongOnset delta 0.

This is not enough to promote runtime yet. It is a promising simulation target because it encodes musical evidence (beam ownership), not title/page/measure identity, and it directly excludes the clean all-unbeamed sustain pattern.

## Recommendation

Keep `promoteScoreGraphClips` default-off. Do not tune confidence/margin: clean false positives have confidence 0.9 and margins around 0.6667, so thresholding confidence/margin would not solve the problem without also killing useful dense cases.

Next safe milestone: run a simulation-only promotion variant with the beam-dominance guard above. If that simulation preserves clean 100% duration and improves dense duration without onset regression, then consider a tiny gated runtime slice. If not, abandon generic hard-constraint clip promotion until ScoreGraph has real voice ownership rather than clef-based voice collapse.
