# P4 — page-context architecture (local vs contextual split)

## Task split

LOCAL VISUAL TASKS (single notehead/rest crop suffices):
glyph type (note/rest), pitch evidence (notehead + staff lines + ledger lines),
accidental glyph, dots, articulation glyph, ornament glyph, fingering glyph,
notehead fill (duration evidence), stem/flag presence.

CONTEXTUAL / SEQUENCE TASKS (need surrounding page):
staff ownership, voice, measure membership, beam grouping, tie/slur endpoint
pairing, tuplet scope, pedal/octave/hairpin span membership, navigation,
tempo/text association, repeat expansion.

Rationale (measured): the validated crop-only probe reached pitch 0.680 and
duration 0.686 but staff 0.708 / voice 0.736 sat at or below majority
baselines — local crops provably lack the evidence. Staff/voice are not forced
from crops; they get a system-strip tower.

## Architecture (small comprehensive probe)

Two towers, no monolithic head:

- **Local tower**: 64×64 crop → 3 conv blocks → 128-d (same trunk as the
  validated probe, trained from scratch here).
- **Context tower**: full-width system strip (8 staff gaps tall, resized to
  256×48) → 2 conv blocks → 64-d. The strip shows both staves, stems, beams
  and the notehead's vertical position inside the system.
- **Geometry**: normalized bbox (cx, cy, w, h) concatenated (controls show it
  carries no shortcut signal).
- **Heads**: shared FC(256) → 25 heads: 7 categorical
  (kind/pitch/duration/dots/staff/accidental/voice) + 18 binary membership
  heads (grace, cue, in_beam, tie_start/end, slur, tuplet, artic, ornament,
  fingering, arpeggio, glissando, pedal, octave-shift, hairpin, chord-tone,
  dotted, accidental-present).

Pairwise relation decoding (which tie connects which notes, beam group
partitioning, slur endpoint pairing) is NOT trained in the small probe; the
canonical schema holds the links and the round-trip verifies them. The decoder
is an explicit next step, not a hidden assumption.

## Why this is the smallest sensible design

Staff ownership needs the two-staff system in view; voice needs stems/beams;
spans need the onset neighborhood. A full-page model would work but costs far
more; a crop-only model is proven insufficient for exactly these heads. The
strip is the minimal context that contains the evidence, and the ablation is
built in: the validated crop-only probe is the baseline the context heads must
beat (staff 0.708, voice 0.736).
