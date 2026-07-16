# Practice Library fixtures

Curated Mutopia / public-domain editions for the built-in Practice Library.

## Policy

- Prefer Mutopia engraved PDF + MIDI
- MusicXML timing from the same-edition MIDI (music21), never OMR for built-ins
- Every piece declares `license`, `provenance`, `difficulty`, and `tags`
- OMR is only for user uploads in My Uploads

## Regenerate

```bash
python3 -m venv .venv-fixtures
.venv-fixtures/bin/pip install music21
npm run fixtures:practice-library
```

Catalog source of truth: `manifest.json` in this directory.
