# Piano Vision and Guitar Vision — readiness audit (2026-10-24)

**Verdict: neither research branch is ready to merge or expose as a playable
production engine.** This is an audit only; no branch was merged and no
production code was changed for these two engines.

---

## Piano Vision — `codex/piano-truth-unblock` @ `47620474e0`

### What the commit contains

A PDF.js-only vector OMR prototype:

* `docs/piano-truth-unblock/train/scripts/pdfjs_vector_omr.mjs`
* four hand-built vector PDF/truth pairs;
* `pdfjs_parity.json` (notes/shape parity against a Python reference);
* `pdfjs_vector_complete.json` (complete/pitch/duration/rest/measure scores);
* MusicXML outputs for four fixtures.

### Reproduced results (committed benchmark)

| fixture | complete P | complete R | measure violations |
|---|---:|---:|---:|
| beginner-single | 1.000 | 1.000 | 0 / 8 |
| rhythm-tuplets | 0.857 | 0.857 | 0 / 8 |
| grand-voices | 0.864 | 0.864 | 0 / 8 |
| dense-advanced | 0.704 | 0.602 | **13 / 8 reported** |
| **all four** | **0.785** | **0.718** | — |

321 / 447 reference events are complete (71.8 % recall). The commit message's
“321/447 complete” is accurate; the four fixtures are not an independent
unfamiliar-score set.

### Independent runtime check (current production)

The committed script does **not run against current production's installed
PDF.js**. With `pdfjs-dist@5.4.296`, the operator-list `constructPath` argument
shape is not the array shape the prototype assumes; the script returns:

```
{"route":"image","error":"no staff systems"}
```

and therefore cannot emit MusicXML. The benchmark is not reproducible from the
branch as committed under the production dependency. This is a hard blocker,
not a tuning issue.

### MusicXML / musical correctness audit

The emitted MusicXML **never contains `<alter>`** (checked in all four committed
outputs), even though the research notes and the tile-level MIDI arithmetic
allow chromatic notes. It spells every MIDI pitch with a diatonic step and no
accidental. Consequences:

* every sharp/flat is written as a natural;
* key signatures are not decoded at all;
* transposed or accidental-heavy music is pitch-wrong by construction.

Also missing or incomplete:

* ties (zero `<tie>`/`<tied>` in all four outputs);
* reliable rest placement (only two fixtures have rests; unknown rest glyphs
  are omitted);
* independent voices beyond staff assignment;
* measure validity on the dense fixture (13 violations).

### Licensing

* PDF.js (`pdfjs-dist`) is **Apache-2.0**, already installed as a production
  dependency via `react-pdf`; no new model or restricted weight is introduced.
* The prototype itself is clean to port, but it is not production OMR.

### Minimal path to a safe production engine

1. Port the extractor to the current `pdfjs-dist@5.4.296` operator-list API and
   prove it on the four fixtures.
2. Add accidental glyphs and key-signature decoding; emit `<alter>` and
   `<key>` correctly.
3. Add ties, rest placement, independent voices and measure validation.
4. Build an independent unfamiliar-score reference set; do not tune on the same
   four fixtures.
5. Put it behind an explicit experimental flag and keep the existing image OMR
   fallback untouched.
6. Require real test coverage of accidentals, key signatures, measure timing
   and round-trip playback before any default switch.

**No merge now.** The image OMR fallback remains the production path.

---

## Guitar Vision — `codex/guitar-vision` @ `020292d766`

### What the commit contains

A research raster/TAB pipeline and a cross-font benchmark:

* `tools/guitar-vision/proof-pdf-tab.py` (Python + NumPy + PIL)
* `tools/guitar-vision/pdfjs-extract-page.cjs` (PDF.js text + raster extractor)
* multi-font digit templates using system fonts and bundled OFL Arimo
* `GUITAR_OVERNIGHT_RESCUE.md` with a “DO NOT MERGE” instruction
* research weights (`proof-model.pt`, `stringnet.pt`, heatmap weights)
* leave-one-font-out benchmark (`font-bench/loo.json`)

### Reproduced/committed results

Single Arial-family scan:

* 116/116 string+fret, 32/32 complete events, 8/8 measures valid on
  `guitar-paired-scan`;
* rhythm recovered from a paired notation staff; 32/32 onsets.

Cross-font image-only benchmark (same score, 8 fonts, leave-one-font-out):

* complete events range from **0/116 (Courier) to 30/116 (Verdana)**;
* many fonts validate only 4–7 of 8 measures;
* Arial-only templates are worse still (0–15 complete).

So the “font-independent” claim is not supported. The pipeline is
font-sensitive; the multi-font union improves recall but does not make it
production-safe.

### Runtime and licensing constraints

* The recognition path is **Python/NumPy/PIL**, not a browser module; production
  would need a server or a browser port.
* It depends on system font files for templates (Arial, etc.) plus bundled
  OFL Arimo; the browser cannot assume the system font set.
* The research weights have **no explicit license/provenance file** in the
  branch. They are not eligible for production distribution until that is
  documented.
* PDF.js is Apache-2.0 and production-compatible for the text path; PyMuPDF
  (AGPL/commercial) was avoided in the latest path, which is correct.

### Unverified musical behavior

The branch itself reports:

* **unknown rhythm**: TAB-only layouts drawn with rhythm slashes are not
  implemented (canon-in-d, save-me-bts, gravity-falls);
* **rests**: detected glyphs are not emitted;
* **ties**: not detected/emitted;
* **multi-voice**: unresolved-multi-voice layouts are refused, not solved;
* **large layout**: 77 notes only and 0 % measures;
* **Bravura**: stem-up fragments remain excepted;
* **FULL playable** (string + fret + measure + duration) remains incomplete on
  most layouts.

### Minimal path to safe integration

1. Pick one production runtime (browser PDF.js, or a service with an explicit
   license); do not ship Python/PyTorch research code.
2. Ship only licensed weights or replace them with a deterministic geometric
   path; record provenance.
3. Close the font dependence with a genuinely held-out font set, not the same
   eight system fonts used to build templates.
4. Implement rhythm slashes, rests, ties, multi-voice refusal/emission and
   large-layout support; validate measure timing on independent scores.
5. Keep the text-layer path (PDF.js, Apache-2.0) as an experimental flag and
   the current image fallback as default until timing is proven.

**No merge, no exposure as a playable score.** The branch's own report says
“DO NOT MERGE”; that remains the correct decision.
