# m57 Opening Lead-Note Merge Promotion

## Change

`DEFAULT_MIN_STACK_NOTES` in `openingLeadNoteMerge.js`: **4 → 3**

Extends the existing opening lead-note merge (solo @ div 0 into adjacent stack @ div ≤1) to 3-note stacks — same m113 family, m57-specific gate.

## Simulation (`--min-stack-notes 3`)

| Gate | Result |
|------|--------|
| Promotion gates | **PASS** |
| Dense chord | 201 → 183 (baseline without merge in harness) |
| m57 chord | 6 → 0 |
| Onset / duration / pitch | unchanged |
| Clean | 0 / 0 / 0 / 0 |

Controls stable: m7, m25, m33, m34, m61, m94 unchanged.

## Runtime benchmark (after)

| Fixture | Chord | Onset | Duration | Pitch |
|---------|------:|------:|---------:|------:|
| Clean | 0 (100%) | 0 (100%) | 0 (100%) | 0 (100%) |
| Dense | **183** | 94 | 93 | 147 |

| Measure | Before | After |
|---------|-------:|------:|
| m57 chord | 6 | **0** |
| m94 chord | 8 | 8 |
| m113 chord | 0 | 0 |
| m7 / m33 | unchanged | unchanged |

Dense chord: **189 → 183** (−6). Pitch/onset/duration unchanged.

## Artifacts

- `before/` — pre-promotion dashboard snapshot
- `after/` — post-promotion dashboard snapshot
- `simulation.json` / `simulation.md` — formal harness output

## Verification

- `tests/openingLeadNoteMerge.test.js` — pass (incl. m57-like 3-note stack)
- `npm run build` — pass
- `npm run omr:benchmark-dashboard` — pass (2/2 fixtures)
