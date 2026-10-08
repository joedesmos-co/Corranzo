# Guitar Targeted Data-Gap Rescue (G1–G8)

**Manifests:** `datasets/guitar-vision/v2/` (12 real + 48 etudes + 5 synthetic;
68 families) · `pdmx/` (51 real) · `pdmx-pilot/` + `v2-pilot/` preserved
**Method:** no second archive stream (G1 evidence below); 15 new original
etudes; 4th render layout (Bravura glyph variation); renderer-gap mask for
TAB rests; per-part rhythm lanes.

## RETURN

1. **New external real scores:** 0. Remaining 53 PDMX members show no
   technique signals in metadata (5 weak 'tab' keyword hits, all
   flute/violin-ensemble pieces). Per G1, no second stream was run.
2. **New original etudes:** 15 (48 total) — TAB-only rhythm/chords/voices,
   paired same-part mirrors + legato, quarter-tone bends, bend+slide combos,
   mixed legato, palm chug, fingerpicked let-ring, vibrato phrase, grace
   cadence, seventh frames, open-G tuning, harmonic touches. Phrase-shaped
   (antecedent/consequent + cadences), all 48 validate clean.
3. **TAB-only count:** 3 etudes (0 real). TAB-only remains a real DATA_GAP.
4. **Paired TAB count:** 11 real PDMX + 3 etudes (1 cross-part, 2 same-part).
5. **Technique coverage:** etudes 140 instances / 92 parameters, 14 families;
   real PDMX adds arpeggio/slide/mordent/trill/turn only. Bends, legato,
   harmonics, tapping, palm-mute, capo have etude supervision; zero real.
6. **Exact truth validation:** joins 1.0 × 4 layouts on all 65 v2 PASS;
   pairings verified (incl. capo/tuning/harmonic physics); relations resolve;
   renderer merges attached by exact rules; TAB-rest renderer gap masked
   explicitly (Verovio never propagates ids to TAB rests — verified).
7. **Layout diversity:** standard/compact/large geometry + Bravura font
   (genuine glyph variation); `xmlIdSeed` fixed for byte-stable renders;
   spacing knobs recorded for the 150-scale phase.
8. **Frozen split integrity:** v2 splits 29/16/13/2, audit CLEAN,
   technique-grouped etudes spread across splits; all prior manifests sealed.
9. **Remaining gaps:** 21 real DATA_GAPs (all bends/legato/harmonics/tapping/
   palm-mute + capo/frames/navigation/grace-cue in real data; TAB-only).
   26/29 have etude supervision.
10. **Small supervised proof justified:** YES — LOCAL heads (objects, rhythm,
    pitch, voice: thousands of real labels) + TAB-digit/pairing heads on
    etude+real mixes with domain tags. Technique heads stay abstention-only
    on real data.
11. **Comprehensive training justified:** NO — common techniques lack real
    supervision; TAB-only class empty in real data.
12. **Next step:** remaining 53 PDMX members (same capped method) for TAB
    breadth + commissioned originals for bends/legato/harmonics/tapping;
    then CASE-A re-evaluation. No full training until then.

## G4 external sources (evidence)

- SCORE-SET (.gp5, CC BY 4.0 claim): derived from MIDI (incl. MAESTRO piano,
  CC BY-NC-SA upstream → commercial taint) with synthetically ADDED
  expressions — not performed truth. REJECTED.
- DadaGP (26k GuitarPro, CC BY 4.0 paper): copyrighted commercial
  transcriptions; no commercial clearance. REJECTED.
- GAPS (classical guitar audio+scores): CC-BY-NC-SA 4.0 — non-commercial.
  REJECTED for training (eval-only note).
- GOAT: research-only (unchanged). No qualifying Guitar Pro/MusicXML
  collection found; format converter need is moot without a licensed source.
