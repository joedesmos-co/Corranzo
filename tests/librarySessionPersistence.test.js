import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resetPracticeTimePrefs,
} from '../src/features/session/practicePrefsStorage.js'
import { buildSessionMeta } from '../src/features/session/sessionPersistence.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function readSrc(...parts) {
  return readFileSync(join(__dir, '..', 'src', ...parts), 'utf8')
}

describe('library session persistence', () => {
  it('resetPracticeTimePrefs keeps mode settings but clears scrub position', () => {
    const reset = resetPracticeTimePrefs({
      practiceMode: 'wait-for-you',
      practiceTime: 42,
      loop: { enabled: true },
    })
    expect(reset.practiceTime).toBe(0)
    expect(reset.practiceMode).toBe('wait-for-you')
    expect(reset.loop.enabled).toBe(true)
  })

  it('session meta reads the latest practice prefs snapshot from a ref', () => {
    const ref = { current: { practiceTime: 12, practiceMode: 'normal' } }
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'score.pdf', size: 10 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'library',
      pageNumber: 2,
      practicePrefs: ref.current,
      instrumentId: 'guitar',
    })
    expect(meta.practicePrefs.practiceTime).toBe(12)
    ref.current = { practiceTime: 99, practiceMode: 'wait-for-you' }
    const nextMeta = buildSessionMeta({
      pdfMeta: meta.pdfMeta,
      midiSource: null,
      musicXmlSource: null,
      activeView: 'practice',
      pageNumber: 2,
      practicePrefs: ref.current,
      instrumentId: 'guitar',
    })
    expect(nextMeta.practicePrefs.practiceTime).toBe(99)
  })

  it('useSessionPersistence saves practice prefs via ref instead of a stale render snapshot', () => {
    const hook = readSrc('hooks', 'useSessionPersistence.js')
    expect(hook).toContain('practicePrefsRef?.current ?? null')
    expect(hook).not.toMatch(/practicePrefs,\n/)
  })

  it('every mountedRef re-arms to true on effect setup (StrictMode stuck-restore regression)', () => {
    // StrictMode dev runs setup→cleanup→setup on the same fiber. A hook whose
    // effect only sets mountedRef.current = false in cleanup leaves the ref
    // false on the second setup, so async continuations bail forever. In
    // useSessionPersistence this froze the "Restoring your last session"
    // overlay permanently; in useWebMidiInput it muted all MIDI input.
    const srcRoot = join(__dir, '..', 'src')
    const files = readdirSync(srcRoot, { recursive: true })
      .filter((name) => /\.(js|jsx)$/.test(name))
      .map((name) => join(srcRoot, name))
    const offenders = []
    let checked = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('mountedRef.current = false')) {
        continue
      }
      checked += 1
      if (!text.includes('mountedRef.current = true')) {
        offenders.push(file.slice(srcRoot.length + 1))
      }
    }
    // Guard the guard: the scan must actually find the known hooks.
    expect(checked).toBeGreaterThanOrEqual(6)
    expect(offenders).toEqual([])
  })

  it('new PDF and timing imports reset practice time in App', () => {
    const app = readSrc('App.jsx')
    expect(app).toContain('resetPracticePrefsForNewScore')
    expect(app).toMatch(/handleFileSelect[\s\S]*resetPracticePrefsForNewScore\(\)/)
    expect(app).toMatch(/handleMusicXmlSelect[\s\S]*source: 'upload'/)
    expect(app).toMatch(/practicePrefsRef\.current = payload\.practicePrefs/)
  })

  it('persists instrument selection in session meta', () => {
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'score.pdf', size: 1 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'library',
      pageNumber: 1,
      practicePrefs: { practiceTime: 0 },
      instrumentId: 'guitar',
    })
    expect(meta.instrumentId).toBe('guitar')
  })
})
