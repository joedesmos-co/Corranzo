# Round 4 release report — 2026-10-25

## Current release state

| item | value |
|---|---|
| Starting main | `e0953c434d` |
| Live Worker | `0ccc559c-10d5-43df-92db-42a5715790cb` |
| Live bundle | `index-ks2_w5OX.js` |
| Live bundle SHA-256 | `2007f8939497160e25544dca0fa103f33846c541e527a256ef7f483a8445a70e` |
| Live routes | `/`, `/privacy`, `/terms`, `/contact` all 200 |
| Round-4 local bundle | `index-DJy6qAU3.js` |
| Round-4 bundle SHA-256 | `79808654cb4a4ba3a46eb9f19de9a4a957b51cf46d53722c7a7e9166eb0bcf06` |
| Deployment | **not deployed**; explicit authorization absent |

The live site already serves the round-3 Audio Vision v3 editor bundle (`ks2`),
not the older round-2 bundle. The live file hash matches the round-3 local
build exactly, and the live bundle contains the v3 correction storage key.

## Source changes

- Audio v3 from round 3 remains in main: `f4fb61a2c7`, `c610ac7afd`,
  `870777bb91`.
- Round-4 guitar extraction-only split: `d31a569572`.
- Piano `723b47847c` and Guitar timing/stem changes from newer research were
  not integrated.

## Verification

- Full unit suite: **4009 passed, 19 skipped, 0 failed**.
- Build: `index-DJy6qAU3.js`.
- Audio editor local built (Chromium): **21 / 21**.
- Audio editor against the live site (Chromium): **21 / 21**, including
  add/remove/undo, tempo rebuild, persisted pitches, 9 checkpoints, OSMD,
  Play Along, Wait For You and reload.
- Experimental Vision (Chromium/WebKit): **27 / 27** each, including the mixed
  guitar fixture falling back with no experimental practice metadata.
- PDF-first: **4 / 4**.
- Audio vision critical UX: **19 / 19** (one expected cancellation console
  message, no page errors).
- Unified WebKit arrangement/cursor: **12 / 12**.
- Unified mic practice: **23 passed, 0 failed, 1 skipped**.
- Guitar text-run focused tests: **8 / 8** after the final mixed-width case.
- Live bundle SHA-256 matches the round-3 local Audio v3 build:
  `2007f8939497160e25544dca0fa103f33846c541e527a256ef7f483a8445a70e`.

## Rollback

If the round-4 bundle is later deployed, rollback target:

```bash
npx wrangler rollback 0ccc559c-10d5-43df-92db-42a5715790cb
```

The round-4 tree contains all prior round-2/3 changes; there is no need to
deploy an older tree.
