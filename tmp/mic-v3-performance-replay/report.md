# Mic Engine V3 performance replay

Engine: **v3-performance-expectation**
Coverage: 18 musical events · 3 controls

## Event metrics
- Event hit rate: 94.4% (17/18)
- First-attempt success: 94.4%
- Average confirmation latency: 81 ms
- Average chord completion latency: 24 ms
- False advances: 0 (0.0%)
- False rejects: 1 (5.6%)
- Invalid latency annotations excluded: 0

## Reliability slices
- Quiet playing: 100.0% (1/1)
- Electric guitar: 100.0% (3/3)
- Acoustic timbre: 88.9% (8/9)
- Guitar double-stops: 100.0% (4/4)
- Piano dyads: 100.0% (3/3)
- Triads: 100.0% (7/7)
- Large chords: 75.0% (3/4)
- Ringing transitions: 100.0% (1/1)
- Ringing audio fixtures: 100.0% (1/1)
- Musical sequence replay: 8/8 scenarios · 0 false advances

## Provenance warning
- Natural performance recordings: 0
- Synthetic or isolated-sample proxies: 21
- Proxy results are not described as live-instrument validation.

## Per clip
- **synth-dyad-c4-e4** → accepted · 2/2 tones · confirm 46 ms · complete 0 ms · expected-rolled-piano-event-complete
- **synth-c-major-triad** → accepted · 3/3 tones · confirm 46 ms · complete 0 ms · expected-rolled-piano-event-complete
- **synth-g7-tetrad** → accepted · 4/4 tones · confirm 46 ms · complete 0 ms · expected-rolled-piano-event-complete
- **synth-rolled-c-major** → accepted · 3/3 tones · confirm 213 ms · complete 167 ms · expected-rolled-piano-event-complete
- **synth-silence** → correct reject · 0/0 tones · confirm — · complete — · control-correct-reject
- **synth-noise** → correct reject · 0/0 tones · confirm — · complete — · control-correct-reject
- **real-c-major-triad** → accepted · 3/3 tones · confirm 46 ms · complete 0 ms · expected-rolled-piano-event-complete
- **real-dyad-c4-g4** → accepted · 2/2 tones · confirm 46 ms · complete 0 ms · expected-rolled-piano-event-complete
- **real-room-quiet** → correct reject · 0/0 tones · confirm — · complete — · control-correct-reject
- **uiowa-piano-mf-c4-e4-dyad** → accepted · 2/2 tones · confirm 73 ms · complete 0 ms · expected-rolled-piano-event-complete
- **uiowa-piano-mf-c-major-triad** → accepted · 3/3 tones · confirm 106 ms · complete 33 ms · expected-rolled-piano-event-complete
- **uiowa-piano-mf-cmaj7** → rejected · 3/4 tones · confirm — · complete — · piano-chord-progress
- **uiowa-piano-mf-ringing-c-major** → accepted · 3/3 tones · confirm 106 ms · complete 33 ms · expected-rolled-piano-event-complete
- **uiowa-piano-pp-c-major-triad** → accepted · 3/3 tones · confirm 73 ms · complete 0 ms · expected-rolled-piano-event-complete
- **uiowa-piano-mf-split-c3-e4-g4** → accepted · 3/3 tones · confirm 73 ms · complete 0 ms · expected-rolled-piano-event-complete
- **uiowa-guitar-mf-adjacent-g3-b3** → accepted · 2/2 tones · confirm 73 ms · complete 17 ms · expected-guitar-event-complete
- **uiowa-guitar-mf-low-high-e2-e4** → accepted · 2/2 tones · confirm 123 ms · complete 100 ms · expected-guitar-event-complete
- **uiowa-guitar-mf-open-em-strum** → accepted · 3/6 tones · confirm 156 ms · complete 50 ms · expected-guitar-event-complete
- **synth-electric-clean-dyad-a2-e3** → accepted · 2/2 tones · confirm 46 ms · complete 0 ms · expected-guitar-event-complete
- **synth-electric-distorted-power-e2-b2** → accepted · 2/2 tones · confirm 46 ms · complete 0 ms · expected-guitar-event-complete
- **synth-electric-clean-open-em** → accepted · 4/6 tones · confirm 46 ms · complete 0 ms · expected-guitar-event-complete
