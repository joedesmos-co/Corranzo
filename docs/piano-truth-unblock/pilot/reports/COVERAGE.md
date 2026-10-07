# Pilot notation coverage

Source: `manifests/coverage.json` (aggregated from 990 PASS scores,
242,358 machine-readable objects). Mapping rate is the fraction of source
objects with an exact SVG id join (or, for clef/keySig/meterSig, a resolved
semantic state join).

## Target classes

| class | scores | objects | mapped | mapping rate |
|---|---|---|---|---|
| note | 990 | 170,623 | 170,623 | 1.0000 |
| rest | 946 | 5,641 | 5,641 | 1.0000 |
| mRest | 372 | 907 | 907 | 1.0000 |
| accid | 807 | 6,343 | 6,343 | 1.0000 |
| clef | 990 | 2,001 | 2,001 | 1.0000 (semantic state join) |
| keySig | 906 | 1,203 | 1,203 | 1.0000 (semantic state join) |
| meterSig | 985 | 1,510 | 1,510 | 1.0000 (semantic state join) |
| beam | 792 | 34,247 | 34,247 | 1.0000 |
| tuplet | 96 | 1,330 | 1,330 | 1.0000 |
| tie | 557 | 3,530 | 3,530 | 1.0000 |
| slur | 656 | 2,971 | 2,971 | 1.0000 |
| artic | 706 | 4,761 | 4,761 | 1.0000 |
| dynam | 254 | 654 | 654 | 1.0000 |
| hairpin | 99 | 248 | 248 | 1.0000 |
| tempo | 265 | 485 | 485 | 1.0000 |
| trill | 60 | 239 | 239 | 1.0000 |
| mordent | 13 | 52 | 52 | 1.0000 |
| turn | 1 | 1 | 1 | 1.0000 |
| bTrem / fTrem / trem | 4 | 17 | 17 | 1.0000 |
| arpeg | 66 | 178 | 178 | 1.0000 |
| gliss | 2 | 3 | 3 | 1.0000 |
| pedal | 183 | 1,152 | 1,152 | 1.0000 |
| octave | 58 | 89 | 89 | 1.0000 |
| fing | 64 | 168 | 168 | 1.0000 |
| fermata | 105 | 166 | 166 | 1.0000 |
| breath | 1 | 1 | 1 | 1.0000 |
| reh | 50 | 67 | 67 | 1.0000 |
| dir | 273 | 611 | 611 | 1.0000 |
| ending | 135 | 309 | 309 | 1.0000 |
| harm | 83 | 2,843 | 2,843 | 1.0000 |
| mNum | 5 | 8 | 8 | 1.0000 |
| augmentation dots | 1,764 dotted notes in a 33,156-note sample; encoded as the note `dots` attribute, not as standalone MEI elements | | | |

## Note sub-features

| feature | count |
|---|---|
| grace notes | 1,045 |
| cue notes | 36 |
| octave-shifted notes (`oct.ges` present) | 3,545 |
| notes with written accidental | 6,343 |

## State-join accounting

| quantity | value |
|---|---|
| rendered clef/keySig/meterSig groups | 14,157 |
| resolved (exact + courtesy + within-measure/previous) | 14,028 (99.09%) |
| unresolved (layout group with no queryable MEI element) | 129 (0.91%) |
| mismatched | 0 |

Unresolved groups are redrawn state glyphs at section/system boundaries whose
layout id is not in Verovio's element index; their source state is known from
MEI and they are counted explicitly rather than assumed. No score is claimed to
have 100% verified state glyphs if it has unresolved groups; the manifest
records the count per score.

## Rare / unsupported classes

| class | status |
|---|---|
| tremolo | supported in this corpus: 4 scores / 17 single tremolos imported as `bTrem` and mapped. A hand-written `<tremolo type="single">3</tremolo>` probe was dropped, so single-tremolo support is encoding-dependent and must be checked per source (the dropped-feature detector does this). |
| scoop / doit / fall articulations | imported into MEI but **not rendered** by Verovio; 6 scores quarantined |
| arpeggio | mapped in 66 scores; 1 score had 4 unrendered arpeg elements and was quarantined |
| breath marks | 1 object; too rare to claim general coverage |
| turn | 1 object; too rare to claim general coverage |
| glissando | 3 objects in 2 scores; rare but mapped |
| repeat navigation semantics | endings mapped (309), but repeat/volta playback navigation is source-level metadata, not a glyph class |

## Quarantine reasons (10/1000)

| reason | scores |
|---|---|
| unsupported articulation (scoop/doit/fall) | 6 |
| source identity unverifiable (music21 cannot parse the export) | 2 |
| broken id join (unrendered arpeggios) | 1 |
| ambiguous state join (one clef placement) | 1 |
