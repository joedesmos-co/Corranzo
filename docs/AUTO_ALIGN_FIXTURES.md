# Alignment Fixture Set & Golden Snapshots (Phase 2b)

License-safe fixtures + golden reconciliation snapshots, built **before** any
anchor-generation changes. Nothing here changes runtime behaviour — it is test
data and expectations that let later phases prove they don't regress.

Catalog: `tests/fixtures/alignmentFixtures.js`
Tests: `tests/alignmentFixtures.test.js`
Print reports: `node scripts/diagnose-alignment.mjs --fixtures`

## License policy

- Only redistributable assets are bundled (public domain / generated).
- No random MuseScore user uploads.
- A piece that can't be safely redistributed is **metadata-only** with a
  documented reason — never faked.

## Runnable fixtures (real model runs; golden asserted)

| ID | Source / license | Measures | Pages | Systems | Per-system | Flags | Action |
|----|------------------|----------|-------|---------|------------|-------|--------|
| `minuet-in-g` | Mutopia, **Public Domain** (bundled) | 32 | 1 | 6 | 5,5,6,5,5,6 | — | auto |
| `repeats-voltas` | Generated MusicXML | 5 | 1 | 2 | 2,3 | repeats/voltas (performed 8 vs 5) | auto |
| `multi-page` | Generated MusicXML | 6 | 2 | 3 | 2,2,2 | page break | auto |
| `dense-fast` | Generated MusicXML | 12 | 1 | 3 | 4,4,4 | tempo change @m7 | auto |

These cover the structural profiles of the named hard pieces (repeats/voltas,
multi-page, dense/fast) with fully redistributable inputs.

## Metadata-only fixtures (documented; not bundled)

| ID | Composer | License | Bundled | Expected | Why metadata-only |
|----|----------|---------|---------|----------|-------------------|
| `gymnopedie-1` | Satie (1866–1925) | Public Domain | no | auto | PD, but no verified engraving bundled yet. |
| `guren` | Contemporary | **Copyrighted** | no | auto* | Score not redistributable; documented from existing repo analysis. |
| `carol` | Traditional | Public Domain | no | auto | PD melody; no concrete engraving chosen yet. |
| `turkish-march` | Mozart K.331 | Public Domain (Mutopia) | no | confirm | PD & safe, not bundled to avoid large binaries pre-anchor-gen; dense/fast/multi-page. |

\* **Guren** is the real-world PDF↔MusicXML mismatch case: MusicXML system breaks
(~19 systems) disagree with the printed PDF (~11 systems / 2 pages, 75 measures),
per `tests/gurenAnchors.test.js` and `scripts/debug-guren-anchors.mjs`. The PDF is
the source of truth; reconciliation flags the mismatch while following the
confident PDF barline layout. Only numeric layout facts are used — no score content.

## Golden snapshot fields (per fixture)

total written measures · PDF page count · system count · per-system measure counts ·
page/system starts · repeats/voltas · tempo-change · time-signature-change · pickup ·
expected follow action (auto / confirm / manual).

## Next (Phase 3)

When anchor generation is unified, add golden **anchor** snapshots per runnable
fixture and require auto-generated anchors to match the bundled Minuet ground
truth before they may drive the cursor. Metadata-only pieces graduate to runnable
once a verified redistributable source file is added.
