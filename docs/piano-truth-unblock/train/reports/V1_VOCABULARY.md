# Piano V1 canonical notation vocabulary + support states (P1/P2)

Evidence: `manifests/v1_support.json` (TRAIN 792 / DEV 99 scores), MEI/SVG
spot-checks documented in the pilot (`proof/REPORT.md`) and this task.
Support states: VERIFIED_SUPPORTED / SUPPORTED_BUT_NOT_YET_MODELED /
VERIFIED_UNSUPPORTED:<reason> / AMBIGUOUS:<reason> / INVALID_SOURCE:<reason>.

Join mechanisms: **id** = MEI id == SVG group id; **state** = semantic
clef/key/meter-style join; **text** = content+position match for layout-id
text groups; **pos** = positional measure-boundary join (barlines).

## STRUCTURE

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| page / system | page geometry on all scores | VERIFIED_SUPPORTED | structure |
| measure | MEI measure ids == SVG ids | VERIFIED_SUPPORTED | id |
| staff | ancestry exact; 97.05% geometric agreement | VERIFIED_SUPPORTED | ancestry |
| voice / layer | ancestry; voices {1,2,3,5,6,7,8}, staves {1..10} | VERIFIED_SUPPORTED | ancestry |
| barlines | SVG groups with layout ids; form in MEI measure `@left/@right` | VERIFIED_SUPPORTED | pos (measure boundary + MEI form) |
| measure numbers | MEI `mNum` (6/1 scores); SVG join verified in builder | VERIFIED_SUPPORTED | id (asserted in code) |

## NOTES / RHYTHM

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| notes | 130,240 / 22,299 | VERIFIED_SUPPORTED | id |
| rests (+mRest, multiRest) | 4,173+730 / 628+70; multiRest id-joins | VERIFIED_SUPPORTED | id |
| chords | derived (same onset + staff/voice + notehead x) | VERIFIED_SUPPORTED | derived+verified |
| onset | ppq accumulation per (measure, staff, layer) | VERIFIED_SUPPORTED | derived+verified |
| duration / dots / double dots | dur + dots attr (`4d2` present) | VERIFIED_SUPPORTED | id |
| beams / beam groups | 26,325 / 4,267 containers | VERIFIED_SUPPORTED | ancestry |
| tuplets | 1,017 / 129, num/numbase; max nesting depth 1 | VERIFIED_SUPPORTED | ancestry |
| nested tuplets | 0 corpus examples | AMBIGUOUS:no-corpus-evidence | — |
| ties | 2,491 / 315, startid/endid | VERIFIED_SUPPORTED | id+links |
| grace notes | 743 / 214 | VERIFIED_SUPPORTED | id+attr |
| cue-size notes | 36 / **0** | VERIFIED_SUPPORTED (train only; no DEV evaluation possible) | id+attr |
| multi-voice rhythm | layers + per-voice onsets | VERIFIED_SUPPORTED | derived |

## PITCH

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| pitch / octave / accidental | pname/oct + accid.ges; oct.ges rule (2,194 / 8) | VERIFIED_SUPPORTED | id |
| enharmonic spelling | preserved exactly in source fields | VERIFIED_SUPPORTED | source |
| clef / key signature | state join 14,028/14,157 pilot-wide | VERIFIED_SUPPORTED | state |
| ledger-position | computed from pitch + governing clef | VERIFIED_SUPPORTED | derived |

## EXPRESSION

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| slurs | 2,225 / 394, startid/endid | VERIFIED_SUPPORTED | id+links |
| staccato / staccatissimo / accent / marcato / tenuto | rendered artic types | VERIFIED_SUPPORTED | id |
| scoop / doit / fall / plop (+rip) | imported, **not rendered** | VERIFIED_UNSUPPORTED:not-rendered | quarantine path |
| fermata | 135 / 12 | VERIFIED_SUPPORTED | id |
| dynamics | 581 / 41 (val attr) | VERIFIED_SUPPORTED | id |
| hairpins (cresc/dim) | 236 / 8, form attr | VERIFIED_SUPPORTED | id+links |

## ORNAMENTS

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| trill | 177 / 52, control form + startid (child form handled if present) | VERIFIED_SUPPORTED | id+links |
| mordent | 43 / 7 | VERIFIED_SUPPORTED | id |
| turn | 1 / 0 | VERIFIED_SUPPORTED (single example; rare) | id |
| other ornaments | none observed | AMBIGUOUS:no-corpus-evidence | — |

## PIANO-SPECIFIC

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| pedal + changes | 1,142 / down-up pairing by staff/order | VERIFIED_SUPPORTED | id+links |
| fingerings | 106 / 62, startid | VERIFIED_SUPPORTED | id+links |
| octave shifts | 73 / 1 elements; oct.ges rule | VERIFIED_SUPPORTED | id+links |
| arpeggiation | 170 / 1; unrendered instances quarantined upstream | VERIFIED_SUPPORTED | id (+quarantine path) |
| tremolos (bTrem/fTrem) | 3+? / 14 mapped | VERIFIED_SUPPORTED | id |
| single-tremolo encodings that drop | detected per source | VERIFIED_UNSUPPORTED:importer-drop | quarantine path |
| glissandi | 1 / 2 objects (1 / 1 scores) | VERIFIED_SUPPORTED (critically rare) | id+links |

## TEMPO / TEXT

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| tempo text + metronome marks | 406 / 32 tempo (metronome→tempo) | VERIFIED_SUPPORTED | id |
| rit. text | dropped from MEI in 4/4 sampled scores, rendered visibly | AMBIGUOUS:rendered-without-MEI-identity | text fallback |
| accelerando | maps to dir+tempo (1 score) | VERIFIED_SUPPORTED | id |
| textual directions (incl. D.C./D.S./Fine/To Coda) | typed `dir` + rend text | VERIFIED_SUPPORTED | id+text |
| rehearsal marks | 59 / 2, reh id-joins | VERIFIED_SUPPORTED | id |

## NAVIGATION

| class | TRAIN / DEV evidence | state | join |
|---|---|---|---|
| repeats (barlines) | measure `@left/@right` (560 scores w/ repeat tokens) | VERIFIED_SUPPORTED | pos+state |
| endings / voltas | 242 / 35 endings; standalone `volta` 0 examples | VERIFIED_SUPPORTED (endings; volta brackets via ending) | ancestry |
| segno / coda | `repeatMark func=segno/coda`, id-joins | VERIFIED_SUPPORTED | id |
| D.C. / D.S. / Fine / To Coda | typed dir + text | VERIFIED_SUPPORTED | id+text |
| playback-order semantics | requires repeat-expansion computation | SUPPORTED_BUT_NOT_YET_MODELED | schema holds links |

## INVALID_SOURCE

MusicXML the independent parser cannot parse (2 pilot scores, excluded from
splits): INVALID_SOURCE:music21-unparseable. Malformed archives or missing
provenance would join them; none observed in TRAIN/DEV.

## What "no silent none" means in practice

Every class above has a state; every object in a PASS score is either joined
(id/state/text/pos/derived/ancestry) or counted in an explicit residual
(unresolved state groups, unrendered measure rests). The canonical builder
(`scripts/v1_events.py`) asserts this per score and fails the score otherwise.
