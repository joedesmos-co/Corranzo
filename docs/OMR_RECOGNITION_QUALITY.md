# OMR Recognition Quality — Process

Status: **Active**  
Objective: Drop in a random PDF → get playback that sounds like the printed music.

Architecture and ActiveScore ownership work are **feature-frozen** unless a new
regression blocks recognition. Do not refactor for cleanliness during quality sprints.

## Measurement freeze

Recognition changes are scored **only** with the semantic MusicXML evaluator:

| Field | Frozen value |
| --- | --- |
| Module | `src/features/omr/semanticMusicXmlEvaluator.js` |
| Version | `2.0.0` (`SEMANTIC_EVALUATOR_VERSION`) |
| Schema | `2` (`SEMANTIC_EVAL_SCHEMA_VERSION`) |
| Default sprint mode | `written` |
| Canonical docs | `docs/OMR_SEMANTIC_EVALUATOR.md`, `docs/OMR_SEMANTIC_DEFECT_TAXONOMY.md` |
| Corpus baseline | `benchmarks/omr-semantic/BASELINE.md` + `baseline.json` |

**Do not change evaluator formulas, tolerances, class definitions, or defect codes
while iterating on recognition.** If the measuring stick moves, before/after is meaningless.

Hardening gate (must stay green):

```bash
npx vitest run tests/semanticMusicXmlEvaluator.test.js tests/semanticMusicXmlEvaluator.hardening.test.js tests/omrSemanticDefectClass.test.js
npm run omr:evaluate-semantic -- --self-check benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml --mode written
```

## Scoreboard (every recognition change)

Report all of:

1. Overall semantic score  
2. Pitch  
3. Rhythm  
4. Sustain / Tie (`sustain`)  
5. Articulation  
6. Measure structure (`measureStructure`)  
7. Interpretation  

Also report:

- Top recurring recognition errors (`topDefects`)
- Per-measure error summary (`worstMeasures`)
- Before vs after comparison (`--compare`)

## Sprint workflow

```bash
# 1. Capture "before" (or reuse frozen baseline)
npm run omr:semantic-corpus -- --label before --mode written \
  --json tmp/omr-quality/before.json --text tmp/omr-quality/before.txt

# 2. Change recognition (rhythm first — see priority below)

# 3. Capture "after"
npm run omr:semantic-corpus -- --label after --mode written \
  --json tmp/omr-quality/after.json --text tmp/omr-quality/after.txt

# 4. Compare (exit 3 = gate fail)
npm run omr:semantic-corpus -- \
  --compare tmp/omr-quality/before.json tmp/omr-quality/after.json \
  --json tmp/omr-quality/delta.json --text tmp/omr-quality/delta.txt
```

Accept gates (enforced by corpus compare):

- Mean **rhythm** must rise (during rhythm sprints; other phases: target class must rise)
- Pitch / measure structure / other classes must not drop by more than **1%**
- Explain any intentional trade-off in the sprint note — never silent regressions

## Priority order

1. Rhythm (durations, rests, dots, beams/flags, tuplets, measure balancing, voice consistency)
2. Ties / sustain
3. Articulations (store semantically even if playback comes later)
4. Musical structure (repeats, endings, D.C./D.S., segno, coda, Fine)
5. Dynamics (recognize first; playback later)
6. Playback realism (driven by recognized notation — no faked expression)

## Single-file deep dive

```bash
npm run omr:evaluate-semantic -- \
  --truth path/to/truth.musicxml \
  --pdf path/to/score.pdf \
  --mode written \
  --save-generated tmp/omr-quality/out.musicxml \
  --json tmp/omr-quality/one.json
```

## What not to do

- Do not retune the evaluator mid-sprint
- Do not treat the legacy accuracy dashboard as the primary gate for these phases
- Do not start ActiveScore / ownership refactors unless they block recognition
- Do not mark a recognition change “done” without a before/after semantic delta
