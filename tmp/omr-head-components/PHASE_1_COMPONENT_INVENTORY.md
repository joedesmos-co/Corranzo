# Phase 1 — no-head-sized-component inventory

- Commit: `beeb5f0`
- Created: 2026-08-01T04:10:05.377Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**
- Optical profile: **disabled**

## Scope

Every generated note whose `noteheadAnchor.rejectedReason === no-head-sized-component` across the frozen nine-fixture corpus, with before/after ledger-mask component probes.

## Scoreboard

- Total no-head-sized rejections: **219**
- High-extreme subset: **7**
- Cases where head-sized existed before mask but not after: **15**
- Cases with ≥2 likely head fragments after mask: **87**

## By mechanism

| Key | Count |
|---|---:|
| `transformed-components-outside-expected-size` | 130 |
| `fragmented-filled-notehead` | 26 |
| `genuinely-absent-usable-ink` | 23 |
| `stem-head-split-no-body-reconstruction` | 14 |
| `ledger-masking-over-subtraction` | 14 |
| `fragmented-open-notehead` | 12 |

## By register

| Key | Count |
|---|---:|
| `high-normal` | 138 |
| `low-normal` | 63 |
| `middle` | 9 |
| `high-extreme` | 7 |
| `low-extreme` | 2 |

## By first reject rule (after mask)

| Key | Count |
|---|---:|
| `width-too-narrow` | 173 |
| `height-too-tall` | 24 |
| `head-sized-exists-but-caller-rejected` | 16 |
| `no-near-origin-body-fragments` | 6 |

## By fixture

| Key | Count |
|---|---:|
| `piano-dense-advanced-vector` | 117 |
| `guitar-standard-chords-vector` | 42 |
| `guitar-paired-chords-vector` | 32 |
| `piano-grand-voices-vector` | 14 |
| `piano-rhythm-tuplets-vector` | 12 |
| `guitar-techniques-paired-vector` | 2 |

## Mechanism taxonomy

1. `fragmented-filled-notehead`
2. `fragmented-open-notehead`
3. `ledger-masking-over-subtraction`
4. `transformed-components-outside-expected-size`
5. `stem-head-split-no-body-reconstruction`
6. `stacked-heads-competing-for-fragments`
7. `notehead-fragments-merged-with-accidental-ink`
8. `genuinely-absent-usable-ink`

## High-extreme sample

| Fixture | M | Mechanism | First reject | Frags before/after | Heads before→after | Acc |
|---|---:|---|---|---|---|---:|
| piano-dense-advanced-vector | 7 | transformed-components-outside-expected-size | width-too-narrow | 0/2 | 0→0 | 0 |
| piano-dense-advanced-vector | 8 | transformed-components-outside-expected-size | width-too-narrow | 0/0 | 0→0 | 0 |
| piano-dense-advanced-vector | 8 | stem-head-split-no-body-reconstruction | width-too-narrow | 0/2 | 0→0 | 0 |
| piano-dense-advanced-vector | 8 | ledger-masking-over-subtraction | width-too-narrow | 0/1 | 1→0 | 0 |
| piano-dense-advanced-vector | 9 | ledger-masking-over-subtraction | width-too-narrow | 0/0 | 1→0 | 0 |
| piano-dense-advanced-vector | 9 | genuinely-absent-usable-ink | width-too-narrow | 0/0 | 0→0 | 0 |
| piano-dense-advanced-vector | 9 | transformed-components-outside-expected-size | head-sized-exists-but-caller-rejected | 0/1 | 0→1 | 0 |

## Notes for Phase 2

- Fragment clustering should run only after ordinary + ledger-masked ink fail with `no-head-sized-component`.
- Prefer reconstructing from ≥2 local `likelyHeadFragment` pieces near glyph origin with exclusive ownership.
- If masking destroys head-sized components, Phase 3 must preserve body pixels under ledger intersections.

