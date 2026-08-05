# Holdout Generalization Report

## Status

**Generalization success: NOT reached** (tuplet family accepted; repeat family next)  
**Production HEAD:** `648651a`  
**Starting HEAD this repair phase:** `fc7af58`  
**Protected historical baseline:** `f091ee7` / freeze `613fa73`

---

### 1. Starting HEAD
`fc7af58` — tmp-only program artifacts; production OMR ≡ `f091ee7`.

### 2. Final HEAD (this checkpoint)
`648651a` — `fix(omr): recognize vector tuplet groups`

### 3–4. Provenance / split
Strict 11 category-A; sealed 4 / development 7 — unchanged. See `HOLDOUT_SPLIT.json`.

### 5. Untouched baseline (pre-repair)
Development + sealed processed; Pokémon/Mario `tm=0`; frozen Overall 88.2%.

### 6. Development metrics after tuplet accept
| Score | Tuplets | Repeats |
| --- | --- | --- |
| Pokémon | tm=68, 15/15 start/stop | 0 |
| Mario | tm=34, 8/8 start/stop | 0 |
| Korobeiniki | tm=0 | 0 |
| Guaraldi | tm=0 | 0 endings=4 |
| TAB development | tm=0 | incidental |

### 7. Sealed milestone (structural only)
4/4 accepted; guitar sealed XML identical to untouched baseline; one sealed piano score structural `tm=+6` / 2 balanced groups — **recorded, not used for tuning**.

### 8. Weak holdouts
Unchanged policy (Iris etc. not primary).

### 9. Frozen corpus
Overall **88.2%**; Articulation 100%; 9/9; freeze tests 5/5; source-supported defects **0**.

### 10. Source-faithful defect counts
Frozen: **0**. Holdout remaining: vector repeat-barline omission (3 development scores).

### 11. Accepted commits
- `648651a` fix(omr): recognize vector tuplet groups

### 12. Rejected experiments
- Post-accept beam-required / Pattern-B live-page abstain tighten (hurt Pokémon/Mario recall; sealed FP not cleared under no-sealed-tuning) → reverted to `648651a`
- Prior acquisition false category promotions (historical)

### 13–16. Category / runtime / remaining
Piano vector tuplets: improved. Vector repeats: inventory `VECTOR_REPEAT_BARLINE_INVENTORY.md`. Known unrelated failures: `omrVectorRhythm`×4, `notationFidelitySprint3`×1.

### 17. Generalization success?
**Partial.** Tuplet omission family accepted. Repeat-barline family open.

### 18. Exact resume state
```
git rev-parse HEAD   # expect 648651a
# Next: implement vector repeat barlines from VECTOR_REPEAT_BARLINE_INVENTORY.md
# Witnesses: piano-korobeiniki-tetris-tiles, piano-super-mario-bros-theme, guitar-guaraldi-pumpkin-waltz
# Do not tune from sealed holdouts
```
