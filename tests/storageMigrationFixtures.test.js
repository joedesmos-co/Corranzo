import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function installFakeStorage() {
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  })
}

describe('storage migration fixtures (S9)', () => {
  it('v1 manifest fixture remains readable with no expiry', async () => {
    installFakeStorage()
    const fixture = JSON.parse(
      readFileSync(join(dir, 'fixtures', 'storage-v1-manifest.json'), 'utf8'),
    )
    // Age the fixture 8 days: must still restore (no auto-delete).
    fixture.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    localStorage.setItem('scoreflow-session-meta-v1', JSON.stringify(fixture))
    const { loadSessionMeta } = await import('../src/features/session/sessionPersistence.js')
    const loaded = loadSessionMeta()
    expect(loaded?.expired).toBe(false)
    expect(loaded?.meta?.pdfMeta?.fileName).toBe('Menuet.pdf')
  })

  it('v1 stats fixture heals 20/1200 to honest 21/1260', async () => {
    installFakeStorage()
    const fixture = JSON.parse(
      readFileSync(join(dir, 'fixtures', 'storage-v1-stats.json'), 'utf8'),
    )
    localStorage.setItem('scoreflow-practice-stats-v1', JSON.stringify(fixture))
    const { loadStats } = await import('../src/features/profile/profileStorage.js')
    const migrated = loadStats()
    expect(migrated.totalSessions).toBe(21)
    expect(migrated.totalPracticeSeconds).toBe(1260)
    expect(migrated.recentSessions.length).toBe(20)
    expect(migrated.pieces['piece:same-piece'].totalSessions).toBe(21)
  })
})
