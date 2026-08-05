# Strict coverage matrix

**Updated:** 2026-08-05 — intake populated; **8 new category-A** accepted  
**Strict pack size:** **11** (7 guitar + 4 piano)

| Holdout ID | Split | Pages | Instrument | Render | Density | Chords | Voices | Tuplets | Dots | Rests | Accid. | Key Δ | Clef Δ | Ties | Slurs | Artic. | Repeats | Endings | Pickup | Cross-staff | Std guitar | TAB | Unusual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | eval | 3 | guitar | vector | sparse–mod | — | Y | — | — | Y | — | — | — | Y | Y | — | — | — | — | — | Y | Y | 8vb clef |
| `guitar-bts-save-me-tab` | eval | 2 | guitar | vector | mod | Y | Y | Y | Y | — | — | — | — | Y | Y | — | — | — | — | — | — | Y | capo |
| `guitar-undertale-home-tab` | eval | 3 | guitar | vector | mod | Y | Y | — | Y | Y | Y | — | — | Y | Y | — | — | — | — | — | Y | Y | grace/fermata |
| `piano-chainsaw-reze-in-the-pool` | eval | 6 | piano | vector | mod–dense | Y | Y | — | Y | Y | Y | — | — | Y | Y | — | — | — | — | — | — | — | 12/8, pedal |
| `guitar-gravity-falls-theme-tab` | dev | 1 | guitar | vector | sparse–mod | — | — | — | Y | — | — | — | — | — | Y | Y | — | — | — | — | — | Y | — |
| `guitar-guaraldi-pumpkin-waltz` | dev | 1 | guitar | vector | dense | Y | Y | — | Y | Y | Y | — | — | Y | — | Y | Y | Y | — | — | Y | Y | swing/coda |
| `guitar-pachelbel-canon-d-tab` | dev | 1 | guitar | vector+header img | mod | Y | Y | — | Y | — | — | — | — | Y | Y | — | — | — | — | — | — | Y | photo header |
| `guitar-pirates-caribbean-tab` | dev | 2 | guitar | vector | mod | Y | — | — | Y | — | — | — | — | — | — | — | — | — | — | — | — | Y | banner/PM |
| `piano-korobeiniki-tetris-tiles` | dev | 2 | piano | vector | mod–dense | Y | Y | — | — | Y | Y | — | — | — | — | — | Y | — | — | — | — | — | pedal, 2/4 Δ |
| `piano-pokemon-rby-title` | dev | 1 | piano | vector | dense | Y | Y | Y | Y | Y | Y | — | — | Y | Y | Y | — | — | — | — | — | — | rolls, tempo Δ |
| `piano-super-mario-bros-theme` | dev | 2 | piano | vector | dense | Y | Y | Y | Y | Y | Y | — | — | Y | — | Y | Y | — | — | — | — | — | no printed 4/4 |

**MusicXML pairing:** intake has **no** MusicXML. Guaraldi/Pirates have private Downloads `.mxl` companions (hash recorded; **not** assumed correct).

## Required coverage checklist

| Coverage need | Present in strict A? | Holdout(s) |
| --- | --- | --- |
| Clean vector piano | **YES** | Pokémon, Mario, Korobeiniki, Chainsaw |
| Second dense vector piano | **YES** | Pokémon + Mario |
| Clean scanned piano | **NO** | — |
| Degraded / skewed / photographed | **NO** | — |
| Polyphonic multi-voice piano | **YES** | Pokémon, Mario, Chainsaw |
| Tuplets + dotted piano | **YES** | Pokémon, Mario |
| Repeats / ties / articulations (piano) | **YES** | Mario (repeats+staccato), Korobeiniki (repeat), Pokémon (ties+staccato) |
| Mixed vector/raster | Partial | Pachelbel decorative header JPEG only |
| Dense chords | **YES** | Pokémon, Guaraldi, Mario |
| Extreme registers | Partial | Korobeiniki high ledger; Chainsaw ledger |
| Multiple voices | **YES** | piano + paired guitar |
| Tuplets | **YES** | Pokémon, Mario, BTS TAB |
| Guitar standard + TAB | **YES** | Bach, Guaraldi, Undertale Home |
| Guitar TAB-only | **YES** | Pirates, Gravity Falls, Pachelbel, BTS |
| Visually degraded page | **NO** | — |
| Key-signature changes | **NO** | — |
| Clef changes | **NO** | — |
| Pickup measures | **NO** | — |
| Cross-staff | **NO** | — |

**Acquisition target (≥8 new A, piano-heavy):** **met for count** (8 new A, 4 piano). Scan/skew/photographed still missing.
