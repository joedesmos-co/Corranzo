# Guitar PDMX Second Acquisition (76 remaining candidates)

**Manifest:** `datasets/guitar-vision/pdmx/dataset-manifest.json` (superset;
`pdmx-pilot/` preserved untouched)
**Vendored sources:** `datasets/guitar-vision/pdmx/` (51 PASS MXLs, CC-BY-4.0
with per-file composer/license evidence in candidates file)
**Method:** second capped stream (900MB cap, 126,687 tar members scanned,
23 new files) + identical pipeline + composer-grouped frozen splits.

## Retrieval

- Want-list: 76 missing eligible members; retrieved 23 before the cap.
- 53 eligible members remain deeper in the archive (retrievable by another
  capped run; stopped per anti-indefinite-search policy).
- 1 Rodgers/Hart medley caught by composer review and quarantined despite
  passing the token filter (mixed-copyright file).

## Validation (new batch: 19 candidates → 16 PASS)

- 3 playability quarantines (overfull measures, same-string impossibilities).
- New real techniques: slide +44 instances (now 6 scores, all splits).
- Render joins 1.0 × 3 layouts on all 16.

## Combined PDMX dataset: 51 PASS / 1 quarantine

- Distribution: 40 standard-only / 11 paired / 0 TAB-only.
- Coverage: 56 families. Techniques: arpeggio (11), slide (6), mordent (3),
  trill (2), turn (2) — 220 instances, 101 parameterized.
- Targets: objects 37332, string 4927, fret 4608, rhythm 37153, pitch 34809,
  pairing 2892, articulation 2202.
- Splits CLEAN: 18 train / 15 validation / 11 heldout / 5 diagnostic,
  composer-grouped, digest-frozen. Sanity 408/412 (4 strict-timing flags,
  all masked + documented). Duplicates: none. Masks: measure + box-level
  recorded per score.

## Remaining real DATA_GAPs (21)

Bends, hammer-on/pull-off, harmonics, tapping, palm-mute, let-ring,
dead/ghost, vibrato, tremolo-picking, alternate tuning, capo, fingering,
frames, repeats/endings, segno/coda/DS-DC, grace/cue, chord symbols —
24 of the earlier 29 gaps hold etude supervision; TAB-only class empty.

## Decision: CASE B

Common V1 techniques (bends, legato, harmonics, tapping, palm-mute) have
zero real-score instances. Training NOT authorized. Next: remaining 53
eligible members (same method) + targeted etude/commission coverage for the
listed families, then CASE-A re-evaluation.
