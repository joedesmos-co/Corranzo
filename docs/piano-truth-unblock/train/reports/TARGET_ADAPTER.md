# T1 target-adapter audit + T2 round-trip

Items: deterministic subsets `train100` (19,732 items) / `dev20` (5,371 items),
hash-ranked by `piano-trainfit-v1` from frozen TRAIN/DEV; TEST never touched.
Crops: 64×64 grayscale, notehead/rest bbox center + 3 staff-gap margin, resized.

Coordinate mapping (verified, not assumed): `png = (svg_units +
page_margin_translate) / 10 × (png_width / svg_page_width)`, translate parsed
per page SVG (uniformly `(500, 500)` in the pilot). The T3 overlay audit caught
a missing-translate bug (boxes shifted ~59 px); fixed before any training, with
1,211/1,211 boxes containing ink afterwards.

## Per-family adapter rules

| family | source field | identity | encoding | masking rule | unsupported / excluded rule |
|---|---|---|---|---|---|
| kind | tag | MEI id↔SVG id | {rest:0, note:1} | always on | — |
| notes | note objects | id join | per-note item | masked off for rests | — |
| rests (incl. mRest) | rest/mRest objects | id join | per-object item | masked off note-only heads | mRest without `dur` → duration masked, still a rest item |
| pitch | pname/oct + accid_ges | id join | MIDI = 12(oct+1)+step+alter over fixed 21–108 | notes only | — (printed pitch incl. octave shift; `oct.ges` recorded separately) |
| duration | dur + dots | id join | class over observed dur+dots vocab (11) | masked when `dur` is None or DEV-OOV | — |
| staff | staff ancestry/attr | id join + geometry | index over observed staves {1,2,3,4} | OOV masked | — |
| voice | layer voice | id join | index over observed voices {1,2,3,5,6,7,8} | OOV masked | — |
| accidentals | accid.ges | id join | {none,f,n,s} | notes only | — |
| beams | beam elements | id join | **excluded**: relation over multiple notes, not a single-crop target | n/a | documented, not mapped to none |
| dots | note/rest `dots` attr | id join | int class 0–3 | always on | — |
| tuplets | tuplet elements | id join | **excluded**: group object | n/a | documented |
| ties/slurs | tie/slur | id join | **excluded**: pairwise relations | n/a | documented |
| articulations | artic | id join | **excluded from this proof's heads** (auxiliary) | n/a | unsupported types (scoop/doit/fall) already quarantined upstream |
| dynamics/hairpins | dynam/hairpin | id join | **excluded**: region symbols | n/a | documented |
| ornaments | trill/mordent/turn | id join | **excluded from heads** (rare: trill 60 scores...) | n/a | documented |
| grace | note `grace` attr | id join | binary | notes only | — |
| cue | note `cue` attr | id join | binary | notes only | — |
| fingerings | fing | id join | **excluded from heads** | n/a | documented |
| pedal | pedal | id join | **excluded**: region control | n/a | documented |
| octave shifts | octave + oct/oct.ges | id join | via pitch (printed) | notes only | truth stores both octaves |
| arpeggios | arpeg | id join | **excluded from heads** | n/a | unrendered arpeggios quarantined upstream |
| glissandi | gliss | id join | **excluded from heads** (3 objects) | n/a | documented |
| tempo | tempo | id join | **excluded**: page control | n/a | documented |
| text (dir/reh/harm) | dir/reh/harm | id join | **excluded**: layout text | n/a | documented |
| state symbols (clef/keySig/meterSig) | MEI state + SVG layout groups | semantic state join | **excluded**: page state, not per-object targets | n/a | documented |

No unsupported class is silently mapped to "none": excluded families are
recorded above, and quarantined sources never reach the adapter (splits contain
PASS scores only).

## Vocabularies (fixed for this proof)

- dur (11): 16d0, 16d1, 1d0, 2d0, 2d1, 32d0, 4d0, 4d1, 4d2, 8d0, 8d1
- pitch: MIDI 21–108 (index = midi − 21)
- acc: none, f, n, s
- voice: 1, 2, 3, 5, 6, 7, 8
- staff: 1, 2, 3, 4
- dots: 0–3; grace/cue: binary; kind: rest/note

DEV-OOV symbols are masked (target −1, mask 0), never forced into a wrong class.

## T2 round-trip result

`manifests/roundtrip.json`: **25,103 items checked, 0 failures**
(24,086 notes, 935 rests, 82 mRests). Vocabularies injective; every masked item
matches truth missingness; decode reproduces source symbols per class.

## T3 overlay QA result

`qa/` packet: 8 pages (6 train + 2 dev), **1,211/1,211 boxes in bounds and
containing ink**, labels drawn from truth strings (pitch, duration, staff,
voice). Visual inspection confirms boxes sit on noteheads with pitch-consistent
labels. No model predictions used.
