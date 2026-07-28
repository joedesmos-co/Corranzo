# Manual smoke checklist — post-commit

After pulling the freeze commit, run these checks in the real PDF browser workflow (curves/ties enabled as in product).

## Fantaisie-Impromptu

- [ ] **Page 4 measure count/layout** — ~9 systems, ~29 measures on page 4 (not ~17 single-staff systems / ~78 measures). Grand-staff pairing visible.
- [ ] **Playback duration** — written timeline well under the old ~14 min bomb; expect ~10 min with current tempo map (Largo stickiness still known). No 30‑min validation failure from orphan repeats.

## Minecraft

- [ ] **Whole/half notes** — stemless open heads play/render as wholes; open heads with stems as halves (not mass-collapsed to quarters).
- [ ] **Ties** — cross-bar ties still present; no re-attacks on tied sustains.

## Evangelion (non-regression)

- [ ] **A Cruel Angel’s Thesis** — measure count, note density, and playback duration feel unchanged vs pre-campaign baseline (~125 measures / ~4 min class).

## Freeze reminders

- Do not “fix” duration with clamps or limit bypasses.
- Do not start Hungarian dense work from this checklist.
