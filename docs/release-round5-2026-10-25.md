# Round 5 release report — 2026-10-25

## Current release state

| item | value |
|---|---|
| Starting main | `462621a03f` |
| Live Worker | `8748583b-da41-4f0c-be52-6d133da94185` |
| Live bundle | `index-DJy6qAU3.js` |
| Live bundle SHA-256 | `79808654cb4a4ba3a46eb9f19de9a4a957b51cf46d53722c7a7e9166eb0bcf06` |
| Round-5 local bundle | `index-BVw0gRmn.js` |
| Round-5 SHA-256 | `c284e708158a83607243cf651730449a090ad07db3ae2969b3350a12678880ea` |
| Deployment | **not deployed**; explicit authorization absent |

The live site moved again after round 4 and now serves the round-4 bundle
`DJy6` from Worker `8748583b`. Its SHA-256 matches the round-4 local build.
Audio Vision v3 and the round-4 Guitar text-run extraction are live.

## Source changes

- Round-5 Guitar center-probe extraction, scoped to TAB only.
- Mixed fixture updated to the corrected half-note artwork from `3446`.
- Standard notation analysis keeps the old edge-only probe.
- Piano `b4f6dce882` not integrated.

## Verification

- Full unit suite: **4011 passed, 19 skipped, 0 failed**.
- Experimental Vision: **27 / 27 Chromium** and **27 / 27 WebKit** on the
  built bundle; mixed guitar falls back with no experimental practice metadata.
- Audio editor against the live site (Chromium): **21 / 21**, including the
  added/edited MusicXML, 9 checkpoints, OSMD, Play Along, Wait For You, tempo
  rebuild and reload.
- PDF-first: **4 / 4**.
- Audio critical UX: **19 / 19** (expected cancellation console log only).
- Unified WebKit arrangement/cursor: **12 / 12**.
- Unified mic practice: **23 passed, 0 failed, 1 skipped**.
- Actual browser PDF.js mixed extraction, Chromium **and** WebKit:
  21 noteheads, 15 confident onsets, 3/4 valid measures, durations
  `{quarter, eighth, half, null}`, 16 measure-3 events null, no measured type
  in measure 3, `rhythm_recovered=false`.

The notation-only fixture still reports 16 eighths + 24 quarters after the
TAB-only probe; the global probe was rejected because it turned this into 40
quarters.

## Rollback

If the round-5 bundle is deployed, rollback target:

```bash
npx wrangler rollback 8748583b-da41-4f0c-be52-6d133da94185
```
