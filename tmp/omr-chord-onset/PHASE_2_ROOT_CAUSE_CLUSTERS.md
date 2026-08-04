# Phase 2 — Root Cause Clusters & Selected Shared Mechanism

**Campaign:** OMR dense chord and onset ownership  
**Baseline commit:** `34529e0`  
**Constraint:** choose the *smallest general mechanism* that explains the *largest* remaining ownership/onset damage across unrelated fixtures. Do not solve all clusters at once.

## Cluster summary (mechanism, not evaluator label)

| # | Cluster | Approx. evidence mass | Primary stage |
|---|---|---|---|
| 1 | Same-chord notes split across nearby onsets | High (dense + articulation + coalesce gap) | grouping → gap pack → coalesce |
| 2 | Nearby independent voices incorrectly merged | High (40 inflated chords; extra cascades) | coalesce / reconstruction |
| 3 | Note attached to adjacent chord column | High (dense onset grid) | position snap / gap pack |
| 4 | Duplicate ownership of one notehead | **Clear (31 exact duplicate MIDI chords)** | event emit / missing exclusive ownership |
| 5 | Note dropped during onset packing | High (38 dropped-tone chords) | packing / split / ownership loss |
| 6 | Geometry OK, wrong onset | High (180 chord onset rows; 131 dense) | resnap / gap pack |
| 7 | Evaluator alignment artifact | Low (3) | measure alignment |
| 8 | Pitch/accidental masquerading as chord | Medium (62 same-count pitch diffs) | pitch path (frozen; out of scope) |

## Selected shared root cause

**No exclusive notehead ownership, and no durable chord-column identity, between geometric grouping and final event emission.**

Concretely:

1. Early grouping may place vertically related tones in one column using an **adaptive** horizontal window (up to ~28px).
2. Later `coalesceSameOnsetChordEvents` only merges fragments that already share an **identical** `startDivision` and lie within a **fixed 10px** window.
3. Gap packing / lane normalize / dense resnap can assign **different onsets to members of the same geometric chord**, then leave orphan tones unmerged.
4. Nothing enforces that a physical notehead candidate ID belongs to **exactly one** generated note event, so duplicate candidates and re-merged fragments produce repeated midis inside chords and missing+extra cascades.

This single gap explains clusters **1, 3, 4, 5, and large parts of 6** across piano-dense, articulation-scan, grand-voices, rhythm-tuplets, and guitar chord fixtures — without song-specific logic and without retuning accidentals.

### Affected fixtures

- `piano-dense-advanced-vector` (largest onset + chord mass)
- `piano-articulation-scan` (dropped tones + extras + duplicates)
- `piano-grand-voices-vector` (chord integrity; some pitch masquerade remains)
- `piano-rhythm-tuplets-vector` (duplicate chord midis at m7)
- `guitar-paired-chords-vector`, `guitar-standard-chords-vector` (column/onset)
- Secondary: `guitar-tab-sparse-vector`, `piano-beginner-single-vector` (mostly onset noise)

### Mismatches explained (order-of-magnitude)

Using structured inventory + subtype counts (not claiming exact evaluator 1:1):

| Linked symptom | Approx. count |
|---|---:|
| Exact duplicate MIDI chords | 31 |
| Dropped-tone chords | 38 |
| Inflated chords (ownership/merge) | 40 |
| Chord-linked onset mismatches (dense-dominated) | ~180 structured / 256 evaluator |
| missing↔extra co-occurring measures | 17 |

**Target for this intervention:** material drop in `incorrect-chord`, stable/↓ missing+extra, ↓ onset-mismatch, without Pitch regression or broad Rhythm regression.

### Production stage responsible

`src/features/omr/processVectorOmrPage.js` event construction:

- `groupVectorNoteheads` / `mergeGroupsSharingBeat` (creates columns but does not lock IDs)
- gap packing / `normalizeDenseVectorLaneSpacing` (can desync column members)
- `coalesceSameOnsetChordEvents` (fixed 10px, same-onset-only)
- `resnapDenseChordOnsets` (moves multi-note events; orphans stay behind)
- missing exclusive ownership pass before MusicXML emit

Secondary: `reconstructMusicalEvents.js` inner-voice splits (must remain voice-aware; not the first lever).

### Safest narrow intervention point

1. **Assign `chordColumnId` + candidate IDs at geometric grouping.**
2. **Enforce exclusive notehead ownership** once per physical glyph (staff, voice, stem, column, onset evidence) with DEV provenance (winner, losers, score components, dedupe reason).
3. **Coalesce / resnap by column identity** so an entire chord moves together; never resnap individual tones after ownership is known.
4. **Reject ambiguous contests** rather than duplicating; keep legitimate unisons when provenance shows distinct glyphs / opposing stems / separate voices.

Do **not** globally widen `OMR_CHORD_MERGE_X`.

### Expected blast radius

- Dense piano / multi-voice chord fixtures: intended improvement.
- Sparse single-line / TAB: should stay stable (exclusive ownership is conservative; ambiguous merges rejected).
- Pitch spelling / accidental path: untouched unless ownership wrongly drops a tone that carried an accidental (monitor incorrect-pitch).
- Rhythm: onset should improve if columns move as units; risk is over-merging voices → mitigated by stem/voice gates.

### Rejected broader alternatives

| Alternative | Why rejected |
|---|---|
| Globally increase `OMR_CHORD_MERGE_X` | Improves a few dense cases; merges independent voices; prior tests explicitly forbid distant same-slot merges |
| Onset snap by x distance only | Ignores stem/voice/beam; causes cluster 2 |
| Song / measure / filename special cases | Forbidden |
| Retune path-accidental recognition | Frozen; not the ownership bug |
| Evaluator tolerance changes | Frozen 2.0.0 / schema 2 |
| Delete all unison duplicates blindly | Would destroy legitimate two-voice unisons |
| Broad reconstructMusicalEvents rewrite | Higher blast radius; defer until ownership locked |

## Rhythm dip investigation (`2f82df8` 67.1% → `34529e0` 66.6%)

**Finding:** Do **not** blame or revert accidental recognition.

From the accidental campaign fair evidence:

1. Comparing **old fixtures** at `2f82df8` to **regenerated path-accidental fixtures** at acceptance showed Rhythm −0.5pp and onset-mismatch **+63** vs the *old* fixture baseline.
2. Fair A/B on **regenerated** fixtures (detection off vs on) showed Pitch/chord gains from path detection; onset stayed comparable — the large onset jump tracks **fixture redraw**, not accidental binding.
3. Accidental path code does not edit onset snap, gap packing, or chord coalesce.
4. Secondary duration (+4) and sustain noise are within campaign noise relative to Pitch (+3.0pp) and incorrect-chord (−18) wins that are already frozen.

**Per this campaign:** keep accidentals frozen; if Rhythm moves further, attribute only with per-fixture onset/duration deltas against `corpus-baseline.json` at `34529e0`.

## Phase 3–4 plan (implementation next; no production edits before this doc)

1. Exclusive notehead ownership module + DEV provenance.
2. Chord-column lock through coalesce and dense resnap.
3. Geometry fixtures that fail before / pass after.
4. Corpus + user-report gates.
