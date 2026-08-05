# Extreme-register microphone recognition campaign

## Outcome

The accepted repair materially improves the production score-informed microphone path across the full claimed piano range without changing OMR, absolute-note matching, or global confidence thresholds.

- Starting HEAD: `c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4`
- Final HEAD / accepted commit: `2366c3727d1c0794a57a2b1ef4ff185a7ce7ab29`
- Protected OMR implementation point: `50a3ea39ce45d61dde470d636ee27f6ed44a2e21`
- Corpus: 131 deterministic generated-signal fixtures, 158 played attacks, 154 expected score outcomes per mode, MIDI 21..108
- Wait For You: false negatives `19 -> 2`, false positives `11 -> 0`, octave errors `2 -> 0`
- Follow Along: false negatives `13 -> 4`, false positives `3 -> 0`, octave errors `2 -> 0`
- High and extreme-high bins: zero false negatives, false positives, and octave errors after repair in both modes
- Low and middle bins: remain perfect in both modes
- All remaining misses are in one deliberately severe eight-note, 105 ms-per-note deep-bass passage. The normal fast deep-bass passage passes.
- No physical microphone or acoustic piano was tested in this campaign.

## Starting-state verification

The campaign began by verifying:

- `git rev-parse HEAD` exactly equaled `c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4`.
- The tracked working tree was clean.
- `git show --stat --oneline c1faa8c5ba8913cdc5f7862401bcfc4d08b8e8c4` reported 1,740 changed paths: 1,733 under `tmp/`, six research/audit scripts, and one generated Python bytecode file.
- The commit contains no production runtime source, committed tests, evaluator implementation, benchmark truth, tolerances, or expected-result fixture changes. The scripts are research/audit tooling, not shipped runtime code.
- `c1faa8c` is a direct child of `50a3ea3`; the accepted OMR production implementation from `50a3ea39ce45d61dde470d636ee27f6ed44a2e21` remained intact. The new campaign baseline was therefore accepted without reverting or rewriting it.

## Full live microphone path

Both modes use the same capture and the same `useWaitForYouMicInput` detector/matcher composition:

`MediaStream -> AudioContext -> AnalyserNode -> time-domain history -> raw frame features + expected-note spectral candidates -> harmonic/octave guards -> musical/confidence gate -> temporal confirmation -> attack latch/rearm -> absolute-MIDI matcher -> mode outcome`

- Capture requests mono instrument audio with echo cancellation, noise suppression, and automatic gain control disabled.
- One `MediaStream`, `AudioContext`, source, analyser, and time-domain buffer are shared by Wait For You and Follow Along. Their mutually exclusive activation predicates prevent two active detector loops.
- The browser supplies the sample rate; deterministic measurement uses 44,100 Hz. Production also supports the common 48 kHz path.
- Baseline capture and every analysis stage used 2,048 samples: 46.44 ms at 44.1 kHz or 42.67 ms at 48 kHz. Nominal live hop is one animation frame, 16.67 ms at 60 Hz.
- After repair, the analyser retains 8,192 samples. Level, noise, attack, signal shape, and the independent autocorrelation tracker still use only the latest 2,048 samples. A single expected note at MIDI 21..32 uses the 8,192-sample spectral history; all other piano notes, chords, and Guitar/TAB remain on 2,048 samples.
- Deep bass uses a causal one-sided Hann ramp: stale history is tapered and the newest samples receive full weight. Other registers retain the symmetric Hann window.
- The independent pitch tracker searches 55..1,400 Hz, converts with `69 + 12*log2(f/440)`, and clamps quantized output to MIDI 21..108. It is diagnostic outside its reliable band and is not allowed to contradict the score-informed family there.
- The expected-note scorer probes the exact expected fundamental and up to five in-band harmonics with Goertzel magnitudes, local noise probes, adjacent-note leakage guards, absolute-octave guards, and harmonic-family confidence.
- Matching remains exact absolute MIDI by default. Wrong octaves and pitch-class-only matches remain rejected. Score context chooses which acoustic family to examine; it cannot create a match without current acoustic evidence.
- Deep-bass matches require two consecutive confident long-window frames; all other single notes retain three. Middle/high confirmation behavior is unchanged.
- A completed score event consumes the attack latch. Four closed frames release it. A sustained note cannot trigger again; a repeated note needs a new energy/derivative attack or full release.
- Wait For You advances its distinct score checkpoint after confirmation. Follow Along uses the same detector and matcher to mark the playback-selected lane group; playback time remains cursor authority.
- Detector state resets on checkpoint/analysis-key, profile/instrument, calibration, enable/disable, mode exit, score replacement, retry, and unmount boundaries.

The baseline trace with thresholds, timing, lifecycle, and source locations is in `PHASE_1_PIPELINE_TRACE.md`.

## Root causes

1. **Insufficient deep-bass observation:** 2,048 samples contain only 1.28 A0 cycles at 44.1 kHz. Adjacent deep-bass probes leaked into one another, next WFY targets confirmed before their attacks, and A1 could supply a convincing even-harmonic family for expected A0.
2. **Missing absolute octave evidence:** expected C8 h1 is acoustically identical to played C7 h2 unless the scorer also probes the immediate lower octave's fundamental. The inverse low-register problem needed odd/even harmonic-family evidence.
3. **Above-Nyquist analysis:** h1..h6 were probed even when a partial exceeded Nyquist, producing folded digital energy rather than physical harmonic evidence.
4. **Register-neutral musical gate:** legitimate high notes with weak fundamentals/dominant h2 or h3 were classified as speech/formant-like. The fixed zero-crossing cap also penalized real extreme-high tones.
5. **Raw-tracker confirmation mismatch:** octave flips restarted confirmation even though octave-related raw estimates are common on harmonic-rich notes. Near 1,400 Hz, boundary/subharmonic estimates could veto correct exact-frequency evidence.
6. **No high-register reattack path:** repeated C8 depended on full release or a broad 1.6x whole-frame RMS jump. Legitimate reattacks below that threshold stayed latched.
7. **One temporal policy for every register:** long-window deep-bass evidence sometimes existed for only two live hops during very short events, while a fixed three-frame policy required a third.
8. **Mode timing exposed state differently:** WFY changes its target only after a match, while Follow Along changes with playback time. The detector/matcher was shared, but deep-bass leakage and latch timing produced different outcomes.

Exact score-event matching and OMR were not root causes.

## Repair accepted

The final change is one coherent register-aware detector/matcher repair:

1. Retain 8,192 capture samples, split short signal analysis from long deep-bass identity analysis, and use a causal long window so new attacks are not down-weighted for half a window.
2. Ignore every spectral probe at or above Nyquist.
3. Add deep-bass odd/even family scoring to reject an upper-octave fundamental masquerading as the expected low note.
4. Probe the immediate lower-octave fundamental for high notes and reject lower-octave/subharmonic impostors.
5. Accept coherent weak-fundamental extreme-high and third-harmonic-deep-bass families only with decaying harmonic structure, sufficient ratio/confidence, and clear octave guards.
6. Make confirmation drift octave-invariant, restrict raw-pitch anchoring/corroboration to its reliable band, and use two-frame confirmation only for single expected MIDI 21..32. No confidence threshold or MIDI tolerance was broadly lowered.
7. Add absolute first-difference RMS as an attack-magnitude envelope. Use it for strongly guarded high reattacks and for real deep-bass attack edges while preserving the accepted repeated-low-note behavior.
8. Disable score-only deep-bass transition rearming; deep-bass neighbors require physical attack evidence. Sustained notes still trigger once.
9. Continue using the same detector and exact matcher hook in Wait For You and Follow Along, with lifecycle resets at every ownership/mode boundary.

## Experiments and decisions

### Accepted

- **8,192-sample deep-bass history:** directly rejected the A1-as-A0 failure without changing thresholds.
- **Causal long window:** improved fast Follow Along deep-bass outcomes by weighting the newest attack while retaining enough history for octave evidence.
- **Nyquist clamp plus octave-family guards:** removed all matcher octave errors in the corpus.
- **Coherent harmonic-profile exceptions:** recovered weak-fundamental and compressed high notes while noise, speech, wrong-octave, and harmonically related controls stayed rejected.
- **Octave-invariant/reliable-band confirmation:** recovered intermittent MIDI 78/89 cases without accepting wrong octaves.
- **Absolute derivative rearm:** restored repeated/fast high attacks and strengthened genuine low-attack timing without allowing held-note duplicates.
- **Two-frame deep-bass confirmation:** reduced final WFY deep-bass misses from five to two and removed its last false positive. Middle/high remain at three frames.

### Rejected or revised

- **4,096 samples for MIDI 22..32:** rejected. It produced WFY `FN=7, FP=4` and Follow Along `FN=7`, worse than the 8,192-sample candidate. The experiment was reverted completely.
- **First rising-edge-only low rearm revision:** initially regressed the protected repeated-low corpus from 74/74 to 73/74. It was revised so live derivative-aware calls get the physical edge guard while legacy/offline accepted behavior remains; the protected corpus returned to 74/74.
- **Global threshold reduction, pitch-class matching, expected-note override, and one-frame deep-bass acceptance:** not attempted/accepted because they would trade false positives for apparent recall or treat score context as acoustic proof.

## Deterministic corpus results

### Overall modes

| Path | Expected | Baseline matched | Final matched | Baseline FN | Final FN | Baseline FP | Final FP | Baseline octave | Final octave | Median before -> after | Max before -> after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Wait For You | 154 | 135 | 152 | 19 | 2 | 11 | 0 | 2 | 0 | 63.11 -> 56.44 ms | 273.11 -> 258.11 ms |
| Follow Along | 154 | 141 | 150 | 13 | 4 | 3 | 0 | 2 | 0 | 59.77 -> 56.44 ms | 273.11 -> 203.11 ms |

### Register-binned Wait For You

| Register | Expected | Baseline FN / FP / octave | Final FN / FP / octave | Median before -> after | Final max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Extreme low, MIDI 21..32 | 52 | 9 / 10 / 1 | 2 / 0 / 0 | 56.44 -> 39.77 ms | 258.11 ms |
| Low, MIDI 33..47 | 15 | 0 / 0 / 0 | 0 / 0 / 0 | 73.11 -> 56.44 ms | 56.44 ms |
| Middle, MIDI 48..72 | 25 | 0 / 0 / 0 | 0 / 0 / 0 | 56.44 -> 56.44 ms | 56.44 ms |
| High, MIDI 73..95 | 23 | 2 / 0 / 0 | 0 / 0 / 0 | 89.77 -> 56.44 ms | 189.77 ms |
| Extreme high, MIDI 96..108 | 43 | 8 / 1 / 1 | 0 / 0 / 0 | 89.77 -> 56.44 ms | 79.77 ms |

### Register-binned Follow Along

| Register | Expected | Baseline FN / FP / octave | Final FN / FP / octave | Median before -> after | Final max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Extreme low, MIDI 21..32 | 52 | 3 / 2 / 1 | 4 / 0 / 0 | 56.44 -> 39.77 ms | 203.11 ms |
| Low, MIDI 33..47 | 15 | 0 / 0 / 0 | 0 / 0 / 0 | 73.11 -> 56.44 ms | 56.44 ms |
| Middle, MIDI 48..72 | 25 | 0 / 0 / 0 | 0 / 0 / 0 | 56.44 -> 56.44 ms | 56.44 ms |
| High, MIDI 73..95 | 23 | 2 / 0 / 0 | 0 / 0 / 0 | 89.77 -> 56.44 ms | 189.77 ms |
| Extreme high, MIDI 96..108 | 43 | 8 / 1 / 1 | 0 / 0 / 0 | 89.77 -> 56.44 ms | 79.77 ms |

The two mode bins overlap on transition fixtures and should not be summed across registers. Across both modes, extreme-low false negatives fall from 12 to 6 and false positives from 12 to zero. Follow Along's extreme-low FN count alone rises by one because the repaired detector refuses to infer four events in the 105 ms stress passage from smeared prior-note energy; this is an explicit safety tradeoff, not hidden in the aggregate. Its overall FN count falls from 13 to 4.

The blind 55..1,400 Hz autocorrelation diagnostic remains `61/158`, `FN=97`, `FP=0`, and 40 raw octave/subharmonic errors. It is intentionally not the final extreme-register matcher and was not made permissive. Production advancement at the extremes uses the acoustically guarded V2 family above; raw estimates contribute only where physically reliable.

## Repeated, sustained, octave, and adverse-signal behavior

- Repeated A0 and repeated C8 rearm from a genuine new attack.
- Sustained A0 and sustained C8 advance exactly once; sustained double triggers remain zero.
- Wrong A1 for expected A0 and wrong C7 for expected C8 produce no advance.
- Harmonically related but incorrect low/high notes produce no advance.
- Low h2-dominant and h3-dominant fundamentals are recovered.
- 50/60 Hz hum, broadband noise, room resonance, compression, mild clipping, and reverb cases remain measured in the corpus.
- Normal fast low and high passages pass. The one remaining failure is the deliberately severe 105 ms-per-event deep-bass sequence: WFY matches 6/8 and Follow Along 4/8, with zero false positives and zero octave errors.

## Resource lifecycle

- Unit lifecycle tests: 7/7 passed, covering raw-constraint fallback, permission denial, ended streams, listener removal, suspended/interrupted context resume, resume failure/device reconnection, and explicit stop cleanup.
- Capture shutdown invalidates pending requests, removes recovery listeners, stops all stream tracks, nulls analyser/buffer references, and closes the context.
- Detector shutdown cancels its animation frame and resets all V2 tracks. Checkpoint, score, instrument, calibration, retry, and mode transitions clear confirmation/latch state.
- Browser QA confirmed microphone auto-start after permission, mode exit cleanup at the UI boundary, and no stale confirmed feedback after instrument switching.
- Wait For You and Follow Along share one capture. No worklet is used by this implementation, and no duplicate stream/context/listener/timer path was found.

## Complete validation

| Gate | Result |
| --- | --- |
| Full-range deterministic corpus | 131/131 cases executed; 158 played attacks; final JSON recorded |
| Focused extreme-register tests | 28/28 passed |
| Focused microphone/matcher/lifecycle suite | 17/17 files; 302/302 tests passed |
| Protected repeated-low corpus | 74/74 expected advances; FN=0, FP=0 |
| Browser-injected microphone QA | 27/27 passed |
| Full unit suite | 285/285 files; 2,906 passed; 5 intentional skips; 0 failed |
| Production build | Passed; 1,497 modules transformed; pre-existing large-chunk warning only |
| Frozen OMR corpus | 9/9; evaluator 2.0.0/schema 2; exact metric/fixture equality with `commit-50a3ea3-semantic.json` |
| OMR metrics | Overall 71.094%; Pitch 75.740%; Rhythm 81.226%; Articulation 90.598%; Measure 81.201%; Sustain 55.556% |
| OMR defects | 650 total; incorrect pitch 110; incorrect chord 122; onset mismatches 81 |
| OMR/evaluator/fixtures diff | None from campaign baseline |
| Guitar/TAB | All Guitar/TAB OMR, lane, mapping, WFY, microphone, playback, and switching tests in the full suite passed |
| Playback/audio | All playback engine, scheduling, seek, instrument, piano/guitar, metronome, warmup, unlock, and audio sync tests passed |
| Ownership/switching | Score replacement/generation gate, active-score, instrument bundle, Piano<->Guitar, and stale-result tests passed |
| Report/export | Recognition problem report, OMR playback report, benchmark/report, and microphone report/export tests passed |
| Heavy-score performance | Passed all four assertions; dense 802-note/49-measure parse 38.12 ms cold, 0.92 ms cached; visual groups 3.79 ms cold, 0.005 ms cached |

The repository-wide lint command remains red on 262 pre-existing React-compiler/legacy test lint findings outside this campaign; lint was not an acceptance gate. The campaign's build, complete test suite, and required behavioral gates are green.

## Physical-device follow-up checklist

Run this on the user's normal computer/phone and usual microphone, recording browser/device/sample rate and any automatic input-processing settings:

- [ ] In Wait For You, play the piano/keyboard's lowest available notes, especially A0, A#0, B0, and neighboring chromatic notes.
- [ ] In Follow Along, repeat the same lowest-note sequence in time with playback.
- [ ] Play the highest available notes, especially B7/C8 and neighboring chromatic notes, in both modes.
- [ ] Test soft, normal, and loud attacks at both extremes.
- [ ] Repeat the same extreme note with clear separate attacks; verify one advance per attack.
- [ ] Sustain a low note and a high note; verify each advances once only.
- [ ] Play low->high, high->low, octave-up, and octave-down transitions; verify the absolute octave shown is correct.
- [ ] Try short/staccato and fast extreme-note passages, then slow passages.
- [ ] Repeat with ordinary room noise, HVAC/50/60 Hz hum, and the normal phone/computer distance.
- [ ] Stop/restart the microphone, switch Wait For You <-> Follow Along, replace the score, and switch Piano <-> Guitar; verify no stale note or duplicate permission/capture behavior.

## Remaining limitations

- Real microphones, real rooms, device DSP, and a physical piano/keyboard still require the manual validation above. Deterministic synthesis and browser-injected audio cannot prove transducer behavior.
- The independent raw autocorrelation tracker is intentionally limited to 55..1,400 Hz. Extreme advancement relies on the exact expected-note harmonic family plus octave/noise/temporal/attack guards, not blind full-range note naming.
- The 105 ms-per-event eight-note sequence at MIDI 21..28 remains beyond reliable complete capture with the current monophonic rolling-window architecture. Lowering to one frame or allowing expected-note leakage would violate the false-positive and acoustic-evidence rules, so the safe limitation is retained.
- The campaign does not add polyphonic microphone chord recognition and does not alter OMR.

## Artifacts

- `PHASE_1_PIPELINE_TRACE.md`
- `PHASE_2_FULL_RANGE_BASELINE.md`
- `PHASE_3_ROOT_CAUSES.md`
- `extreme_mic_baseline.json`
- `extreme_mic_after.json`
- `omr-final.json` / `omr-final.txt`

All artifacts are under `tmp/mic-extreme-register/` and are intentionally excluded from the production commit.
