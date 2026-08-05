# Strict holdout acquisition attempt — 2026-08-05

## Repository verification

| Check | Result |
| --- | --- |
| HEAD | `fc7af582af21514b3d718de7ac81f8a1248e0c9b` |
| `src/features/omr` vs `f091ee7` | **no diff** |
| `tests` vs `f091ee7` | only `sourceFaithfulZeroDefectBaseline.test.js` (+271 lines from `613fa73`) |
| Working tree `src`/`tests` | clean |
| Production OMR commit | **`f091ee7`** (protected) |
| Production edits this phase | **0** |

## Intake inspection

**Path:** `~/Downloads/corranzo-holdout-intake/`

```
ls: /Users/ryland/Downloads/corranzo-holdout-intake/: No such file or directory
```

**Outcome:** Directory does not exist. Zero candidate files. No provenance audit of new scores possible.

Per program instructions: preserve state → exact acquisition checklist → **stop** without production changes.

## Strict pack unchanged

| Holdout ID | Split | Category |
| --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | sealed evaluation | A |
| `guitar-guaraldi-pumpkin-waltz` | development | A |
| `guitar-pirates-caribbean-tab` | development | A |

New category-A scores found this phase: **0**  
Repair gate: **not reached** (blocked on acquisition)
