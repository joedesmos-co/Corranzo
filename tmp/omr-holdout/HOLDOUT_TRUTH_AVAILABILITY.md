# Holdout truth availability

**Policy:** PDF is primary authority. Never derive expected truth from Corranzo output. Do not assume companion MusicXML is correct.

| Holdout ID | Split | Companion MusicXML | Truth tier | Notes |
| --- | --- | --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | eval | none | **T5** structural only | Sealed — no semantic tuning |
| `guitar-bts-save-me-tab` | eval | none | **T5** | Sealed |
| `guitar-undertale-home-tab` | eval | none | **T5** | Sealed |
| `piano-chainsaw-reze-in-the-pool` | eval | none | **T5** | Sealed |
| `guitar-gravity-falls-theme-tab` | dev | none | **T4** passage structural | TAB rhythm stems; no pitch event sheet yet |
| `guitar-guaraldi-pumpkin-waltz` | dev | private `.mxl` (Downloads) | **T3** pending PDF audit | Hash recorded; **not** trusted until audited |
| `guitar-pachelbel-canon-d-tab` | dev | none | **T4** passage structural | TAB-only |
| `guitar-pirates-caribbean-tab` | dev | private `.mxl` (Downloads) | **T3** pending PDF audit | Hash recorded; unaudited |
| `piano-korobeiniki-tetris-tiles` | dev | none | **T4** passage audited | m1–2 + repeat @ m8 structural |
| `piano-pokemon-rby-title` | dev | none | **T4** passage audited | m1 tempo/artic; m9–11 tempo+triplets |
| `piano-super-mario-bros-theme` | dev | none | **T4** passage audited | m1–2 staccato/syncopation; repeats; triplets |

## Tiers

| Tier | Meaning |
| --- | --- |
| T1 | Complete audited MusicXML (PDF-verified) |
| T2 | Complete MusicXML present but not yet PDF-audited |
| T3 | Companion MusicXML available privately; audit incomplete |
| T4 | Audited passage-level / structural truth from PDF |
| T5 | No event truth; structural/pipeline metrics only |

**No T1 scores in this pack.** Semantic Overall/Pitch/Rhythm for development passages is limited to hand-audited features below (see `DEVELOPMENT_TRUTH_AUDIT.md` + `truth/`).
