# Round 6 release report — 2026-10-26

## Current release state

| item | value |
|---|---|
| Starting main | `1d12df63b4` |
| Live Worker | `d367ee53-3cf6-4d1f-9117-36b9bc3b69a1` |
| Live bundle | `index-BVw0gRmn.js` |
| Live bundle SHA-256 | `c284e708158a83607243cf651730449a090ad07db3ae2969b3350a12678880ea` |
| Round-6 local bundle | `index-nUlncSNZ.js` |
| Round-6 SHA-256 | `8c8b5b165596299dc381ac7fef89a2327520c227f271dc26f4ca5061c6693402` |
| Deployment | **not deployed**; explicit authorization absent |

The live site advanced after round 5 and now serves `BVw0gRmn` from Worker
`d367ee53`. Its hash matches the round-5 local build. Round 6 does not replace
or duplicate Audio Vision v3.

## Round-6 source changes

- Piano practice gate now requires explicit `voiceOwnership === 'verified'`;
  current staff-only extraction can never authorize practice. Commit
  `61e1e3a2f9`.
- Corrected Piano corpus added separately; canonical evaluator now reports
  note, rest, pitch, duration, full-event, measure and abstention fields.
  Commit `e63ba043dc`.
- Independent Verovio engraving fixtures added; vector route must abstain.
- Permanent integration-owned adversarial harness added.
- No Piano candidate extraction port.
- No Guitar recognition code change; `3b755220af` is fixture artwork only.

## Verification

- Full unit suite: **4015 passed, 19 skipped, 0 failed**.
- Experimental Vision: **27 / 27 Chromium** and **27 / 27 WebKit** on the
  built bundle; corrected/gated Piano stays preview-only and mixed Guitar
  falls back.
- Audio Vision live editor: **21 / 21 Chromium** on the current live site.
- PDF-first: **4 / 4**.
- Audio critical UX: **19 / 19** (expected cancellation console only).
- Unified WebKit arrangement/cursor: **12 / 12**.
- Unified mic practice: **23 passed, 0 failed, 1 skipped**.
- Actual browser PDF.js mixed Guitar: 21 noteheads, 15 confident onsets,
  3/4 measures, 16 measure-3 nulls.
- Independent Verovio PDFs: `route=image`, 0 vector notes, practice false.
- Piano adversarial harness: production **10/10** refused; `b4f6` candidate
  **6/10** (four false acceptances).

## Rollback

If the round-6 bundle is deployed:

```bash
npx wrangler rollback d367ee53-3cf6-4d1f-9117-36b9bc3b69a1
```
