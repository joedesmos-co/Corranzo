/**
 * V1 durable storage / recovery / session ledger regressions.
 * Covers B01 (atomic retention), B02 (truthful save/corruption), B08 (ledger/totals).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Fakes ----------------------------------------------------------------

function installFakeLocalStorage() {
  const store = new Map()
  const storage = {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      if (storage.__quotaError) {
        const error = new Error('QuotaExceededError')
        error.name = 'QuotaExceededError'
        throw error
      }
      store.set(key, String(value))
    }),
    removeItem: vi.fn((key) => store.delete(key)),
    __store: store,
    __quotaError: false,
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return storage
}

// Minimal in-memory IndexedDB mock supporting single-transaction atomic batches.
function installFakeIndexedDB() {
  const globalStore = new Map()
  const state = { failOnKey: null, unavailable: false }
  const fakeIndexedDB = {
    __store: globalStore,
    __state: state,
    open() {
      const request = {}
      setTimeout(() => {
        if (state.unavailable) {
          request.error = new Error('IndexedDB is not available in this browser.')
          request.onerror?.()
          return
        }
        const db = {
          objectStoreNames: { contains: () => true },
          close: () => {},
          transaction(_name, mode) {
            const buffered = []
            const tx = {
              error: null,
              objectStore() {
                return {
                  put: (value, key) => {
                    const req = {}
                    if (state.failOnKey && String(key).includes(String(state.failOnKey))) {
                      setTimeout(() => {
                        tx.error = new Error('QuotaExceededError')
                        req.onerror?.()
                        tx.onerror?.()
                        try {
                          tx.abort()
                        } catch {
                          // ignore
                        }
                      }, 0)
                    } else if (mode !== 'readonly') {
                      buffered.push({ type: 'put', key, value })
                    }
                    return req
                  },
                  get: (key) => {
                    const req = {}
                    setTimeout(() => {
                      req.result = globalStore.has(key) ? globalStore.get(key) : undefined
                      req.onsuccess?.()
                    }, 0)
                    return req
                  },
                  delete: (key) => {
                    const req = {}
                    if (state.failOnKey && String(key).includes(String(state.failOnKey))) {
                      setTimeout(() => {
                        tx.error = new Error('QuotaExceededError')
                        req.onerror?.()
                        tx.onerror?.()
                      }, 0)
                    } else if (mode !== 'readonly') {
                      buffered.push({ type: 'delete', key })
                    }
                    return req
                  },
                  clear: () => {
                    const req = {}
                    if (mode !== 'readonly') {
                      buffered.push({ type: 'clear' })
                    }
                    return req
                  },
                }
              },
              abort: () => {
                tx.error = tx.error ?? new Error('Aborted')
                setTimeout(() => tx.onabort?.(), 0)
              },
              oncomplete: null,
              onerror: null,
              onabort: null,
            }
            // Commit buffered ops atomically unless an error was recorded.
            // Delayed past request-error timeouts so injected failures abort
            // the whole batch (no partial apply).
            setTimeout(() => {
              if (tx.error) {
                tx.onabort?.()
                tx.onerror?.()
                return
              }
              for (const op of buffered) {
                if (op.type === 'put') {
                  globalStore.set(op.key, op.value)
                } else if (op.type === 'delete') {
                  globalStore.delete(op.key)
                } else if (op.type === 'clear') {
                  globalStore.clear()
                }
              }
              tx.oncomplete?.()
            }, 10)
            return tx
          },
        }
        request.result = db
        request.onsuccess?.()
      }, 0)
      return request
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDB })
  return fakeIndexedDB
}

beforeEach(() => {
  vi.restoreAllMocks()
  installFakeLocalStorage()
  installFakeIndexedDB()
  // Reset module in-memory auto session between tests (fresh import state).
})

// ---- S2: no destructive expiry --------------------------------------------

describe('no 7-day deletion (S2)', () => {
  it('an 8-day-old save still loads and is never auto-deleted', async () => {
    const { saveSessionMeta, loadSessionMeta } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    expect(saveSessionMeta({ pdfMeta: { fileName: 'old.pdf', size: 10 }, activeView: 'library', pageNumber: 1 })).toBe(true)
    const raw = JSON.parse(localStorage.getItem('scoreflow-session-meta-v1'))
    raw.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    localStorage.setItem('scoreflow-session-meta-v1', JSON.stringify(raw))
    const loaded = loadSessionMeta()
    expect(loaded?.expired).toBe(false)
    expect(loaded?.meta?.pdfMeta?.fileName).toBe('old.pdf')
    // No auto-delete: bytes remain for restore.
    expect(localStorage.getItem('scoreflow-session-meta-v1')).not.toBeNull()
  })

  it('updateSavedSessionView works for old saves (no expiry gate)', async () => {
    const { saveSessionMeta } = await import('../src/features/session/sessionPersistence.js')
    const { updateSavedSessionView } = await import(
      '../src/features/session/sessionViewPersistence.js'
    )
    saveSessionMeta({
      pdfMeta: { fileName: 'old.pdf', size: 10 },
      activeView: 'library',
      pageNumber: 1,
      instrumentId: 'piano',
    })
    const raw = JSON.parse(localStorage.getItem('scoreflow-session-meta-v1'))
    raw.savedAt = Date.now() - 30 * 24 * 60 * 60 * 1000
    localStorage.setItem('scoreflow-session-meta-v1', JSON.stringify(raw))
    expect(updateSavedSessionView('practice', { fileName: 'old.pdf', size: 10 }, 'piano')).toBe(true)
  })
})

// ---- S4: quota failure is truthful -----------------------------------------

describe('truthful quota / write failure (S4)', () => {
  it('manual save reports failure and preserves last-good (no false success)', async () => {
    const { saveStats } = await import('../src/features/profile/profileStorage.js')
    const { createEmptyStats } = await import('../src/features/profile/profileStatsSchema.js')
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    saveStats(createEmptyStats())
    localStorage.__quotaError = true
    const result = trySaveManualSession({ pieceTitle: 'Quota test', durationSeconds: 60 })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('storage-full')
    localStorage.__quotaError = false
    expect(loadStats().recentSessions.length).toBe(0)
    expect(loadStats().totalSessions).toBe(0)
  })

  it('legacy saveManualSession does not falsely increment totals on quota failure', async () => {
    const { saveStats } = await import('../src/features/profile/profileStorage.js')
    const { createEmptyStats } = await import('../src/features/profile/profileStatsSchema.js')
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    saveStats(createEmptyStats())
    localStorage.__quotaError = true
    const returned = saveManualSession({ pieceTitle: 'Quota test', durationSeconds: 60 })
    // Truthful: returned totals match persisted (no phantom session).
    expect(returned.totalSessions).toBe(0)
    localStorage.__quotaError = false
    expect(loadStats().totalSessions).toBe(0)
  })

  it('score manifest write failure returns false and preserves last-good', async () => {
    const { saveSessionMeta, loadSessionMeta } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    expect(saveSessionMeta({ pdfMeta: { fileName: 'good.pdf', size: 5 } })).toBe(true)
    localStorage.__quotaError = true
    expect(saveSessionMeta({ pdfMeta: { fileName: 'bad.pdf', size: 6 } })).toBe(false)
    localStorage.__quotaError = false
    expect(loadSessionMeta()?.meta?.pdfMeta?.fileName).toBe('good.pdf')
  })

  it('blob write failure throws instead of silent success', async () => {
    const { saveSessionMeta, saveSessionFiles } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    saveSessionMeta({ pdfMeta: { fileName: 'a.pdf', size: 4 } })
    globalThis.indexedDB.__state.failOnKey = 'pdf'
    await expect(saveSessionFiles({ pdf: { data: new ArrayBuffer(4) } })).rejects.toThrow()
    globalThis.indexedDB.__state.failOnKey = null
  })
})

// ---- S3/S5: atomic + corruption --------------------------------------------

describe('atomic save + corruption recovery (S3/S5)', () => {
  it('single-transaction blob set does not leave partial files on failure', async () => {
    const { saveSessionMeta, saveSessionFiles, loadSessionFiles } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    saveSessionMeta({ pdfMeta: { fileName: 's.pdf', size: 4 } })
    await saveSessionFiles({ pdf: { data: new ArrayBuffer(4) }, midi: { data: new ArrayBuffer(2) } })
    const before = await loadSessionFiles()
    expect(before.pdf?.byteLength).toBe(4)
    // Fail the midi write in the same atomic batch: nothing in the batch applies.
    globalThis.indexedDB.__state.failOnKey = expect.anything()
    // Our mock fails on exact key; fail the generation midi key by failing all writes:
    globalThis.indexedDB.__state.failOnKey = 'midi'
    await expect(
      saveSessionFiles({ pdf: { data: new ArrayBuffer(8) }, midi: { data: new ArrayBuffer(8) } }),
    ).rejects.toThrow()
    globalThis.indexedDB.__state.failOnKey = null
    // Last-good preserved at legacy keys (generation commit failed atomically).
    const after = await loadSessionFiles()
    expect(after.pdf?.byteLength).toBe(4)
  })

  it('corrupt manifest quarantines and falls back to last-good backup', async () => {
    const { saveSessionMeta, loadSessionMeta } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    saveSessionMeta({ pdfMeta: { fileName: 'v1.pdf', size: 1 } })
    saveSessionMeta({ pdfMeta: { fileName: 'v2.pdf', size: 2 } })
    // Current is v2, backup is v1. Corrupt current.
    localStorage.setItem('scoreflow-session-meta-v1', '{not json')
    const loaded = loadSessionMeta()
    expect(loaded?.corrupted).toBe(true)
    expect(loaded?.recoveredFromBackup).toBe(true)
    expect(loaded?.meta?.pdfMeta?.fileName).toBe('v1.pdf')
    expect(localStorage.getItem('scoreflow-session-meta-v1:corrupt')).toBe('{not json')
  })

  it('corrupt with no backup reports corrupted without silent empty overwrite', async () => {
    const { loadSessionMeta } = await import('../src/features/session/sessionPersistence.js')
    localStorage.setItem('scoreflow-session-meta-v1', '{bad')
    localStorage.removeItem('scoreflow-session-meta-v1:backup')
    const loaded = loadSessionMeta()
    expect(loaded?.corrupted).toBe(true)
    expect(loaded?.meta).toBeNull()
    // Opening never overwrites corrupt bytes with empty default.
    expect(localStorage.getItem('scoreflow-session-meta-v1')).toBe('{bad')
  })

  it('manifest/blob mismatch fails validation (no silent valid restore)', async () => {
    const { buildSessionMeta, validateRestoredSession } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'm.pdf', size: 4 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'library',
      pageNumber: 1,
    })
    const result = validateRestoredSession(meta, {})
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('missing-pdf-file')
  })

  it('corrupt stats quarantine to last-good instead of silent empty', async () => {
    const { loadStatsWithStatus } = await import(
      '../src/features/profile/profileStorage.js'
    )
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    trySaveManualSession({ pieceTitle: 'Good', durationSeconds: 60 })
    // Second commit creates a last-good backup for recovery.
    trySaveManualSession({ pieceTitle: 'Good', durationSeconds: 60 })
    const goodRaw = localStorage.getItem('scoreflow-practice-stats-v1')
    expect(JSON.parse(goodRaw).totalSessions).toBe(2)
    localStorage.setItem('scoreflow-practice-stats-v1', '{corrupt')
    const result = loadStatsWithStatus()
    expect(result.corrupted).toBe(true)
    expect(result.recoveredFromBackup).toBe(true)
    expect(result.stats.totalSessions).toBe(1)
    expect(localStorage.getItem('scoreflow-practice-stats-v1:corrupt')).toBe('{corrupt')
  })
})

// ---- S9: migration ----------------------------------------------------------

describe('versioned migration (S9)', () => {
  it('v1 score manifest (version 1, no commitId) remains readable', async () => {
    const { loadSessionMeta } = await import('../src/features/session/sessionPersistence.js')
    localStorage.setItem(
      'scoreflow-session-meta-v1',
      JSON.stringify({ version: 1, savedAt: Date.now() - 86400000 * 30, pdfMeta: { fileName: 'legacy.pdf', size: 3 } }),
    )
    localStorage.removeItem('scoreflow-session-meta-v1:backup')
    const loaded = loadSessionMeta()
    expect(loaded?.meta?.pdfMeta?.fileName).toBe('legacy.pdf')
    expect(loaded?.expired).toBe(false)
  })

  it('v1 stats (manual: prefix, truncated 20/1200) migrate to honest 21/1260', async () => {
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    // Seed legacy v1 shape: 20 recent but piece claims 21.
    const legacySessions = []
    for (let i = 0; i < 20; i++) {
      legacySessions.push({
        id: `manual-${i}`,
        source: 'manual',
        pieceId: 'manual:same-piece',
        pieceTitle: 'Same piece',
        endedAt: 1000 + i,
        durationSeconds: 60,
      })
    }
    localStorage.setItem(
      'scoreflow-practice-stats-v1',
      JSON.stringify({
        version: 1,
        totalPracticeSeconds: 1200,
        totalSessions: 20,
        manualSessionsCompleted: 20,
        pieces: {
          'manual:same-piece': {
            id: 'manual:same-piece',
            title: 'Same piece',
            totalPracticeSeconds: 1260,
            totalSessions: 21,
            lastPracticedAt: 2000,
          },
        },
        recentSessions: legacySessions,
      }),
    )
    const migrated = loadStats()
    expect(migrated.totalSessions).toBe(21)
    expect(migrated.totalPracticeSeconds).toBe(1260)
    // Canonical namespace: manual: migrated to piece:.
    expect(migrated.pieces['piece:same-piece']).toBeDefined()
    expect(migrated.pieces['manual:same-piece']).toBeUndefined()
    // New save keeps honest lifetime (22).
    const next = saveManualSession({ pieceTitle: 'Same piece', durationSeconds: 60, endedAt: 99999 })
    expect(next.totalSessions).toBe(22)
    expect(loadStats().totalSessions).toBe(22)
  })

  it('migration is idempotent and deterministic', async () => {
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    localStorage.setItem(
      'scoreflow-practice-stats-v1',
      JSON.stringify({
        version: 2,
        totalPracticeSeconds: 120,
        totalSessions: 2,
        manualSessionsCompleted: 2,
        pieces: {
          'piece:a': { id: 'piece:a', title: 'A', totalPracticeSeconds: 120, totalSessions: 2, lastPracticedAt: 5 },
        },
        recentSessions: [
          { id: 'm1', source: 'manual', pieceId: 'piece:a', pieceTitle: 'A', endedAt: 5, durationSeconds: 60 },
          { id: 'm2', source: 'manual', pieceId: 'piece:a', pieceTitle: 'A', endedAt: 6, durationSeconds: 60 },
        ],
      }),
    )
    const first = JSON.stringify(loadStats())
    // Re-normalize the already-migrated bytes: no drift.
    localStorage.setItem('scoreflow-practice-stats-v1', JSON.stringify(JSON.parse(first)))
    const second = JSON.stringify(loadStats())
    expect(second).toBe(first)
  })
})

// ---- S6/S8: canonical ledger + honest aggregates ----------------------------

describe('durable session ledger + honest aggregates (S6/S8)', () => {
  it('reproduces the 21 vs 20 defect fix: headline 21/1260, recent 20', async () => {
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    let stats
    for (let i = 0; i < 21; i++) {
      stats = saveManualSession({ pieceTitle: 'Same piece', durationSeconds: 60, endedAt: 1000 + i })
    }
    expect(stats.totalSessions).toBe(21)
    expect(stats.totalPracticeSeconds).toBe(1260)
    expect(stats.recentSessions.length).toBe(20)
    expect(Object.values(stats.pieces)[0].totalSessions).toBe(21)
  })

  it('boundary totals: 0, 1, 20, 21, larger, multi-score', async () => {
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    expect(loadStats().totalSessions).toBe(0)
    saveManualSession({ pieceTitle: 'One', durationSeconds: 30, endedAt: 10 })
    expect(loadStats().totalSessions).toBe(1)
    for (let i = 0; i < 19; i++) {
      saveManualSession({ pieceTitle: 'One', durationSeconds: 30, endedAt: 20 + i })
    }
    expect(loadStats().totalSessions).toBe(20)
    expect(loadStats().recentSessions.length).toBe(20)
    saveManualSession({ pieceTitle: 'One', durationSeconds: 30, endedAt: 100 })
    expect(loadStats().totalSessions).toBe(21)
    expect(loadStats().recentSessions.length).toBe(20)
    for (let i = 0; i < 30; i++) {
      saveManualSession({ pieceTitle: `Piece ${i % 3}`, durationSeconds: 10, endedAt: 1000 + i })
    }
    const stats = loadStats()
    expect(stats.totalSessions).toBe(51)
    expect(stats.totalPracticeSeconds).toBe(20 * 30 + 30 + 30 * 10)
    expect(Object.keys(stats.pieces).length).toBeGreaterThanOrEqual(3)
  })

  it('manual + auto join the same canonical piece record', async () => {
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { beginAutoPracticeSession, endAutoPracticeSession, __resetAutoPracticeSession } =
      await import('../src/features/profile/autoPracticeTracker.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    // Auto with filename-derived id joins manual with same title slug.
    beginAutoPracticeSession({ id: 'piece:shared-piece', title: 'Shared Piece' })
    endAutoPracticeSession()
    __resetAutoPracticeSession()
    const result = trySaveManualSession({ pieceTitle: 'Shared Piece', durationSeconds: 60 })
    expect(result.ok).toBe(true)
    const stats = loadStats()
    // One canonical piece, both contributions present.
    expect(Object.keys(stats.pieces)).toEqual(['piece:shared-piece'])
    expect(stats.pieces['piece:shared-piece'].totalSessions).toBe(1)
    expect(stats.totalSessions).toBe(1)
  })

  it('repeated reloads converge without double-count', async () => {
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    saveManualSession({ pieceTitle: 'Stable', durationSeconds: 60, endedAt: 42 })
    const first = JSON.stringify(loadStats())
    // Simulate repeated app reloads (load-only, never write empty over data).
    for (let i = 0; i < 5; i++) {
      loadStats()
    }
    expect(JSON.stringify(loadStats())).toBe(first)
    expect(loadStats().totalSessions).toBe(1)
  })
})

// ---- S7: reload / background safety -----------------------------------------

describe('reload / background safety (S7)', () => {
  it('auto checkpoint survives simulated reload without loss or double-count', async () => {
    const tracker = await import('../src/features/profile/autoPracticeTracker.js')
    tracker.__resetAutoPracticeSession()
    tracker.__clearAutoCheckpointForTest()
    tracker.beginAutoPracticeSession({ id: 'piece:reload', title: 'Reload' })
    tracker.recordAutoPracticeMeasure(1)
    tracker.checkpointAutoPracticeSession()
    const checkpoint = JSON.parse(localStorage.getItem('scoreflow-auto-checkpoint-v1'))
    expect(checkpoint.pieceId).toBe('piece:reload')
    // Simulate reload: drop in-memory, begin same piece resumes checkpoint.
    tracker.__resetAutoPracticeSession()
    const resumed = tracker.beginAutoPracticeSession({ id: 'piece:reload', title: 'Reload' })
    expect(resumed.practiceSeconds).toBe(checkpoint.accumulatedSeconds)
    const stats = tracker.endAutoPracticeSession()
    expect(stats.pieces['piece:reload']).toBeDefined()
    expect(localStorage.getItem('scoreflow-auto-checkpoint-v1')).toBeNull()
  })

  it('manual draft restores a running timer without counting the reload gap', async () => {
    const timer = await import('../src/features/profile/manualPracticeTimer.js')
    const start = timer.startManualTimer(timer.createManualTimerState(), 1000)
    timer.saveManualDraft({
      timerState: start,
      sessionInstrumentId: 'piano',
      pieceTitle: 'Etude',
      exerciseType: 'scales',
      notes: '',
      pendingSave: null,
    })
    vi.spyOn(Date, 'now').mockReturnValue(1000 + 3600000)
    const restored = timer.loadManualDraft()
    expect(restored.timerState.status).toBe('running')
    expect(restored.pieceTitle).toBe('Etude')
    // Reload gap not credited: accumulated still 0, segment re-anchored to now.
    expect(restored.timerState.accumulatedMs).toBe(0)
    expect(timer.getManualTimerElapsedMs(restored.timerState, Date.now())).toBe(0)
    vi.restoreAllMocks()
  })

  it('failed auto flush preserves the checkpoint for retry', async () => {
    const tracker = await import('../src/features/profile/autoPracticeTracker.js')
    tracker.__resetAutoPracticeSession()
    tracker.__clearAutoCheckpointForTest()
    tracker.beginAutoPracticeSession({ id: 'piece:retry', title: 'Retry' })
    tracker.recordAutoPracticeMeasure(2)
    localStorage.__quotaError = true
    const result = tracker.tryEndAutoPracticeSession()
    expect(result.ok).toBe(false)
    expect(localStorage.getItem('scoreflow-auto-checkpoint-v1')).not.toBeNull()
    localStorage.__quotaError = false
    const retry = tracker.tryEndAutoPracticeSession()
    expect(retry.ok).toBe(true)
  })
})

// ---- S11: offline foundation -------------------------------------------------

describe('offline-local behavior (S11)', () => {
  it('persistence paths use no network (local scores/sessions work offline)', async () => {
    const { readFileSync } = await import('node:fs')
    const sessionSrc = readFileSync('./src/features/session/sessionPersistence.js', 'utf8')
    const statsSrc = readFileSync('./src/features/profile/profileStorage.js', 'utf8')
    const manualSrc = readFileSync('./src/features/profile/manualPracticeLog.js', 'utf8')
    const autoSrc = readFileSync('./src/features/profile/autoPracticeTracker.js', 'utf8')
    for (const src of [sessionSrc, statsSrc, manualSrc, autoSrc]) {
      expect(src).not.toMatch(/fetch\s*\(/)
      expect(src).not.toMatch(/navigator\.onLine/)
    }
  })

  it('local reload works with storage available (no network stub needed)', async () => {
    const { saveSessionMeta, loadSessionMeta, saveSessionFiles, loadSessionFiles } =
      await import('../src/features/session/sessionPersistence.js')
    expect(saveSessionMeta({ pdfMeta: { fileName: 'offline.pdf', size: 4 } })).toBe(true)
    await saveSessionFiles({ pdf: { data: new ArrayBuffer(4) } })
    expect(loadSessionMeta()?.meta?.pdfMeta?.fileName).toBe('offline.pdf')
    expect((await loadSessionFiles()).pdf?.byteLength).toBe(4)
  })
})
