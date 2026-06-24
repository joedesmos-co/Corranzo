# Corranzo demo fixtures

## Built-in demo (Library card)

Public-domain **Hungarian Dance No. 5** (Johannes Brahms, WoO 1 — piano arrangement).

| File | Role |
|------|------|
| `hungarian-dance-no5/hungarian-dance-no5.pdf` | Sheet music (4 pages) |
| `hungarian-dance-no5/hungarian-dance-no5.mxl` | Score timing (104 measures) |
| `hungarian-dance-no5/hungarian-dance-no5.mid` | Playback MIDI |
| `hungarian-dance-no5/hungarian-dance-no5.anchors.json` | Pre-calibrated score-follow (auto-preview export) |

Bundled anchors are exported from the **auto-setup per-measure preview** (playable beat-1 `x`), not hybrid-reconciled barline bundles. Page 4 measures 96–104 are repaired when six single staves are detected instead of three grand staffs.

Regenerate demo anchors:

```bash
node scripts/calibrate-demo-anchors.mjs \
  --pdf public/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf \
  --musicxml public/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl \
  --piece-id hungarian-dance-no5 \
  --export-preview \
  --out public/fixtures/hungarian-dance-no5/hungarian-dance-no5.anchors.json
```

Do **not** use `--no-refuse` hybrid reconciliation for the public demo.

## Internal regression fixture (Minuet in G)

Kept for tests and calibration scripts — not shown on the Library demo card.

| File | Role |
|------|------|
| `demo-minuet-in-g.pdf` | Mutopia PDF |
| `demo-minuet-in-g.musicxml` | Timing |
| `demo-minuet-in-g.mid` | MIDI |
| `demo-minuet-in-g.anchors.json` | Bundled anchors reference |

```bash
npm run fixtures:anchors   # Minuet anchors (legacy script)
node scripts/calibrate-demo-anchors.mjs --validate-minuet
```

## How demo alignment works

The demo uses the **PDF** for reading and **MXL** for timing. Practice loads **bundled anchors** (`source: demo`) when available; otherwise it runs the same semi-auto setup pipeline as user uploads. Bundled anchors never mix with localStorage.

## License

Public-domain repertoire (Brahms); Minuet via [Mutopia Project](https://www.mutopiaproject.org/legal.html#publicdomain).
