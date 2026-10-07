# Corranzo V1 — Durable storage / recovery / session ledger contract

Branch: `codex/corranzo-durable-storage`
Baseline: `7348b699ac` (official Corranzo product baseline)
Audit evidence: `codex/corranzo-product-completeness` @ `cc5f16907f`
(`docs/release/V1_COMPLETENESS.md`, `V1_BLOCKERS.md`, `V1_EXECUTION_PLAN.md`)

Lane ownership (S): `src/features/session/*`, `src/hooks/useSessionPersistence.js`,
`src/features/profile/*`, `src/context/ProfileStatsContext.jsx`,
`src/components/profile/*`, `src/components/practice/PracticeStatsCard.jsx`.
No edits to `src/App.jsx`, practice-engine timing files, or recognition research.
Shared seams are backward-compatible; integrator wires new status fields later.

## S1 — Persistence invariants (must all hold)

1. **Successful save means durable.** A function that reports success has
   actually persisted data that a later reload can read. No in-memory-only
   "success".
2. **Failure is surfaced as failure.** Quota, disabled storage, I/O errors,
   and validation failures return `false` / `{ ok: false }` and drive a
   visible, recoverable UI state. Never a false "saved" label.
3. **Failed updates preserve last-good.** A failed write never destroys the
   previous valid generation. Manifest backups and generation-addressed blobs
   keep the last committed score readable.
4. **Manifest and blobs never diverge.** Metadata without data, data without
   valid metadata, or a half-written generation is never presented as a valid
   save. Commit-last manifests + single-transaction blob sets + restore-time
   validation enforce this.
5. **Corrupt never becomes empty.** Malformed JSON, version mismatch, or
   failed validation quarantines the bad bytes and falls back to last-good
   where available, with an explicit `corrupted` / `failed` state. Opening the
   app never overwrites potentially recoverable data with an empty default.
6. **User data does not expire.** Saved scores, practice journal, and session
   history are USER DATA and persist until explicit removal/replacement.
   Only temporary processing artifacts (CACHE) may expire. The 7-day
   auto-delete is removed.
7. **Totals derive from a durable canonical ledger.** Headline and per-piece
   aggregates come from cumulative lifetime counters in the same persisted
   ledger, never by recomputing from a bounded display slice. Display bounds
   (`MAX_RECENT_SESSIONS = 20` for the recent list UI) never delete lifetime
   totals.
8. **Reload/background/crash is safe.** Active segments are durably
   checkpointed (not module-memory-only). Recovery never double-counts and
   never silently drops time. Repeated reloads converge.

## CACHE vs USER DATA

- USER DATA (never auto-expires): saved score manifest + PDF/MIDI/MusicXML/
  source-map blobs, practice journal sessions, lifetime aggregates, per-piece
  ledger, manual timer pending draft, auto active-segment checkpoint.
- CACHE (may expire/evict with honest fallback): parsed timing maps held in
  memory, OMR worker intermediate pages, PDF render tiles, audio sample
  caches. Eviction only causes re-preparation, never library/history loss.

## S3 — Storage architecture chosen

Keep the current browser/native-suitable stores; do not add a cloud backend.

- Scores: `localStorage` manifest (`scoreflow-session-meta-v1`, version 2)
  + `IndexedDB` blobs (`scoreflow-session` / `files`, version 1).
  Pattern: **generation-addressed commit-last with last-good fallback**.
  - Each manifest commit gets `commitId` (`c<timestamp>-<rand>`) and
    `previousCommitId`. Before overwrite, the current raw manifest is copied
    to `scoreflow-session-meta-v1:backup`. Corrupt bytes are quarantined to
    `scoreflow-session-meta-v1:corrupt` and never overwritten on open.
  - Blobs for a generation live under `gen:<commitId>:<key>` (plus legacy
    fixed keys for migration). `saveSessionFiles` writes the full blob set
    in **one IndexedDB transaction** (atomic all-or-nothing). Old-generation
    blobs are retained until the new generation validates; GC is best-effort.
  - Restore loads current manifest, then its generation blobs (falling back
    to legacy fixed keys for v1), validates manifest↔blob consistency, and on
    failure retries the backup manifest + its blobs. Validation issues are
    explicit (`missing-pdf-file`, `pdf-size-mismatch`, etc.).
  - Call sites keep their existing two-call order (meta then files) and
    automatically gain safety: the intermediate window (new manifest, old
    blobs) falls back to last-good instead of presenting a mismatch.
- Sessions/ledger: `localStorage` stats (`scoreflow-practice-stats-v1`,
  version 2) as the single durable canonical ledger.
  - Every completed session (manual + auto) is a canonical record
    `{ id, source, pieceId, pieceTitle, instrumentId, startedAt, endedAt,
    durationSeconds, exerciseType/notes | measures/loops/tempo/wfy, ... }`.
  - Lifetime counters (`totalSessions`, `totalPracticeSeconds`,
    `manualSessionsCompleted`, `autoPracticeSeconds`, per-piece
    `totalSessions`/`totalPracticeSeconds`/`autoPracticeSeconds`) are
    cumulative and stored durably. `recentSessions` remains a bounded
    display list (newest 20) but is never the source for totals.
  - Canonical piece identity: `piece:<fingerprint>` when a content
    fingerprint/filename is known (auto), otherwise `manual:<slug(title)>`
    (manual). A shared resolver + title-alias map lets manual and auto views
    join on the same work instead of parallel identities. Migration preserves
    both namespaces and repairs headline totals from per-piece sums.
  - Active auto segments checkpoint durably every tick + on visibility/
    pagehide events (not module-memory-only). Manual timer pending drafts
    persist durably. Recovery resumes from checkpoint without double-count.

## S4 — Quota / write-failure behavior

- `saveStats` / `saveSessionMeta` return boolean; `saveSessionFiles` and
  session saves return `{ ok, error }`. Callers check and propagate.
- On failure: last-good state is preserved (backup manifest, old blobs,
  previous stats JSON in `scoreflow-practice-stats-v1:backup`), pending work
  is retained (manual draft, active-segment checkpoint), and UI shows a
  recoverable status (`saveStatus: failed`, banner "couldn't save / storage
  full / retry or export"). No "Session saved" confirmation before commit.
- Tests inject `setItem` throwing `QuotaExceededError` and IDB failure to
  prove truthful failure + preservation.

## S5 — Corruption recovery

- All loaders validate (JSON parse, version, shape). `profileStatsSchema`
  version 2 validates and quarantines to
  `scoreflow-practice-stats-v1:corrupt` with last-good fallback to
  `:backup`. Session manifest does the same.
- `loadStats` / `loadSessionMeta` never return silent empty when bytes
  existed but were corrupt; they return explicit `corrupted: true` +
  `recoveredFromBackup` where possible.
- The app never writes an empty default over corrupt bytes on open. Repair
  only happens on an explicit user save/clear or a successful new commit.

## S6 — Session ledger design

Canonical session fields: `id` (stable, `manual-<endedAt>-<rand>` /
`auto-<startedAt>-<rand>`), `source` (`manual`|`auto`), `pieceId`,
`pieceTitle`, `instrumentId`, `startedAt`, `endedAt`, `durationSeconds`,
`practiceMode` where known, `exerciseType`/`notes` (manual),
`measuresVisited`/`loopsCompleted`/`tempoBpm`/`wfy*` (auto),
`completed`/`checkpoint` state for active segments.

One ledger (`recentSessions` display + lifetime counters + `pieces` map).
Manual (`saveManualSession`) and auto (`endAutoPracticeSession`) both append
to the same ledger and update the same cumulative counters. Per-piece views
and headline views read the same durable counters.

## S7 — Reload / background safety

- Auto tracker checkpoints `{ pieceId, startedAt, accumulatedSeconds,
  measures, loops, tempo, wfy }` to `scoreflow-auto-checkpoint-v1` on every
  tick and on `visibilitychange`/`pagehide`. `begin` resumes from checkpoint
  when the same piece re-opens; `end` clears only after a durable stats
  commit. Reload resumes accumulated time; repeated recovery does not
  double-add.
- Manual timer draft persists to `scoreflow-manual-draft-v1` on start/pause/
  resume/stop-form. Reload restores the draft instead of losing it.
- Timer activity during save does not create duplicate sessions: completion
  is idempotent per session `id`.

## S8 — Honest aggregates

All totals derive from cumulative ledger counters. Migration (v1→v2)
repairs legacy headline totals (which were recomputed from the 20-slice) by
summing per-piece lifetime totals. Boundary tests: 0, 1, 20, 21, larger
counts, multi-score, deleted/invalid records.

## S9 — Migration (v1→v2, idempotent, deterministic, testable)

- Scores: v1 manifests (version 1, no `commitId`, fixed blob keys) load as
  valid. First v2 save assigns `commitId`, writes generation blobs, keeps
  legacy blobs readable until GC. Fixtures in `tests/fixtures/storage-*`.
- Stats: v1 stats (headline recomputed from slice, `manual:` vs `piece:`
  split) normalize to v2 (cumulative totals repaired from pieces, title-alias
  join, checkpoint/draft keys added). Re-running migration on v2 is a no-op.
- No silent loss: unknown versions quarantine, never drop; old valid data
  remains readable.

## S10 — Storage-pressure UX (restrained, musician-led)

Reuse `SessionRestoreBanner` tones + `ManualPracticeLog` status line. Copy:
"couldn't save", "device storage is full", "saved data looks damaged",
"storage isn't available". Offer Retry / Export / Clear saved session.
No product redesign.

## S11 — Offline foundation

No network required for local scores/sessions. All persistence paths work
with `navigator.onLine === false`. No fetch in the save/restore/ledger path.
Reload offline returns the same committed score + history.
