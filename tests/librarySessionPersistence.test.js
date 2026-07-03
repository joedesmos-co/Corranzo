import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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
