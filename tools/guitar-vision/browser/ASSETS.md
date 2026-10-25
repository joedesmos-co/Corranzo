# Guitar Vision browser prototype — assets, licenses, provenance

Everything the browser pipeline needs at runtime is listed here. There
are **no neural network weights** and **no model files** in this path.

| Asset / dependency | Version | License | Used at runtime? | Notes |
|---|---|---|---|---|
| `pdfjs-dist` | 5.4.296 | Apache-2.0 | yes | PDF text extraction, page rasterisation, worker |
| `opensheetmusicdisplay` | 2.2.0 | BSD-3-Clause | demo only | engraves the generated MusicXML in the browser |
| `@napi-rs/canvas` | 0.1.100 | MIT | Node validation only | supplies a canvas to PDF.js; browsers use `<canvas>` |
| `playwright` | 1.61.1 | Apache-2.0 | test only | headless browser evidence |
| `fonts/Arimo.ttf` | OFL-1.1 | OFL-1.1 | no (Python raster path only) | fallback digit templates for the research scanner; not browser runtime |
| `fonts/Arimo-OFL.txt` | — | OFL-1.1 | — | license text for Arimo |

## Weights vs templates

- **No trained weights** are shipped or downloaded. The earlier detector
  experiment (`heatmap-ignore.pt`) is not used by this pipeline.
- The Python raster research path renders ordinary **glyph templates**
  (0–9 bitmaps) from fonts; they are not learned parameters. The browser
  port does not ship or use digit templates: it uses the PDF text layer.
- The MusicXML serializer, geometry and rhythm logic are ordinary code.

## No hidden services

Recognition runs locally. There is no upload endpoint, no inference API,
and no telemetry. The demo serves static files from the local Vite dev
server; PDF bytes never leave the browser.

## Reproducing the browser evidence

```bash
node tools/guitar-vision/browser/validate.mjs
node tools/guitar-vision/browser/browser-evidence.mjs
```

The second command starts Vite locally, uploads
`benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf`
into headless Chromium, runs the JS pipeline, engraves the MusicXML with
OSMD, and writes a screenshot to `/tmp/proof/browser-evidence.png`.

## Supported / unsupported (current JS port)

- Digital guitar TAB PDFs with a text layer: **supported**.
- Image-only scans: **not ported** to the browser (Python research path
  remains; 116/116 on its reference scan).
- TAB-only beamed rhythm slashes: **not supported** (no independent rhythm
  reference established).
- Beam/flag verification: **ported** and used for durations; the mixed-
  value notation reference classifies 40/40 onsets (16 eighths).
