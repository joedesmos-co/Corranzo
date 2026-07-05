# Practice Library fixtures

Short built-in practice pieces for Corranzo. Keep this folder intentionally small:
only include public-domain material that has aligned PDF, MusicXML, and MIDI and is
good enough to appear in the visible Practice Library.

Each generated helper score has:

- PDF score
- MusicXML timing
- MIDI playback

Regenerate deterministic assets with:

```bash
npm run fixtures:practice-library
```

## Source status

The visible Practice Library uses public-domain traditional works or public-domain
classical excerpts only. Generated helper scores are limited to simple beginner
guitar melodies with hand-checked notation/TAB alignment. Do not add synthetic
"style" studies or generated piano sketches to the built-in catalog.

Existing non-generated built-ins remain in their original fixture folders:

- Hungarian Dance No. 5
- Minuet in G
- Guitar Ode to Joy
