# Manual smoke checklist — P1 tempo + dotted quarters

After pulling these changes, run in the real PDF browser workflow (curves/ties enabled).

**Status:** completed 2026-07-28 against live Vite (`127.0.0.1:5173`) via real UI upload path.  
Evidence: `SMOKE_RESULTS.md`, screenshots `smoke-*.png`.

## Fantaisie-Impromptu (Phase 1)

- [x] **Tempo return** — after Largo, playback leaves 50 BPM at printed Moderato cantabile / Presto (not stuck for the rest of the piece).
- [x] **Duration** — performed length ~5 min class (not ~10 min Largo hang). Observed **5.205 min**.
- [x] **a tempo** — restores the prior explicit tempo, not a random default.
- [x] **No hardcoding smell** — same behavior if the PDF is renamed.
- [x] Play / Stop / seek across Largo→Moderato boundary; cursor owner stayed synchronized.

Observed BPM (UI Tempo label): start **84** → Largo **50** → Moderato **108** → Presto **168**.

## Minecraft (Phase 2)

- [x] **Dotted quarters** — visibly more augmentation dots on quarter chords/notes vs `b818184` (expect partial, not complete recall). **17** quarter. (was 0).
- [x] **Whole/half** — still largely intact vs `b818184` (minor whole drop OK; not collapsed to quarters). whole **144** (was 151).
- [x] **Ties** — 62-class curve ties; no re-attacks on tied sustains.
- [x] **Staccato** — no false-dot explosion; dotted-quarter MusicXML durations = 6 (1.5× quarter).

## Evangelion (non-regression)

- [x] **A Cruel Angel’s Thesis** — ~125 measures / ~4 min; tempo map and note density feel unchanged. **125 measures / 4.052 min**; quarter. = 15.
- [x] Piano playback smooth; no blocking console exceptions (only known transport update-depth warnings under rapid programmatic seek).

## Freeze reminders

- Do not invent BPM outside `TEMPO_WORD_BPM`.
- Do not loosen augmentation-dot geometry without Evangelion proof.
- Do not start Hungarian dense work from this checklist.
