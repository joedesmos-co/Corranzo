# Guitar PDMX Acquisition Report (metadata-first, storage-safe)

**Manifest:** `datasets/guitar-vision/pdmx-pilot/dataset-manifest.json`
**Vendored sources:** `datasets/guitar-vision/pdmx/` (35 PASS MXLs + candidates file)
**Upstream:** PDMX Zenodo record 15571083 (CC-BY 4.0, open access)
**Method:** metadata-first (subset lists + 225MB CSV streamed locally, since
deleted from scope) + capped streaming extraction (600MB cap, 48 files, no
full-archive download) + existing truth pipeline + composer-grouped splits.

## RETURN

1. **Storage and safe method:** 7.6 GiB free; 20 GiB floor preserved. Full
   archives (1.9GB mxl / 9.6GB pdf) never touched. Transferred: 29MB subset
   lists + 225MB CSV (parsed, row-filtered, removed from disk budget after) +
   ~600MB capped tar stream (aborted at cap; only 48 wanted members kept,
   ~1MB). Range requests verified (206); gzip sequentiality respected via
   single-pass streaming parse with early abort.
2. **PDMX metadata accessed:** yes — subset paths + full CSV (254,077 rows,
   62 columns). `tracks` codes are opaque (`0`, `0-0`); instrumentation was
   verified from MXL structure per score (same policy as the Piano factory),
   never from tags alone.
3. **Eligible guitar counts:** 917 guitar-mention rows → 152 with
   PD-composer evidence → **124** with no_license_conflict + all_valid + MXL.
4. **TAB-bearing counts:** 10 paired scores with TAB positions in the pilot
   (8 PASS); 0 TAB-only. "Guitar instrumentation" ≠ TAB: most eligible
   scores are standard notation (27 standard-only PASS).
5. **Technique-bearing counts:** 13/35 PASS scores carry techniques
   (arpeggio 7 scores, slide 3, mordent 3, trill, turn). Bends, harmonics,
   tapping, palm-mute, harmonics: 0 in pilot (etudes cover them as
   controlled supervision).
6. **Licensing findings:** record CC-BY 4.0 (commercial OK with attribution);
   per-row `cc-zero`/`publicdomain` mapped to SPDX; no_license_conflict +
   all_valid required; PD-composer evidence required on top because famous
   copyrighted titles (Presley, Slipknot, anime) appear with cc-zero tags —
   the column is not blindly trustworthy for commercial use. 12.29% conflict
   rate acknowledged upstream; conflict rows excluded.
7. **Selective extraction:** 48/124 wanted members under the cap (85k tar
   members scanned); 76 remain retrievable by re-running with a higher cap.
   No full download, no bulk extraction.
8. **Pilot PASS/quarantine:** ingest 38/42 → render+joins 35/42 final
   (playability 4 incl. 1 timing-vacuous; source-id 3). Every quarantine
   carries a reason (overfull measures, same-string impossibilities,
   pitch mismatch, renderer-dropped uniques, multi-instrument).
9. **New real-source technique coverage:** arpeggio/slide/mordent/trill/turn
   (73 instances, 46 parameterized) + 713 articulation labels + 2001 pairings
   + 3452 string / 3197 fret labels. Technique heads still train abstention
   on real data; etudes carry technique supervision.
10. **Remaining gaps:** 21 real DATA_GAPs (all bends, legato, harmonics,
    tapping, palm-mute, capo, frames, navigation, grace/cue in real data…);
    24/29 earlier gaps have etude supervision; TAB-only class still empty.
11. **CASE B.** Closer, but real TAB breadth + technique breadth still require
    the remaining 76 eligible members (same pipeline, higher cap) and/or the
    acquisition shopping list.
12. **Expansion justified:** YES, controlled — fetch the remaining 76
    eligible members (second capped run), then re-freeze. Do not pad with
    synthetic layouts (layouts are variants, never independent scores —
    enforced by collection grouping).

## Render-identity findings at PDMX scale

- Unison duplicates across voices merge to one notehead: exact attach by
  onset+pitch+measure (proven over hundreds of cases).
- Chord tones merge into head groups; multi-voice rests consolidate:
  exact attach by head/twin rules, event-level box masks as gated fallback
  (<2%, allowlisted duplicate classes only; 56 masked events total).
- A unique note the renderer drops blocks masking and quarantines.
- Parser positional mapping (canonical index → stamped id) was WRONG for
  multi-voice scores; mapping is now via document-order noteId counters
  (found during this pilot, fixed, covered by the passing suites).
- Ensemble scores (>2 pitched parts) quarantine structurally at ingest;
  candidate pre-filter n_tracks ≤ 2 added.
- Per-part rhythm lanes (paired notation+TAB no longer merge voices);
  duplicate measure definitions across parts quarantine on disagreement.
- Timing-vacuous gate (>50% measures masked → quarantine, not silent PASS).
