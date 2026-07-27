# Sustain Follow-up (grand-voices ×2) + Pitch Sprint 2 Taxonomy

## Sustain follow-up result

**No code change.** Pitch Sprint 1 gains remain intact.

| Metric | Before (Pitch S1) | After follow-up | Δ |
| --- | ---: | ---: | ---: |
| Sustain/Tie | 66.7% | 66.7% | 0 |
| missing-tie | 4 | 4 | 0 |
| incorrect-tie | 0 | 0 | 0 |
| grand-voices Sustain | 0% | 0% | 0 |
| Pitch | 23.5% | 23.5% | 0 |
| Rhythm | 64.9% | 64.9% | 0 |
| Articulation | 83.5% | 83.5% | 0 |
| Measure structure | 56.5% | 56.5% | 0 |

### RCA of the 2 grand-voices missing ties

Trace: A4 (m3) `tie start` → A#4 (m4) `tie stop` in truth.

| Step | Finding |
| --- | --- |
| Recognized pitch | Start A4 present; stop recognized as **A4** not A#4 (no sharp glyph in PDF) |
| Staff assignment | Treble staff 1 — correct after Pitch S1 emission |
| Measure | 3 → 4 cross-bar |
| Tie visual evidence | **No** SMuFL tie/slur control glyphs; ink-arc probe fails |
| Start/stop pairing | Never formed (`detectedTieCount: 0`) |
| MusicXML emission | No ties to lose; staff emission did not drop ownership |

Additional: truth encodes a **pitch-changing tie** (A4→A#4), which is musically invalid for a tie.

**Verdict:** Not staff/association loss from Pitch Sprint 1. Visual tie not recoverable with current glyph/ink evidence without inventing ties. **No general fix implemented.**

Full notes: `tmp/sustain-followup-grand-voices/RCA.md`

## Pitch Sprint 2 — incorrect-pitch taxonomy (paired notes)

Classified 273 incorrect-pitch pairs after staff lanes pair correctly:

| Bucket | Count | Share |
| --- | ---: | ---: |
| larger-interval | 146 | 53.5% |
| octave-error | 39 | 14.3% |
| one-diatonic-step | 36 | 13.2% |
| accidental-or-alter | 32 | 11.7% |
| small-interval-other | 20 | 7.3% |

### Dominant root cause
**larger-interval** (146 pairs)

### Samples
```json
{
  "accidental-or-alter": [
    {
      "id": "piano-beginner-single-vector",
      "measure": 1,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 2,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 4,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 5,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 6,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 8,
      "truth": "F4",
      "gen": "E4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 2,
      "truth": "F#4",
      "gen": "F4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 2,
      "truth": "F#4",
      "gen": "F4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 3,
      "truth": "G#4",
      "gen": "G4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 3,
      "truth": "F#4",
      "gen": "F4",
      "delta": -1,
      "tStaff": 1,
      "gStaff": 1
    }
  ],
  "one-diatonic-step": [
    {
      "id": "piano-beginner-single-vector",
      "measure": 1,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 2,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 3,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 5,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 6,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-beginner-single-vector",
      "measure": 8,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 5,
      "truth": "G4",
      "gen": "A4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 5,
      "truth": "A4",
      "gen": "G4",
      "delta": -2,
      "tStaff": 1,
      "gStaff": 1
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 5,
      "truth": "G3",
      "gen": "F3",
      "delta": -2,
      "tStaff": 2,
      "gStaff": 2
    },
    {
      "id": "piano-grand-voices-vector",
      "measure": 6,
      "truth": "A4",
      "gen": "B4",
      "delta": 2,
      "tStaff": 1,
      "gStaff": 1
    }
  ],
  "oct
```

## Piano vs guitar split

| Bucket | Piano | Guitar |
| --- | ---: | ---: |
| accidental-or-alter | 31 | 1 |
| one-diatonic-step | 24 | 12 |
| octave-error | 24 | 15 |
| larger-interval | 80 | 66 |
| small-interval-other | 14 | 6 |

**Piano dominant true-pitch causes:** accidental/alter (31) + one diatonic step (24) ≈ 55 of 173 piano substitutions.

**Guitar dominant:** larger-interval (66/100) — often octave-offset / chord-tone association, separate from piano staff-position work.

## Recommended Pitch Sprint 2 focus

1. **Accidental / key-signature / measure-scope alter** (±1 semitone) on piano vector scores
2. **One diatonic staff-position slip** (±2 semitones) — staff-line / ledger vertical mapping
3. Defer guitar larger-interval / written-octave until piano accidental+step errors shrink

Wrong-staff among paired notes: essentially 0 after Pitch Sprint 1 (pairing already requires same staff).
