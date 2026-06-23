# Automatic Score Alignment — Browser Verification Checklist

Headless tests cover reconciliation logic, but cursor follow, overlays, and
page/system transitions need real-browser verification. Run this whenever the
alignment pipeline changes. Pixel detection, cursor math, and the playback
engine are out of scope for automated tests, so this checklist is the gate
before any auto-generated anchors are allowed to drive the cursor.

## Setup
- [ ] `npm run dev`, open desktop Chrome, Safari, and an iPad/tablet (or emulation).
- [ ] Enable the alignment debug overlay (when wired in Phase 4).

## Per fixture (Minuet, Gymnopédie, Guren, Carol, Turkish March, dense/fast, multi-page, repeats/voltas)
- [ ] Score opens and the cursor **starts at measure 1** on play.
- [ ] Cursor advances smoothly within each system (no backward jumps mid-measure).
- [ ] **System transitions**: cursor moves to the next staff at the right moment.
- [ ] **Page transitions**: page turns at the right measure; cursor resumes at top of next page.
- [ ] Repeats/voltas: cursor revisits the repeated measures and takes the correct ending.
- [ ] Reported per-system confidence table matches what you see (weak systems flagged).
- [ ] Recommended action matches reality: AUTO follows cleanly; CONFIRM asks once; MANUAL falls back to tap-to-set.
- [ ] Exported alignment report (`diagnose-alignment` / overlay export) has no surprising warnings.

## Never-wrong rule
- [ ] On a deliberately weak/low-confidence PDF, the app asks for confirmation or
      manual setup — it does **not** silently show a confident-but-wrong cursor.

## Regression (Objective 7)
- [ ] Minuet demo still follows exactly (bundled anchors unchanged until Phase 5).
- [ ] Every previously-working piece still follows at least as well as before.

## Mobile / tablet
- [ ] Layout stays usable; cursor and controls are touch-legible.
- [ ] iPad Safari: audio unlocks on gesture; page-follow suspends ~2s after manual scroll.

## Sign-off
- [ ] Desktop ✅  - [ ] Tablet ✅  - [ ] Mobile ✅ — date / build: ____________
