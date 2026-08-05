# Holdout truth audit

## Policy

Never treat existing MusicXML as automatically correct.  
Never use Corranzo’s generated MusicXML to author expected truth.  
Evaluator 2.0.0 / schema 2 unchanged.

## Strict holdouts — truth status

| Holdout ID | Reference MusicXML | Method available now | Audited? |
| --- | --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | none | Visual / structural page audit | Partial (page-1 systems) |
| `guitar-guaraldi-pumpkin-waltz` | none | Visual / structural page audit | Partial (page-1 systems) |
| `guitar-pirates-caribbean-tab` | none | Visual / structural page audit | Partial (page-1 system) |

### Visual findings (source)

**Guaraldi (dev)**  
Paired notation+TAB; 3/4; 3 flats; swing + metronome; dense jazz chords; staccatos; ties; arpeggio marks; 1./2. endings + repeat; To Coda. High-value structure score.

**Pirates (dev)**  
TAB-only with rhythmic stems; 6/8; tempo; dynamics; continuous P.M.; decorative movie banner above music. Rhythm-from-TAB is the hard problem.

**Bach prelude (sealed eval)**  
Clean paired notation+TAB; continuous sixteenth arpeggios; octave treble clef; no accidentals on first systems. **Do not use for tuning.** Baseline-only observations allowed.

## Classification placeholders

Until human event truth exists, defects from pipeline diagnostics are labeled:

- `candidate-production-defect` — must be confirmed against PDF before repair  
- `unsupported-or-policy` — e.g. TAB-only approximate rhythm warning may be intentional honesty  
- `truth-unavailable` — cannot score Pitch/Rhythm Overall without event truth  

## Next truth work (before Phase 6 accepts repairs)

1. Author measure-level source-faithful event samples for Guaraldi m1–m4 and Pirates m1–m4.  
2. Or acquire holdouts that ship audited MusicXML.  
3. Re-run semantic evaluator only after truth audit.
