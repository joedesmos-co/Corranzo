# Guitar Vision — browser-compatible prototype

PDF → TAB staff → string/fret → rhythm → MusicXML, implemented in
JavaScript with `pdfjs-dist`. No Python, no server-side recognition.

## Run

```bash
# Node validation against the reference fixtures
node tools/guitar-vision/browser/validate.mjs

# Browser demo (Vite, local static server)
npx vite tools/guitar-vision/browser --config tools/guitar-vision/browser/vite.config.mjs

# Headless browser evidence + screenshot
node tools/guitar-vision/browser/browser-evidence.mjs
```

In the demo: choose a digital TAB PDF, press **Transcribe**, download the
MusicXML, and inspect the OSMD engraving.

## Reference results (this JS implementation)

| fixture | string/fret | complete timed events | measures |
|---|---|---|---|
| guitar-paired-chords-vector | 116/116 | 32/32 | 8/8 |
| guitar-techniques-paired-vector | 32/32 | 32/32 | 8/8 |
| guitar-tab-sparse-vector | 32/32 | 0/32 (abstains: no notation noteheads) | 0/8 |
| **total** | **180/180** | **64/64** | — |

Browser run (headless Chromium, paired fixture): 116 events, 2 TAB
staves, 32 onsets, 8/8 measures, **204 ms** including PDF rendering and
OSMD engraving; XML 34,962 bytes.

## Honesty / limits

- Rhythms are filled-notehead quarters constrained by measure validation.
  Beam/flag verification is not ported; every such duration carries an
  "unverified" footnote and the score metadata names the method.
- If no notation noteheads exist (sparse fixture), durations are genuinely
  unknown: no `<type>`, footnote, `rhythm_recovered=false`.
- Scanned/image-only PDFs are not ported to the browser (the Python
  research path remains; 116/116 on its reference scan).
- TAB-only beamed rhythm slashes are unsupported; no independent reference.
- No model weights; licenses and provenance are in `ASSETS.md`.
