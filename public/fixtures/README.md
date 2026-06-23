# Corranzo demo fixtures

Public-domain **Minuet in G** (BWV Anh. 114, Notebook for Anna Magdalena Bach; often attributed to Christian Petzold).

Regenerate with:

```bash
npm run fixtures
```

Requires a one-time Python venv:

```bash
python3 -m venv .venv-fixtures
.venv-fixtures/bin/pip install music21
```

## Files

| File | Role |
|------|------|
| `demo-minuet-in-g.pdf` | Sheet music (Mutopia PDF) |
| `demo-minuet-in-g.musicxml` | Score timing — treble + bass parts |
| `demo-minuet-in-g.mid` | Optional playback (Mutopia MIDI) |
| `demo-minuet-in-g.anchors.json` | Pre-calibrated score-follow (demo only; not saved as user data) |

Regenerate anchors only:

```bash
npm run fixtures:anchors
```

## How demo alignment works

The sample uses the **Mutopia PDF** for reading and **MusicXML** (exported from the same MIDI) for timing. Staff auto-detect often fails on this engraved PDF, so Practice loads **bundled anchors** (`source: demo`) that map each system’s measures to normalized x/y on page 1. User uploads still use conservative semi-auto only — bundled anchors never mix with localStorage.

## License

Mutopia Project — [public domain](https://www.mutopiaproject.org/legal.html#publicdomain).
