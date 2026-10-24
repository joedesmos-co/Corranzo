# October 25 website launch-readiness checklist

**Prepared:** 2026-10-23 (after storage recovery)
**Current `main`:** `8ce5461cc24aa56cf7f143168b1b8e3984f3c4b3`
**Deployed source commit:** `a11e55c28313c6c55d95b788fe2589c9e27cc26b`
**Live bundle:** `index-DLDqtFXm.js`
**Cloudflare version:** `d42dd9b4-c2de-42c5-bbb9-94869eb8d314`

---

## Storage recovery

| measurement | before | after |
|---|---:|---:|
| free on `/System/Volumes/Data` | **2.7 GiB** | **8.3 GiB** |
| recovered | — | **+5.6 GiB** |

Deleted, all reproducible:

* `node_modules/` in eight **preserved** secondary worktrees (each had a
  committed `package-lock.json`); `npm ci` restores them.
* Stale Playwright browser revisions `chromium-1243`, `chromium-1248`,
  `chromium_headless_shell-1243`, `chromium_headless_shell-1248`.
  Playwright 1.61.1 resolves to `chromium-1228`; WebKit 2311 was kept.

Preserved:

* the 28 GiB git pack, all 70 branches/refs, all 10 worktrees and all 5 stashes;
* `benchmarks/` 32 MiB, `datasets/` 6.9 MiB, `public/` 19 MiB, project `tmp/`
  2.4 GiB (research/test evidence), `dist/` and the main `node_modules/`;
* all model weights, MusicXML references and user files.

No `git clean`, reset, aggressive GC, model download, worktree creation or
deployment was run. Focused post-recovery tests: **44/44 passed**.

---

## Checklist

| # | Item | Status | Evidence / caveat |
|---|---|---|---|
| 1 | **PDF upload** | **PASS** | PDF-first Chromium flow 4/4; live product run; `/`, `/privacy`, `/terms`, `/contact` HTTP 200. |
| 2 | **Image upload** | **NOT SUPPORTED (by design)** | No image MIME/extension is accepted. UI explicitly says “Native MuseScore files and direct image files aren’t supported here. Export your score to PDF first.” A claim of direct image upload is a **NO-GO**; PDF-from-photo is the supported workaround. |
| 3 | **Piano score import** | **PASS** | PDF-first import, MusicXML/MXL import, practice modes and score follow verified in Chromium and WebKit. Complex/scan OMR quality remains a quality caveat, not a hard failure. |
| 4 | **Guitar score import** | **PASS for supported inputs** | Guitar PDF/MusicXML import and six-line TAB verified; WebKit acceptance 12/12 includes notation + separate TAB staff and 16 notation / 9 TAB notes. |
| 5 | **Preview / Play Along / Wait For You** | **PASS** | All three modes present and exercised in WebKit 12/12, unified mic 23/0/1, unified MIDI 24/1 known, and Audio Vision critical UX 19/19. |
| 6 | **Red cursor and playback correctness** | **PASS with one known red assertion** | WebKit: cursor present, moved 572→892, stayed on the notation staff rather than TAB, engraving not stretched. Playback cancellation measured at 35 ms. MIDI suite still has the pre-existing `cursor=32.37 box=0` cursor-lock assertion (byte-identical on untouched main). |
| 7 | **Mic recognition and permissions** | **CONDITIONAL PASS** | Production-path accuracy: 6/6 true, 2/24 false, p50 59 ms. Mic/permissions E2E: 23 passed, 0 failed, 1 skipped (neural headless). Permission-denied guidance and Continue fallback pass. **No physical microphone was used**; all audio is injected at the MediaStream boundary. Guitar octave ghosts remain. |
| 8 | **Audio Vision generation and corrections** | **PASS** | Local Chromium 18/18, local WebKit 18/18, live Chromium 18/18. Remove/Undo/Undo last/Clear, duplicate-safe keys, saved MusicXML exactly −1 pitch, reopened corrected score, regeneration, target switching, guitar TAB, different recording. |
| 9 | **Saving and reopening** | **PASS** | Live flow: saved score reopens in the unified Practice Engine with OSMD ready; correction record persists in `omrMeta.arrangement`; after reload/regeneration the saved removal is re-applied. Critical UX restart/reopen 19/19. |
| 10 | **Safari / WebKit** | **PASS** | WebKit correction flow 18/18; unified Practice Engine/cursor/TAB 12/12; 0 console/page errors. |
| 11 | **Chromium** | **PASS** | Correction flow 18/18 local and 18/18 live; PDF-first 4/4; critical UX 19/19; unified mic 23/0/1. |
| 12 | **Failure states / unsupported inputs** | **PASS** | Unsupported extension, malformed audio, silent audio, mic denial, model 404, OMR cancellation and low-confidence refusal all surface honest states; no silent hang. |
| 13 | **Rollback readiness** | **PASS** | Current live version `d42dd9b4-…`; previous version `e27c48d7-b327-482f-ad2d-ca773f31f75c` retained. `npx wrangler rollback e27c48d7-b327-482f-ad2d-ca773f31f75c` restores it. Earlier rollback target `d3c68ba1-…` also remains. |
| 14 | **No unverified research merged** | **PASS** | No Guitar Vision or Piano Vision branch was merged; no model/licensing changes; neural mic remains off. |

---

## Go / no-go

**GO for the scoped October 25 website release:**

* PDF and MusicXML score import for piano and supported guitar scores.
* Preview, Play Along and Wait For You.
* Engraved Audio Vision arrangements with TAB.
* Per-note Audio Vision corrections, persistence and reopening.
* Chromium and WebKit.
* Current live bundle/version and a tested rollback target.

**NO-GO for these unverified claims:**

* direct image/photo upload (not implemented; export to PDF first);
* physical-microphone accuracy (injected-stream evidence only);
* complete guitar octave-ghost rejection;
* all four recognition engines complete (Guitar Vision and Piano Vision remain
  research-only);
* perfect MIDI Wait-For-You cursor locking (known pre-existing assertion).

No deployment was performed for this checklist. The live version is the
previously verified October 25 candidate; there is no new verified release
blocker that would justify another deploy.
