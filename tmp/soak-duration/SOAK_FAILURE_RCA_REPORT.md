# Soak failure RCA — Impossible duration / choppy / score-class

Date: 2026-07-27  
Scope: Fantaisie-Impromptu, La Campanella, Minecraft, Hungarian Dance No. 5, Evangelion control, choppy playback.

Freeze preserved: ActiveScore, PDF cache, automatic OMR, beams/ties/accidentals/articulations, Piano sampler semantics, Guitar mapping, pre-soak fixes, frozen evaluator. No max-duration raise. No final-duration clamp.

---

## 1. Fantaisie-Impromptu — duration failure

**Reproduced:** Live OMR → MusicXML validated as  
`Generated playback failed — detected duration is too long (536 min)`  
(user reported ~484 min; same class).

| Metric | Before fix | After fix |
|---|---|---|
| Written measures | 193 | 193 |
| Written duration | ~14.0 min | ~14.0 min |
| Performed measures | **7736** (= `193*40+16` maxSteps) | **193** (written fallback) |
| Performed / validated duration | **536 min** | **14.0 min** (passes 30‑min guard) |
| Repeat marks in XML | 4 orphan `<repeat direction="backward"/>` | same historical XML; parser aborts expansion; new OMR sanitizes |

**First failing stage:** Repeat expansion (`buildPerformedMeasureTimeline`), not per-measure x-position rhythm.

**Exact root cause:**
1. OMR falsely emitted **4 unmatched backward repeats** (measures 129, 134, 156, 157) — no forward partners.
2. Multiple orphan backwards are a **non-terminating / maxSteps** graph under the linear expander.
3. `durationSeconds` used **performed** clock even when diagnostics said “follows written order,” so validation saw hundreds of minutes.
4. Written length (~14 min) is longer than truth (~4–5 min) from over-segmentation/tempo — **under** the 30‑min guard and not the hard failure.

**Accepted changes:**
- Per-section pass counters + safer section pairing (do not re-attach a later backward to an already-closed forward).
- `detectUnsafeRepeatExpansion` → written-order fallback when multiple orphans / non-terminating graphs.
- `parseMusicXml` uses written duration when `usesPerformedTimeline` is false.
- OMR `sanitizeOmrRepeatMarkings` strips unsafe repeat sets before MusicXML emit.

**Not done:** Raising/removing the 30‑min limit; clamping duration; filename branches.

**Remaining:** Written timeline still longer than edition truth; recognition quality separate.

---

## 2. La Campanella — duration failure

**Reproduced:** Live OMR → **271 min** (user ~278).  
`performedMeasureCount = 7576` = `189*40+16` maxSteps.

**Marks:** forward@132, backward@87 (orphan), @145, @165 — mixed orphan + multi-closer graph.

**First failing stage:** Same — repeat expansion → maxSteps.

**Root cause:** Same class as Fantaisie (unsafe OMR repeat graph + performed duration used for validation).

**After fix:** duration **6.75 min**, validation **ok**, abort reason `multiple-orphan-backward-repeats` (written fallback).

**Remaining:** Recognition accuracy / written vs edition length; not a duration bomb.

---

## 3. Minecraft — accuracy failure (not duration)

**Reproduced:** Duration **ok** (~3.8 min). Recognition substantially wrong.

**Source features (PDF):** 3 pages, **0 raster paint ops** (vector), modest text, **low operator density** (~1k ops/page) vs Evangelion (~2.9k).

**OMR output traits:** 585 notes, **ties=124** (high), **beams=16** (very low), chords=154. Sparse visual long notes/ties — not empty-measure duration explosion.

**Honest RCA (no global retune this pass):**
- Failure class = **sparse / long-value / heavy-tie** notation, not impossible timeline.
- Likely strata: half/whole / stemless heads, dotted longs, tie spanning, grand-staff pairing, large visual gaps misread as rhythm (quality), not the repeat maxSteps bug.
- Evangelion succeeds with denser beams (538) and richer chord encoding under the same vector pipeline — different notation stratum, not “OMR fixed.”

**Accepted:** No accuracy retune. Duration path unchanged for this piece.

---

## 4. Hungarian Dance No. 5 — accuracy failure (not duration)

**Reproduced:** Duration **ok** (~4.8 min with 1 legitimate-ish backward expanding 105→155 performed measures).

**Source features:** 4 pages, vector, **very high path density** (~25k ops/page) vs Evangelion (~2.9k) — dense engraved accompaniment / beams as paths.

**OMR traits:** 1501 notes, chords=748, beams=62 (low vs density), ties=22.

**Honest RCA:**
- Failure class = **dense multi-voice / chordal accompaniment** under path-heavy engraving.
- Likely strata: repeated chords, opposite-stem voices, 2/4 packing, slur/articulation clutter, notehead separation — not repeat explosion.
- Single backward repeat expands finitely and remains allowed.

**Accepted:** No global recognition retune.

---

## 5. Choppy playback

**Proven class (separate from OMR accuracy):** main-thread pressure during dense scheduling + DEV diagnostics, not “too many musical notes.”

**Evidence / design:**
- `ScorePlaybackEngine.scheduleWindow` could fire **entire 2.5s lookahead** of `triggerAttackRelease` on one interval tick.
- Cursor already on separate RAF + `getScoreTime()` (not per-note React).
- DEV `logPianoTrigger` was enabled for **every note** whenever `import.meta.env.DEV` — console I/O on Evangelion-class density.

**Accepted fixes:**
1. **Chunked scheduling** — max 48 triggers/slice, `setTimeout(0)` continuation; absolute Tone times unchanged (timeline preserved).
2. **Per-note piano trigger logs** require explicit `localStorage['corranzo-piano-perf']='1'` (no default DEV spam).
3. **Visuals-off diagnostic:** `localStorage['corranzo-playback-visuals-off']='1'` disables cursor RAF + PDF page-follow for A/B.

**Not changed:** Note counts, polyphony cap (72), performed timeline content.

**Remaining:** Full UI A/B on device still recommended; PDF page raster on page-turn can still hitch.

---

## Validation run (this pass)

- `tests/durationOverflowRepeats.test.js` — pass
- `tests/timelineExpansion.test.js` — pass
- `tests/interpretationSprint1.test.js` — pass
- `tests/densePianoPlayback.test.js` — pass
- `tests/playbackSchedulerChunking.test.js` — (run with suite)

Artifacts: `tmp/soak-duration/*.summary.json`, `score-class-rca.json`, live MusicXML snapshots.
