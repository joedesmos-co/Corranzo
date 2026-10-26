# Round 7 release report — 2026-10-26

## Current release state

| item | value |
|---|---|
| Starting main | `83442fd08a` |
| Live Worker | `43b01fef-02b9-45cb-93ea-40a917d0a7fb` |
| Live bundle | `index-nUlncSNZ.js` |
| Live SHA-256 | `8c8b5b165596299dc381ac7fef89a2327520c227f271dc26f4ca5061c6693402` |
| Round-7 app bundle | unchanged `index-nUlncSNZ.js` |
| Deployment | **not deployed**; explicit authorization absent |

The live site advanced after round 6 and already serves the round-6 gate bundle
`nUlncSNZ` from Worker `43b01fef`. Round 7 adds evaluation/test evidence and a
test-only adversarial expansion; it does not require a new app bundle. Audio
Vision v3 remains live.

## Round-7 changes

- Expanded integration-owned Piano adversarial corpus to 15 controls.
- Added an independent-engraver browser fallback harness.
- Recorded image-OMR precision/recall on the Verovio corpus.
- Evaluated `d9680e5703` on the corrected corpus and with the adversarial
  harness.
- No Piano extraction or practice-enablement port.
- No Guitar, Mic or Audio product behavior change.

## Verification

- Full unit suite: **4015 passed, 19 skipped, 0 failed**.
- Experimental Vision: **27 / 27 Chromium** and **27 / 27 WebKit**.
- Audio editor against live site: **21 / 21 Chromium**.
- PDF-first: **4 / 4**.
- Audio critical UX: **19 / 19**.
- Unified WebKit arrangement/cursor: **12 / 12**.
- Unified mic practice: **23 passed, 0 failed, 1 skipped**.

## Rollback

Current live is already the round-6 gate bundle. If any later deployment is
needed, rollback target:

```bash
npx wrangler rollback 43b01fef-02b9-45cb-93ea-40a917d0a7fb
```
