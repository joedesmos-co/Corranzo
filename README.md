# Corranzo

Practice tool for piano scores: import a PDF + MusicXML (and optional MIDI), follow a moving cursor, loop passages, and use **Wait For You** with microphone or MIDI input.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

Open **Library** to import files or try the demo piece, then **Practice**.

## Features

- MusicXML-only synthesized playback (Tone.js piano) with optional MIDI backing
- Performed-timeline repeats and tempo map
- Speed control (50%–150%), metronome
- Score-follow cursor with semi-auto system calibration
- Measure/beat loops on performed time
- Wait For You checkpoints (beat or note mode)
- Practice statistics in Profile

See [ARCHITECTURE.md](./ARCHITECTURE.md) for timeline, playback engine, and cursor design.

## Development

| Command | Purpose |
|---------|---------|
| `npm test` | Vitest regression suite |
| `npm run lint` | ESLint |
| `npm run fixtures:anchors` | Regenerate demo anchor bundle |

Implementation history: `IMPLEMENTATION_STATUS.md`, `SCOREFLOW_COMPLETION_REPORT.md`.
