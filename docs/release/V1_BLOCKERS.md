# Corranzo V1 launch blockers

Product baseline **7348b699ac**, audited 2026-10-07. **Do not release yet.** [V1_COMPLETENESS.md](V1_COMPLETENESS.md) contains the classification matrix, code register and runtime procedures; [V1_EXECUTION_PLAN.md](V1_EXECUTION_PLAN.md) assigns ownership. The absence of proof is distinguished from reproduced failure. No research accuracy metric is treated as product completion.

## P0 — Cannot release

### B01 — Saved score retention and atomic recovery (BROKEN)

**Evidence:** `features/session/sessionPersistence.js`: seven-day expiry, fixed file keys and separate transactions. `hooks/useSessionPersistence.js`: expired sessions call `clearSessionStorage`; saving commits metadata before IndexedDB files and swallows file errors. R7 reproduced expiry deletion. Generation guards protect some stale writers, but do not make the manifest/blob commit atomic.

**Impact:** Normal return after a week deletes the saved bundle; quota/crash between manifest and file writes can leave an unrecoverable or mismatched saved score. The product calls it a saved score, not a disposable cache.

**Closure:** Keep saved source data until explicit removal/replacement; use generation-addressed or transactional bundles with commit-last manifests; preserve the last valid generation if interrupted. Inject failure at every write boundary, kill/reload during save/import, and reopen after >7 days. The last committed PDF, matching XML/MIDI/source map, instrument, page and preferences must survive; corrupted newest state must expose recovery without destroying the older copy. Preserve the disclosed one-slot-per-instrument scope.

**Dependencies:** None on research. Owner: durable storage/session lane.

### B02 — Truthful save failure and corruption recovery (BROKEN)

**Evidence:** `profileStorage.saveStats` returns false; `manualPracticeLog.saveManualSession` and `autoPracticeTracker.endAutoPracticeSession` ignore it. R7 returned a newly saved session with persisted count still zero under quota failure. Score metadata failure silently returns; blob failure is caught without a failed-save UI. Library descriptions unconditionally say saved. Several corrupt-JSON loaders return empty/default state. Annotation saves already have an error status and should be preserved as a positive pattern.

**Impact:** A user reasonably believes work was saved and later loses it.

**Closure:** One explicit saved/pending/failed contract, no successful journal confirmation before durable commit; failed writes preserve the pending work and previous version, offer retry/export, and remain visible. Corrupt data must be quarantined/recoverable, not overwritten by an empty default. Verify quota, disabled IndexedDB/localStorage, malformed JSON, version mismatch and reload. Do not require cloud sync to solve this.

**Dependencies:** B01 storage commit contract. Owner: same storage/session lane; shared App/Library UI seams through integrator only.

### B10 — Piano recognition qualification and product delivery (RESEARCH-BLOCKED)

**Evidence:** Official product has browser-local `runPdfOmrClient`/`runPdfOmrPipeline`, not a Piano Vision service/model. It uses heuristic reconstruction, aggregate acceptance and legacy confidence fallback. The current separately verified research dataset has not supplied a product qualification/release artifact to this baseline. Historical `OMR_V3_PRODUCTION_QUALIFICATION_REPORT.md` explicitly blocks an independent replacement; it cannot certify the current science.

**Impact:** The promised Piano PDF/clear-scan/photo-as-PDF capability cannot be signed off as faithful on the committed V1 boundary merely from a successful demonstration or structurally plausible output.

**Closure:** Research delivers independently verified source truth, frozen held-out evaluation, an explicit supported/unsupported notation matrix, calibrated reject/warn results and a versioned candidate. Product integration preserves source IDs/score ownership, converts to the canonical performed score, rejects unsafe inputs visibly, and passes score/audio/practice tests. Do not change truth, loosen thresholds, or expand notation scope to manufacture completion. No requirement for perfect recognition of every possible piano score.

**Dependencies:** Existing Piano science; independent product quality contract can start now. Owners: existing Piano research plus later isolated recognition integration.

### B11 — Guitar completeness beyond fret recognition (RESEARCH-BLOCKED)

**Evidence:** Product `detectTabNotation` emits `tab-approximate-even` timing. Text warnings cover only selected unsupported markers. Learned raw-ROI inference exists on `codex/guitar-vision` as Python code, with no caller in the official product app/worker. Technique metadata alone does not implement corresponding timing/audio/practice semantics.

**Impact:** High fret-digit accuracy can coexist with wrong strings, durations, voices, ties, tuning, repeats, source attachment and scored targets.

**Closure:** Qualify the existing promised Guitar families through detection → attachment → musical timing → pitch/tuning → source map → playback/cursor/practice. Unsupported families need explicit honest rejection or restricted use; do not silently advertise approximate TAB rhythm as faithful. Integrate a narrowly versioned research artifact/adapter, not the whole divergent branch. Validate fret inference independently from total score correctness.

**Dependencies:** Existing Guitar research; B12 contract; B06 timing integration. Owners: existing Guitar research and isolated product adapter worktree. Advanced families that were never committed do not become new V1 features merely because the research taxonomy lists them.

### B14 — iOS/Android deliverable absent (MISSING; release work)

**Evidence:** Tracked product tree/package dependencies contain no iOS/Android projects, native bridge, signing/package configuration, permission declarations or store build workflow. Responsive Vite app and web manifest exist.

**Impact:** There is no native/store artifact to release or device-qualify.

**Closure:** Select the minimal delivery approach that preserves the existing web product; generate reproducible development/release builds for both platforms, wire permission/file/audio lifecycle boundaries, and establish package identities/signing/release checks. Credentials/listing/submission are a later explicit release step; this audit does not perform them. Physical verification B15 is required before release.

**Dependencies:** Native shell can start independently; final builds depend on all P0/P1 feature closures. Owner: native/release lane.

## P1 — Must fix before public launch

### B03 — Play Along input windows, attempts and result preservation (BROKEN)

**Evidence:** `usePracticeSession` live MIDI callback uses `useWaitForYouMidiInput`, bypassing the bounded `evaluatePlayAlongNoteInput`; R3 accepted the 1.0 s C4 around 0.56 s. `playAlongInputActive` includes `playback.isPlaying`; `usePlayAlongLaneFeedback` clears state when inactive. R3 pause cleared outcomes and backward seek retained previous misses. Callbacks do not record Play Along stats.

**Closure:** One target/window policy for MIDI and mic based on authoritative score time, with calibrated latency treatment; consistent chord/extra-note/early/late behavior. Introduce attempt/pass IDs, define seek/loop/restart boundaries, preserve results through pause/completion, and emit durable events to the session ledger. Test rapid/repeated notes, chords, rests, tempo changes and seeks at note boundaries with injected input and real capture. Results must not be rewritten by late callbacks from the prior attempt.

**Dependencies:** B06 clock/identity contract; B08 durable event consumer. Owner: practice engine.

### B04 — WFY restored-first-match lifecycle (PARTIAL system; broken initialization)

**Evidence:** R4 initializes real `usePracticeSession` with saved WFY mode before timing parse. First accepted C4 increments correct count but remains at checkpoint/time 0; second attack advances. R3 enters WFY after loading and passes the sequence. Related initialization/checkpoint effects are in `useWaitForYou` and initial position restoration in `usePracticeSession`.

**Closure:** Add focused hook and full-app restored-session tests; first correct input advances exactly once regardless of async parse/restore ordering, StrictMode, pause or mode re-entry. Correct-count emission must correspond to a committed advancement. Verify seek/restart/end and disabled-loop state. Do not weaken correct-note tests to allow an extra required attack.

**Dependencies:** B06 lifecycle identity. Owner: practice engine. Root cause is not fully isolated by this audit; the reproducible behavior is.

### B05 — Physical input/audio qualification (PARTIAL)

**Evidence:** Deterministic pitch/polyphony tests pass. R6 fake-browser capture did not advance C4 and was not localized; no physical microphone/MIDI/mobile latency test was performed. Permission/reconnect code exists. MIDI sustain state is observed; note-on matching is not pedal grading.

**Closure:** Reproduce with capture telemetry to distinguish silence/calibration/device routing from recognition; fix actual defects found. Verify piano/guitar single notes, simultaneous/rolled chords within the promised policy, repeats, tied sustain, wrong/extra notes, room noise, acoustic playback bleed, denial/retry/unplug and routing interruptions on supported desktop/iOS/Android inputs. Measure input→acceptance and audio→cursor latency distributions and choose explicit acceptance limits. Avoid claiming full pedal/duration grading if V1 only checks attacks; disclose that boundary.

**Dependencies:** B03/B04, native shell for mobile. Owner: practice engine with native device lane; no changes to Piano/Guitar OMR science.

### B06 — Timing/loop/source fidelity contract (PARTIAL)

**Evidence:** Canonical performed timeline exists, but engine clock vs React practice time, geometry interpolation, render-group mapping and React-driven loops are separate. WFY receives loop.region even when disabled. MIDI expression is separately mapped; XML pedal directions are not parsed. R3 shows actual grading divergence. Audio schedules 2.5 s ahead; loop reaction happens in `useLoopPlayback`.

**Closure:** Declare authoritative score time, performed occurrence/event ID and attempt ID for audio, cursor, targets, loops and stats. Bound loop scheduling at the audio layer, specify sustained notes at seek/loop edges, and honor disabled loop state consistently. Test repeats/endings, tempo changes, multi-voice chords/ties, rests and PDF/XML mismatch. Existing advertised notation that cannot be executed must be identified and gated, rather than silently omitted. Do not delete functioning geometry fallbacks; identify them as approximate.

**Dependencies:** Correct XML available now; final arbitrary-PDF fidelity depends on B10/B11. Owner: practice engine first; visual owner consumes the frozen contract later.

### B07 — Visual mode end-to-end acceptance (PARTIAL)

**Evidence:** Staff/playhead/chords/keyboard/fretboard/toggle and source-aware notation are implemented and visually inspected. It shares B03–B06 defects; source groups/render groups are reconciled by onset/pitch. No complete physical/mobile/source-notation qualification.

**Closure:** Preserve current Note guide. Test both practice modes, target and outcome highlighting, chords/rests/ties, repeated passages, tempo/seek/loop/pause/completion, and Score↔Note guide transitions against canonical IDs/time. Verify dense/source-notation fidelity and phone layout. No rough replacement prototype is an acceptable closure.

**Dependencies:** B03/B04/B06; recognition gates for PDF-generated content. Owner: separate visual/score lane after engine contract stabilizes.

### B08 — Durable session ledger and honest history totals (BROKEN)

**Evidence:** R7 active auto elapsed time disappears on reload. `usePracticeStatsTracker` flushes on cleanup; auto state is module memory. `saveManualSession` slices to `MAX_RECENT_SESSIONS=20`; schema recomputes headline totals from the slice. R8: 21 sessions → 20 headline sessions/1200 s, but piece aggregate 21/1260 s. Manual title-slug and auto fingerprint IDs do not join reliably. Play Along is not recorded; manual timer draft is ephemeral.

**Closure:** Durably checkpoint active segments and completed attempts; retain the underlying ledger/lifetime aggregates independently of a bounded display list. One stable score identity across automatic and manual history, with migration preserving old data. Define time-with-score vs played time truthfully (current idle timer is disclosed, not itself deception). Test reload/crash, title changes/collisions, 21+ entries, multiple instruments, mode transitions and per-score history. Do not fabricate correctness from a visited measure.

**Dependencies:** B01/B02; consumes B03/B06 events. Owner: storage/session lane.

### B09 — Promised comfortable tempo / clean runs / trouble spots (MISSING)

**Evidence:** Source search finds no such persisted/computed metrics; `PracticeStatsCard` has elapsed time, measures visited, loops and last tempo; Home has only instructional “comfortable tempo” copy.

**Closure:** Define these three metrics in terms of actual completed attempt events, tempo and per-measure mistakes/timing. Persist and display them per score; explicitly represent “not enough evidence” rather than guessed values. Verify that seek/skips/manual continue/paused time cannot create a clean run or comfortable tempo. This is completion of the requested V1 promise, not a new gamification program.

**Dependencies:** B03/B06/B08. Owner: storage/session lane after the event contract lands.

### B12 — Unsupported/uncertain recognition must fail honestly (PARTIAL)

**Evidence:** `assessOmrAcceptance` receives aggregate structural counts/confidence, not a notation-family coverage inventory. Low-confidence/partial-page/default-tempo/TAB warnings exist; XML navigation warning exists; many omitted techniques/pedal/fallbacks do not have a complete user-visible contract. A parser silently ignoring notation cannot report its omission through aggregate confidence alone.

**Closure:** Supported-family contract at import/recognition boundary; carry provenance/uncertainty and reason codes into readiness. Refuse reliable-transcription claims when required semantics are unknown; keep the original PDF available and offer matching XML or retry. Qualify clean/blurred/rotated/scanned/unsupported inputs and confirm no ready-success route bypasses rejection. Work can begin with fixtures and current rules before either model is done. Do not demand implementation of every advanced family listed by research if V1 did not promise it; an honest restricted boundary is acceptable.

**Dependencies:** Independent UI/contract work now; final validation with B10/B11 outputs. Owner: import/quality lane; no research modifications.

### B13 — Deployment/offline/resource and playback qualification (PARTIAL)

**Evidence:** Static endpoint works; `/api/health` is HTML fallback. Guitar samples are third-party; no service worker. OMR worker timeouts/retries exist, but no durable checkpoint; MXL expanded size is not bounded. Dense Node performance is good, but not mobile memory/long-audio proof. XML-only pedal fidelity is missing.

**Closure:** Define and test cold/warm/no-network behavior, sample failure/fallback and user messages, resource ceilings for compressed/large imports, timeout/retry/cancel with retained sources, and long-score foreground/resume stability. Add useful build/version/static health checks and crash/error observability appropriate to local processing. If a server model is introduced, separately require auth where needed, secrets isolation, upload/queue limits, status/resume, cancellation, retries, rate limits and health/metrics; do not implement that backend gratuitously now.

**Dependencies:** B01/B02; engine/native collaboration for physical output; future research service only if selected. Owner: import/quality for resource guards; native/release for distribution/health/offline qualification, disjoint files.

### B15 — Real-device native product acceptance (PARTIAL; release qualification)

**Evidence:** Responsive Chromium tests and browser support/lifecycle helpers pass/exist; no device binaries or physical qualification. No native memory/background evidence.

**Closure:** Device matrix covering at least supported iOS phone/tablet and Android configurations: mic permissions/denial/recovery, MIDI where actually supported, native file picker, orientation, keyboard/focus, touch targets, audio interruptions/Bluetooth, background/foreground/lock, reload and large scores under memory pressure. Package/listing/privacy disclosures must describe actual processing and analytics, not hypothetical future services.

**Dependencies:** B14, all feature fixes before final RC. Owner: native/release.

### B16 — Nonvisual practice and assistive-technology acceptance (PARTIAL)

**Evidence:** Zero axe violations in verified shell/control scans; keyboard traps/route focus/reduced motion work. `StaffVisualLane` hides graphical notation from AT and exposes textual target UI, but VoiceOver/TalkBack musical target/feedback/transport tasks were not exercised.

**Closure:** Preserve existing validated shell; verify and fix real screen-reader/keyboard/touch workflows for starting/stopping, selecting input, hearing expected chord/error/recovery status, navigating/looping, and switching views without lost focus. Correctness must not depend solely on color. Do not reinterpret “zero automated violations” as full score accessibility or demand a new full notation screen-reader product outside V1.

**Dependencies:** B03–B07 and native shell. Owner: visual/score lane for semantics, native lane for device validation; no overlapping files.

## P2 — Desirable follow-up; not cosmetic P0s

- Reconcile the seven documented stale/design assertions with the accepted musician UI, retaining meaningful contrast/layout checks. Current runtime axe is clean; investigate token tests rather than deleting them wholesale.
- Triage existing 223 lint errors/33 warnings by actionable product risk; do not block all release work on unrelated research/script style debt. A new meaningful failing behavioral test remains P1/P0 as appropriate.
- Reduce the ~1.29 MB main JS chunk and improve import/performance diagnostics after measured device budgets are met. Exceeding an arbitrary bundle warning is not independently P0.
- Further score-spacing/visual polish and additional diagnostic dashboards after the promised practice behavior is correct. No decorative redesign prerequisite.

## POST-V1 — Do not add to the blocker list

Audio → Sheet Music; Live Transcribe; additional instruments not committed to V1; new social features or gamification. Cloud sync/accounts, standalone XML engraving, expanded multi-score storage and direct camera import are not inferred as promises from this baseline. They are optional future scope unless separately committed by the product owner; existing photo-as-PDF quality remains in scope.

## Release rule

Every P0 and P1 needs an evidence-linked acceptance result on the integrated official product baseline. A high standalone research metric, a passing button smoke test, a browser-width screenshot, or a “saved” label is insufficient. No merge or release was authorized/performed by this audit.
