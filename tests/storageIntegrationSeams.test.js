/**
 * Integration-seam validation (I7): product-facing behavior on the integrated
 * tree, beyond isolated storage unit tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

function installFakeLocalStorage() {
  const store = new Map()
  const storage = {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      if (storage.__quotaError) {
        throw new Error('QuotaExceededError')
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

function installFakeIndexedDB() {
  const globalStore = new Map()
  const state = { failOnKey: null }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      __store: globalStore,
      __state: state,
      open() {
        const request = {}
        setTimeout(() => {
          const db = {
            objectStoreNames: { contains: () => true },
            close: () => {},
            transaction(_name, mode) {
              const buffered = []
              const tx = {
                error: null,
                objectStore: () => ({
                  put: (value, key) => {
                    const req = {}
                    if (state.failOnKey && String(key).includes(String(state.failOnKey))) {
                      setTimeout(() => {
                        tx.error = new Error('QuotaExceededError')
                        req.onerror?.()
                        tx.onerror?.()
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
                    if (mode !== 'readonly') {
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
                }),
                abort: () => {},
                oncomplete: null,
                onerror: null,
                onabort: null,
              }
              setTimeout(() => {
                if (tx.error) {
                  tx.onabort?.()
                  tx.onerror?.()
                  return
                }
                for (const op of buffered) {
                  if (op.type === 'put') globalStore.set(op.key, op.value)
                  else if (op.type === 'delete') globalStore.delete(op.key)
                  else if (op.type === 'clear') globalStore.clear()
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
    },
  })
  return globalThis.indexedDB
}

beforeEach(() => {
  vi.restoreAllMocks()
  installFakeLocalStorage()
  installFakeIndexedDB()
})

describe('I7 product seams', () => {
  it('1. normal save persists and reloads', async () => {
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    const result = trySaveManualSession({ pieceTitle: 'Normal', durationSeconds: 60 })
    expect(result.ok).toBe(true)
    expect(loadStats().totalSessions).toBe(1)
  })

  it('2. quota failure at product seam preserves last-good, no false success', async () => {
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    trySaveManualSession({ pieceTitle: 'Good', durationSeconds: 60 })
    localStorage.__quotaError = true
    const failed = trySaveManualSession({ pieceTitle: 'Bad', durationSeconds: 60 })
    expect(failed.ok).toBe(false)
    localStorage.__quotaError = false
    expect(loadStats().totalSessions).toBe(1)
  })

  it('3/4. corrupt metadata recovers last-good at product load', async () => {
    const { saveSessionMeta, loadSessionMeta } = await import(
      '../src/features/session/sessionPersistence.js'
    )
    saveSessionMeta({ pdfMeta: { fileName: 'v1.pdf', size: 1 } })
    saveSessionMeta({ pdfMeta: { fileName: 'v2.pdf', size: 2 } })
    localStorage.setItem('scoreflow-session-meta-v1', '{corrupt')
    const loaded = loadSessionMeta()
    expect(loaded?.recoveredFromBackup).toBe(true)
    expect(loaded?.meta?.pdfMeta?.fileName).toBe('v1.pdf')
  })

  it('5. active-session reload resumes checkpoint', async () => {
    const tracker = await import('../src/features/profile/autoPracticeTracker.js')
    tracker.__resetAutoPracticeSession()
    tracker.beginAutoPracticeSession({ id: 'piece:active', title: 'Active' })
    tracker.recordAutoPracticeMeasure(1)
    tracker.__resetAutoPracticeSession()
    const resumed = tracker.beginAutoPracticeSession({ id: 'piece:active', title: 'Active' })
    expect(resumed).not.toBeNull()
    expect(resumed.measuresPlayed).toBe(1)
  })

  it('6. manual-session reload restores draft', async () => {
    const timer = await import('../src/features/profile/manualPracticeTimer.js')
    const state = timer.startManualTimer(timer.createManualTimerState(), 1000)
    timer.saveManualDraft({ timerState: state, pieceTitle: 'Draft', pendingSave: null })
    const restored = timer.loadManualDraft()
    expect(restored.pieceTitle).toBe('Draft')
    expect(restored.timerState.status).toBe('running')
  })

  it('7. 20→21 boundary stays honest on integrated tree', async () => {
    const { saveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    let stats
    for (let i = 0; i < 21; i++) {
      stats = saveManualSession({ pieceTitle: 'Same piece', durationSeconds: 60, endedAt: 5000 + i })
    }
    expect(stats.totalSessions).toBe(21)
    expect(stats.totalPracticeSeconds).toBe(1260)
    expect(stats.recentSessions.length).toBe(20)
  })

  it('8. offline: persistence source uses no network', async () => {
    for (const file of [
      './src/features/session/sessionPersistence.js',
      './src/features/profile/profileStorage.js',
      './src/features/profile/manualPracticeLog.js',
      './src/features/profile/autoPracticeTracker.js',
    ]) {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/fetch\s*\(/)
    }
  })

  it('9. score save followed by app reload validates', async () => {
    const {
      saveSessionMeta,
      saveSessionFiles,
      loadSessionMeta,
      loadSessionFiles,
      validateRestoredSession,
    } = await import('../src/features/session/sessionPersistence.js')
    expect(saveSessionMeta({ pdfMeta: { fileName: 'reload.pdf', size: 8 } })).toBe(true)
    await saveSessionFiles({ pdf: { data: new ArrayBuffer(8) } })
    // Simulate app reload: fresh loads from persisted stores.
    const loaded = loadSessionMeta()
    const files = await loadSessionFiles()
    const result = validateRestoredSession(loaded.meta, files)
    expect(result.ok).toBe(true)
    expect(result.pdfMeta.fileName).toBe('reload.pdf')
  })

  it('library seam: failed saveStatus shows honest copy, success keeps saved copy', async () => {
    const { buildUploadedPracticePieces } = await import('../src/features/library/practiceLibrary.js')
    const bundles = {
      piano: { pdfMeta: { fileName: 'Etude.pdf' }, musicXmlSource: { data: new ArrayBuffer(4) } },
    }
    const failed = buildUploadedPracticePieces(bundles, { activeInstrumentId: 'piano', saveStatus: 'failed' })
    expect(failed[0].teaches).toMatch(/couldn’t be saved/)
    expect(failed[0].subtitle).toBe('Save needed')
    const ok = buildUploadedPracticePieces(bundles, { activeInstrumentId: 'piano' })
    expect(ok[0].teaches).toBe('Your score is saved on this device.')
    expect(ok[0].subtitle).toBe('Saved score')
  })

  it('manual pieceId seam: explicit current score id joins auto record', async () => {
    const { beginAutoPracticeSession, endAutoPracticeSession } = await import(
      '../src/features/profile/autoPracticeTracker.js'
    )
    const { trySaveManualSession } = await import('../src/features/profile/manualPracticeLog.js')
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    const { resolvePracticePieceId } = await import('../src/features/profile/autoPracticeTracker.js')
    // Same computation App.jsx uses for currentScorePieceId.
    const currentId = resolvePracticePieceId({
      pdfFingerprint: 'Score.pdf::10::20',
      pdfFileName: 'Score.pdf',
      musicXmlFileName: null,
    })
    beginAutoPracticeSession({ id: currentId, title: 'Score' })
    endAutoPracticeSession()
    const manual = trySaveManualSession({ pieceTitle: 'Whatever title', durationSeconds: 30, pieceId: currentId })
    expect(manual.ok).toBe(true)
    const stats = loadStats()
    expect(Object.keys(stats.pieces)).toEqual([currentId])
  })

  it('banner seam: save-failure banner offers no destructive clear', async () => {
    const src = readFileSync('./src/components/SessionRestoreBanner.jsx', 'utf8')
    expect(src).toContain("typeof onClearSaved === 'function'")
    const app = readFileSync('./src/App.jsx', 'utf8')
    expect(app).toContain('saveStatus')
    expect(app).toContain('currentScorePieceId')
    expect(app).toContain('currentPieceId')
    const profile = readFileSync('./src/components/profile/ProfileView.jsx', 'utf8')
    expect(profile).toContain('defaultPieceId')
    const manual = readFileSync('./src/components/profile/ManualPracticeLog.jsx', 'utf8')
    expect(manual).toContain('defaultPieceId')
  })
})
