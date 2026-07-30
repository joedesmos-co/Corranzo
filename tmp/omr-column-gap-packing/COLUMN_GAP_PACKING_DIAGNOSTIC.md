# Dense Column-Locked Gap Packing — Diagnostic Report

**Baseline:** `34529e0` — fix(omr): detect vector path accidentals (restored; ownership campaign reverted)  
**Scope:** Diagnostic only — **no production recognition changes**  
**Artifacts:** `scripts/lib/columnGapPackingTrace.mjs`, `scripts/omr-column-gap-packing-diagnose.mjs`, `tests/omrColumnGapPackingDiagnostic.test.js`, `tmp/omr-column-gap-packing/traces/`

## Restored baseline confirmation

| Metric | Expected | Restored |
|---|---:|---:|
| incorrect-chord | 199 | **199** |
| onset-mismatch | 256 | **256** |
| missing-note | 163 | **163** |
| extra-note | 154 | **154** |
| Pitch | 61.5% | **61.5%** |
| Rhythm | 66.6% | **66.6%** |

Full unit suite: **273 files / 2742 tests passed**. Production build: **pass**. Ownership runtime code removed.

## Pipeline stages traced

```
detected noteheads
  → geometric grouping (groupVectorNoteheads / groupsShareBeatSlot)
  → dense-rhythm decision (groups.length > beats | shouldInferRhythmFromPositions)
  → position → onset snap (startDivisionFromPosition; eighth vs sixteenth grid)
  → gap-derived durations (next onset − start)
  → coalesceSameOnsetChordEvents (identical startDivision ∧ |Δcx| ≤ 10)
  → resnapDenseChordOnsets
  → final events / score graph
```

## Exact failing transition

**`groupsShareBeatSlot` beat-slot gate refuses to merge visually stacked tones whose `positionInMeasure` fall in adjacent sixteenth slots — even when `|Δcx|` is 3–5px and the adaptive chord merge window is ~28px.**

Then, because the refused merge **inflates `groups.length`**, the measure often satisfies:

```text
denseMeasure = groups.length > beats
```

which selects the **sixteenth** onset grid in `startDivisionFromPosition`. Separated groups snap to **neighboring onsets** (e.g. 4 vs 5). Finally `coalesceSameOnsetChordEvents` **cannot reunite** them because it requires an **identical** `startDivision` (plus `|Δcx| ≤ 10`).

### Proven geometry example (`chord-column-split-during-onset-snap`)

| Tone | cx | positionInMeasure | beat slot (16) | post-pack onset |
|---|---:|---:|---:|---:|
| C4 (`c-low`) | 100 | 0.22 | 3 | **4** |
| E4 (`c-mid`) | 103 | 0.31 | 4 | **5** |
| G4 (`c-high`) | 105 | 0.32 | 4 | **5** |

- Adaptive `chordMergeX` = **28**, fixed coalesce window = **10**
- Dense rule fired: `groups.length (7) > beats (4)`
- Final coalesce: singleton `{C}` @4 and dyad `{E,G}` @5 — **no 3-note chord**
- `visualSplits`: C–E and C–G with dx 3 / 5 and onsets 4 / 5

Failing transition string from tracer:

> `groupsShareBeatSlot beat-slot gate → separate groups → dense sixteenth onset snap → coalesce requires identical startDivision`

## Stage log fields (per diagnostic fixture)

Recorded for each tone/event:

- physical `candidateId`
- diagnostic chord-column ID (from geometric groups)
- staff / voice / stem / beam (when provided)
- x span / dx
- pre-pack onset (group anchor snap)
- post-pack onset / duration / event ID
- post-coalesce event ID + onset
- post-resnap onset + `denseChordOnsetResnapped`
- whether tones from one visual column split across events (`visualSplits`)
- whether dense-rhythm mode entered and **exact rule**

## Focused geometry fixtures

| Fixture | Purpose | Observed |
|---|---|---|
| `chord-column-split-during-onset-snap` | Chord tones split during packing | **Confirmed** — C vs EG onsets 4/5 |
| `mixed-voice-stack-must-remain-separate` | Opposing stems near x | Production still **x-merges** into one group (risk for any wider gate) |
| `adjacent-dense-chords-no-broad-dense-mode` | 4 chord columns, beats=4 | `groupCount=4`, dense **not** entered via group count |
| `whole-chord-resnap-as-unit` | Chord + bass columns | Clefs split to separate events at **same** onset (intentional `splitMixedClefEvents`); not the same-clef packing bug |

## Affected fixtures / mismatch mass (estimate)

Mechanism aligns with remaining clusters from `tmp/omr-chord-onset/PHASE_1_MISMATCH_INVENTORY.md`:

| Corpus pressure | Approx. link |
|---|---|
| `piano-dense-advanced-vector` onset-mismatch **134** / incorrect-chord **85** | Dense group counts + fine snap — highest exposure |
| `piano-articulation-scan` dropped/partial chords | Same packing split pattern (`CEG→EG`) |
| Structured onset rows with \|Δ\| ≤ 0.5 quarter | Matches adjacent-slot snap (1 division @ divisions=4) |

**Explained by this transition (order-of-magnitude):** a large share of same-clef **incorrect-chord + onset-mismatch co-occurrences** on dense piano fixtures (inventory had **18** measures with both; dense-advanced dominates evaluator onset/chord totals). Not all 199 incorrect-chord rows — pitch-masquerade (~62) and true voice merges remain separate.

## Safest proposed intervention (not implemented)

**Narrow change in `groupsShareBeatSlot` only:**

Allow same-clef noteheads to share a group across **adjacent** beat slots (`|slotDiff| ≤ 1`) when:

- `|Δcx| ≤ OMR_CHORD_MERGE_X` (keep **10px**, do **not** widen global coalesce), or ≤ current adaptive window **and** vertical stack evidence (cy span / shared stem)
- not opposing-stem voice stacks with intentional separation
- not grace/ornament flags

Optionally: if a visual column still ends as fragments, reunite only when `|Δstart| === 1`, same clef, `|Δcx| ≤ 10`, and MIDI inside chord span — but the **primary** fix is earlier (grouping), so coalesce never sees divergent onsets.

Do **not**:

- globally raise `OMR_CHORD_MERGE_X`
- disable dense mode wholesale
- glyph-exclusive ownership that kills unisons
- song-specific logic

## Expected regression risks

| Risk | Why | Mitigation |
|---|---|---|
| Merge true sequential sixteenths that share x | SlotDiff≤1 could glue melodic neighbors | Require vertical stack / stem agreement; keep dx ≤ 10 for slot crossing |
| Merge opposing-stem inner voices | Mixed-voice fixture already x-merges today | Explicit opposing-stem veto when stems disagree and midis are not a vertical chord span |
| Fewer groups → exit dense mode → coarser snap | Side effect of successful chord merge | Desirable for those measures; watch tuplet/guitar fixtures |
| Rhythm score movement | Onset grid changes | Gate on corpus onset/chord; reject if Rhythm drops like prior ownership attempt |

## Recommendation

**Implement** — with the **narrow `groupsShareBeatSlot` adjacent-slot exception** above, behind geometry fixtures that already fail on baseline (`chord-column-split-during-onset-snap`) and must keep mixed-voice / adjacent-column cases stable.

Do **not** reintroduce the broad ownership/orphan campaign; that path caused a measured Rhythm collapse when stem-splitting inflated group counts.

### Stop condition

Diagnostic identified a **single narrow stage and rule** responsible across synthetic dense fixtures and consistent with corpus dense/articulation chord+onset patterns:

**Stage:** geometric grouping  
**Rule:** `groupsShareBeatSlot` absolute same-slot requirement  
**Amplifier:** `groups.length > beats` → sixteenth onset snap  
**Seal:** coalesce same-`startDivision` only

Next step (separate change, after approval): implement only that grouping exception + fixtures fail→pass, then corpus gate.
