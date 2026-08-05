# Holdout Provenance Audit

**Program:** Corranzo Strict Holdout Acquisition and Truth  
**Audit time:** 2026-08-05 (intake resume)  
**Git HEAD at audit:** `fc7af58` (tmp-only after freeze; production OMR ≡ `f091ee7` + freeze test `613fa73`)  

## Phase 0 verification

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` | `fc7af582af21514b3d718de7ac81f8a1248e0c9b` |
| Production OMR vs `f091ee7` | **No `src/features/omr` diff** |
| Freeze tests | `tests/sourceFaithfulZeroDefectBaseline.test.js` present at `613fa73` |
| Evaluator / schema | frozen **2.0.0** / schema **2** |

## Category definitions

| Cat | Meaning |
| --- | --- |
| **A** Strict holdout | Never previously used, inspected, tuned against, or referenced by OMR work |
| **B** Weak holdout | Processed previously or casually available, but not used to tune production |
| **C** Development score | Used for diagnosis, tuning, testing, architecture, or prior campaigns |
| **D** Original frozen corpus | One of the protected nine semantic fixtures |
| **E** Duplicate / uncertain | Hash or content collision; ambiguous provenance |

## Intake inventory (2026-08-05)

**Path:** `~/Downloads/corranzo-holdout-intake/` (private; not copied into repo)

```
canon-in-d-pachelbel-guitar-tab.pdf
gravity-falls-theme-tab.pdf
home-undertale-ost-012-tab-for-solo-guitar.pdf
in-the-pool-chainsaw-man-the-movie-reze-arc-ost.pdf
korobeiniki-tetris-theme-piano-tiles-version.pdf
pokemon-red-and-blue-title-theme-for-piano.pdf
save-me-bts-guitar-tabs.pdf
super-mario-bros-main-theme.pdf
```

No MusicXML / MXL / MIDI / companion images in the intake folder.

### Method

1. SHA-256 content hash per PDF.  
2. Score-specific fixed-string phrases (not generic tokens like `canon`, `save`, `super`).  
3. Search repo, tests, fixtures, benchmarks, prior `tmp/omr-*` (excluding this holdout tmp self-reference), manifests.  
4. Cross-check frozen Undertale Spider Dance ≠ Undertale Home OST.

### Intake classification (all accepted A)

| File | Holdout ID | Cat | Evidence |
| --- | --- | --- | --- |
| `canon-in-d-pachelbel-guitar-tab.pdf` | `guitar-pachelbel-canon-d-tab` | **A** | `pachelbel` / `canon-in-d-pachelbel` — 0 hits |
| `gravity-falls-theme-tab.pdf` | `guitar-gravity-falls-theme-tab` | **A** | `gravity falls` — 0 hits |
| `home-undertale-ost-012-tab-for-solo-guitar.pdf` | `guitar-undertale-home-tab` | **A** | Home OST phrases — 0 hits; ≠ Spider Dance fixture |
| `in-the-pool-chainsaw-man-the-movie-reze-arc-ost.pdf` | `piano-chainsaw-reze-in-the-pool` | **A** | `chainsaw man` / `reze` / `in the pool` — 0 hits |
| `korobeiniki-tetris-theme-piano-tiles-version.pdf` | `piano-korobeiniki-tetris-tiles` | **A** | `korobeiniki` — 0 hits |
| `pokemon-red-and-blue-title-theme-for-piano.pdf` | `piano-pokemon-rby-title` | **A** | `pokemon-red-and-blue` — 0 hits |
| `save-me-bts-guitar-tabs.pdf` | `guitar-bts-save-me-tab` | **A** | `save-me-bts` / `bts guitar` — 0 hits |
| `super-mario-bros-main-theme.pdf` | `piano-super-mario-bros-theme` | **A** | `super mario bros main theme` — 0 hits |

**Excluded from intake:** none (0 files failed A).

Initial weak-token search (`canon`, `save`, `super`, …) produced false-positive C labels; **reclassified with score-specific phrases**. Unseen definition was not weakened.

### Prior strict pack (unchanged A)

| Holdout ID | Cat | Notes |
| --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | A | Sealed; hashes unchanged |
| `guitar-guaraldi-pumpkin-waltz` | A | Development; companion `.mxl` exists in Downloads (unaudited) |
| `guitar-pirates-caribbean-tab` | A | Development; companion `.mxl` exists in Downloads (unaudited) |

### Still not strict

| Score family | Cat | Why |
| --- | --- | --- |
| Frozen nine | D | Protected corpus |
| Practice / stress / prior campaigns | C | Prior OMR use |
| `piano-iris-out-arrangement` | B | Campaign inventories |

## Strict pack size

**11 category-A** (3 prior + 8 intake).
