# Untouched baseline report — strict holdout pack (n=11)

**Created:** after intake freeze  
**Git HEAD:** `fc7af58`  
**Production OMR:** `f091ee7` (**unchanged**)  
**Sources:** original private PDFs only — no reuse of prior MusicXML as input  

## Aggregates

| Cohort | OK | Notes | Elapsed | Crashes |
| --- | ---: | ---: | ---: | ---: |
| Strict all | **11/11** | 6388 | 10.6 s | 0 |
| Development | **7/7** | 2831 | 3.9 s | 0 |
| Sealed evaluation | **4/4** | 3557 | 6.7 s | 0 |
| Weak (Iris) | 1/1 | 2471 | 3.6 s | 0 |
| Frozen corpus control | 9/9 | Overall **88.2%**, Pitch 98.9%, Articulation **100%** | (phase0) | 0 |

## Development structural baseline

| Holdout | Notes | Measures | ms | Key PDF-vs-OMR feature checks |
| --- | ---: | ---: | ---: | --- |
| `guitar-gravity-falls-theme-tab` | 72 | 16 | 153 | TAB-only `rhythmApproximate`; staccato expected, **0** generated |
| `guitar-guaraldi-pumpkin-waltz` | 211 | 23 | 353 | pairingConfidence≈0.49; unpaired 18; endings present; **no `<repeat>`** |
| `guitar-pachelbel-canon-d-tab` | 307 | 35 | 377 | TAB-only approximate rhythm |
| `guitar-pirates-caribbean-tab` | 331 | 62 | 414 | TAB-only approximate rhythm |
| `piano-korobeiniki-tetris-tiles` | 609 | 45 | 902 | PDF end-repeat @~m8 — **0 `<repeat>`** |
| `piano-pokemon-rby-title` | 667 | 33 | 824 | PDF triplets — **0 tuplet / 0 time-modification**; staccato OK (38) |
| `piano-super-mario-bros-theme` | 634 | 49 | 885 | PDF triplets+repeats+staccato — **0 tuplet, 0 repeat, 0 staccato** |

No complete T1 semantic Overall/Pitch/Rhythm (no audited MusicXML). Passage checks are feature-presence only.

## Sealed evaluation structural baseline

| Holdout | Notes | Measures | ms | Notes (no tuning) |
| --- | ---: | ---: | ---: | --- |
| `guitar-bach-prelude-c-guitartab` | 1169 | 85 | 2246 | pairing≈0.54; unpaired 20 |
| `guitar-bts-save-me-tab` | 104 | 35 | 464 | TAB-only approximate rhythm |
| `guitar-undertale-home-tab` | 427 | 38 | 811 | pairing≈0.52; unpaired 100 |
| `piano-chainsaw-reze-in-the-pool` | 1857 | 67 | 3163 | Accepted; 1 uncertain-rhythm warning |

## Confirmed repeated root causes (development only)

| Family | Evidence | Gate |
| --- | --- | --- |
| **Vector piano tuplet omission** | PDF triplet brackets on `piano-pokemon-rby-title` **and** `piano-super-mario-bros-theme`; generated MusicXML has **0** `<tuplet>` and **0** `<time-modification>` | **A reached** |
| **Vector repeat-barline omission** | PDF repeats on `piano-korobeiniki-tetris-tiles` **and** `piano-super-mario-bros-theme` (Guaraldi also lacks `<repeat>` despite endings) | **A reached** |
| TAB–notation pairing residual | Strong on Guaraldi (dev) + sealed Bach/Undertale — **only one development witness** → not alone enough for gate | candidate |
| TAB-only approximate rhythm | Multiple TAB-only scores — **unsupported/policy**, do not repair from this alone | blocked by policy |

## Repair gate

**REACHED** under criterion A (same source-supported root cause on ≥2 unrelated development holdouts) for:

1. Piano/vector **tuplet** detection/emission  
2. Piano/vector **repeat barline** detection/emission  

**Not begun in this phase** — acquisition/truth/baseline reports completed first. Production tree still matches `f091ee7` for `src/features/omr`.

## Exact next action

Start a **production** experiment on **vector piano tuplet brackets** (development witnesses: Pokémon + Mario only). Do not inspect sealed semantic answers. Preserve freeze tests and frozen-corpus protections. Alternate/second family: vector **repeat barlines** (Korobeiniki + Mario).
