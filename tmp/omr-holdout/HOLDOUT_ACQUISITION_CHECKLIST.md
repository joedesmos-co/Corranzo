# Exact holdout acquisition checklist

**Status:** BLOCKED — intake empty  
**Checked:** 2026-08-05  
**Intake path expected:** `~/Downloads/corranzo-holdout-intake/`  
**Intake result:** **directory does not exist** (0 files)

Create that folder and place **new** score packages there. Do not place files already used in Corranzo OMR work.

---

## Hard exclusions (will be classified C/D/E — not strict A)

Do **not** put these (or re-exports / retitled copies) in intake:

### D — Frozen nine
- piano-beginner-single-vector  
- piano-grand-voices-vector  
- piano-rhythm-tuplets-vector  
- piano-articulation-scan  
- piano-dense-advanced-vector  
- guitar-tab-sparse-vector  
- guitar-standard-chords-vector  
- guitar-paired-chords-vector  
- guitar-techniques-paired-vector  

### C — Prior development / campaigns (examples)
- Wet Hands / Minecraft themes / Sweden / Aria Math  
- Evangelion / Gymnopédie / Fantaisie-Impromptu  
- La Campanella / Hungarian Dance / Carol of the Bells  
- Ao no Sumika / Merry-Go-Round of Life / AIZO / Jujutsu  
- Vivaldi Winter (Rousseau) / Moonlight 3rd / Twinkle substitutions  
- Practice-library Mutopia set under `public/fixtures/practice-library/`  
- `benchmarks/omr-stress/*`, `benchmarks/cache/*`  
- Prior `tmp/omr-autonomous/heldout-final-*` pack  

### A already frozen (do not re-add as “new”)
- guitar-bach-prelude-c-guitartab  
- guitar-guaraldi-pumpkin-waltz  
- guitar-pirates-caribbean-tab  

### Other Downloads already provenance-audited
Anything previously hashed under `tmp/omr-holdout/` Downloads reclass runs — re-intake will be E (duplicate) or C if campaign-linked.

---

## Minimum new category-A target (≥8 preferred, piano-heavy)

| # | Required class | Acceptable example | Status |
| ---: | --- | --- | --- |
| 1 | Clean vector piano | Fresh Mutopia/IMSLP PDF **not** in practice library | **MISSING** |
| 2 | Second unrelated vector piano, dense chords | Different composer/edition, dense stacks | **MISSING** |
| 3 | Clean scanned piano | Clear scan of public-domain piano page | **MISSING** |
| 4 | Degraded / skewed / photographed piano | Phone photo or skewed scan | **MISSING** |
| 5 | Polyphonic piano (multi-voice / grand staff) | Clear independent voices | **MISSING** |
| 6 | Piano with tuplets + dotted rhythm | Triplets and dots visible | **MISSING** |
| 7 | Piano with repeats, endings, ties, slurs | Visible 1./2. endings + ties + slurs | **MISSING** |
| 8 | Mixed vector/raster or unusual engraving | Hybrid export or atypical layout | **MISSING** |

Optional extras: guitar standard-only (no TAB); extreme-register piano; clef/key changes; pickup bars.

---

## Per-file intake requirements

For each candidate in `~/Downloads/corranzo-holdout-intake/`:

1. Prefer `{title}.pdf` plus optional independently authored `{title}.musicxml` / `.mxl`.  
2. Do not include OMR-generated MusicXML as “truth.”  
3. Prefer public-domain / clearly licensed editions.  
4. Prefer scores never opened in prior Corranzo OMR chats/campaigns.  
5. After drop: re-run this acquisition program — hash + provenance search will gate category A.

## Provenance gate (will be applied on next run)

A file becomes **A** only if content hash, filename, title, composer, and distinctive text have **no** hits in:

- `src/`, `tests/`, `scripts/`, `benchmarks/`, `public/`, `docs/`  
- `tmp/omr-*`, notation-fidelity / recognition / zero-defect reports  
- prior holdout manifests and generated outputs  
- Git history for matching assets  

Otherwise: B / C / D / E as defined in the acquisition program.

## After a successful intake

1. Update `HOLDOUT_MANIFEST.json` (append; keep existing three).  
2. Build `STRICT_COVERAGE_MATRIX.md`.  
3. Classify truth T1–T5; audit development truth only.  
4. Freeze split (~60% dev / ~40% sealed).  
5. Run untouched baseline **before** any production OMR edit.  
6. Enter repair only if the repair gate is met.

## Resume command

```bash
mkdir -p ~/Downloads/corranzo-holdout-intake
# copy ≥8 new category-A piano-heavy PDFs (+ optional MusicXML) into that folder
# then resume the STRICT HOLDOUT ACQUISITION AND TRUTH PROGRAM in Cursor
```
