# Experimental Vision paths — opt-in, limits and rollback

**Status:** opt-in experimental. Neither Piano vector nor Guitar TAB recognition
is the default. The standard PDF/image OMR path is unchanged.

## Enable

Set one of these before uploading a PDF:

```js
localStorage.setItem('corranzo-experimental-vision-engine-v1', 'piano-vector')
localStorage.setItem('corranzo-experimental-vision-engine-v1', 'guitar-vector')
```

or open the app with:

```
/?experimentalVision=piano-vector
/?experimentalVision=guitar-vector
```

Select the matching instrument (Piano or Acoustic Guitar) before importing the
PDF. Clear the value to return to standard preparation:

```js
localStorage.removeItem('corranzo-experimental-vision-engine-v1')
```

## What the paths do

* **Piano vector** reads digital vector PDFs with PDF.js only. It extracts staff
  lines, glyphs, stems/beams, dots, rests, time signatures, key signatures and
  accidentals, then writes MusicXML. It does not read reference MusicXML,
  fixture metadata or truth files.
* **Guitar TAB vector** reads the PDF's digital text layer and staff geometry
  with PDF.js only. It recovers string/fret events and measure ownership. Its
  duration channel now uses notehead + stem/beam/flag evidence. Paired/techniques
  fixtures recover 32/32 onsets and 8/8 measures; ties/rests/dots and independent
  voices remain unaudited, so practice stays disabled.

## What is intentionally blocked

The generator attaches `omrMeta.experimentalVision` to the score. When
`practiceReady === false`, the import and workspace disable Play Along and Wait
For You; Preview/engraving remains available. This prevents placeholder or
unverified durations from becoming normal practice targets.

Piano practice is also gated when key/time is unknown, notes/rests are
unresolved, ties/slurs are present but not transcribed, or a measure does not
fill the stated meter. The committed beginner fixture currently fails the
measure-fill check (its rest is an eighth where the reference expects a
quarter), so it is correctly preview-only rather than silently practiced.

## Fallback

Any vector failure (no vector staff, no digital TAB events, unsupported runtime
or extraction error) falls back to the existing standard preparation path with
an explicit message. Scanned or image-only PDFs take the standard image OMR
path; vector recognition makes no claim for them.

## Licensing / assets

* PDF.js (`pdfjs-dist` 5.4.296) — Apache-2.0; already a production dependency
  through `react-pdf`.
* No Python runtime, PyMuPDF, external recognition server or research model
  weights are added.
