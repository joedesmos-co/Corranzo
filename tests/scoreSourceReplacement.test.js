import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hadCompanionScoreSources,
  invalidatePreviousScoreSideEffects,
} from '../src/features/library/scoreSourceReplacement.js'
import { buildPdfFingerprint } from '../src/features/score-follow/scoreFollowStorage.js'
import { buildAutoSetupKey } from '../src/features/score-follow/scoreFollowAutoSetupStorage.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function installMemoryStorage() {
  const store = new Map()
  const api = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value))
    },
    removeItem: (key) => {
      store.delete(String(key))
    },
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', api)
  vi.stubGlobal('sessionStorage', { ...api, _store: store })
  // Separate maps so local vs session don't collide in assertions.
  const sessionStore = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => {
      sessionStore.set(String(key), String(value))
    },
    removeItem: (key) => {
      sessionStore.delete(String(key))
    },
    clear: () => sessionStore.clear(),
  })
  return api
}

describe('score source replacement helpers', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('detects prior MusicXML or MIDI companions', () => {
    expect(hadCompanionScoreSources({})).toBe(false)
    expect(
      hadCompanionScoreSources({
        musicXmlSource: { data: new ArrayBuffer(2), fileName: 'a.mxl', source: 'upload' },
      }),
    ).toBe(true)
    expect(
      hadCompanionScoreSources({
        midiSource: { data: new ArrayBuffer(2), fileName: 'a.mid' },
      }),
    ).toBe(true)
  })

  it('clears previous score-follow anchors and auto-setup flags for the old PDF', () => {
    const previousPdfMeta = { fileName: 'piece-a.pdf', size: 10, lastModified: 1 }
    const fingerprint = buildPdfFingerprint(previousPdfMeta)
    const anchorKey = `scoreflow-score-follow-v1-${fingerprint}`
    const setupKey = buildAutoSetupKey(fingerprint, 'piece-a.musicxml')
    localStorage.setItem(anchorKey, JSON.stringify({ anchors: [{ id: 'a' }] }))
    sessionStorage.setItem(setupKey, 'attempted')

    invalidatePreviousScoreSideEffects({
      previousPdfMeta,
      previousFileName: 'piece-a.pdf',
      previousMusicXmlSource: {
        fileName: 'piece-a.musicxml',
        data: new ArrayBuffer(4),
        source: 'upload',
      },
    })

    expect(localStorage.getItem(anchorKey)).toBeNull()
    expect(sessionStorage.getItem(setupKey)).toBeNull()
  })
})

describe('PDF replacement wiring', () => {
  const app = readSrc('App.jsx')
  const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')

  it('runs a full source replacement before a different PDF becomes active', () => {
    expect(app).toContain('beginPdfScoreSourceReplacement')
    expect(app).toContain('invalidatePreviousScoreSideEffects')
    expect(app).toMatch(
      /beginPdfScoreSourceReplacement[\s\S]*setMusicXmlSource\(null\)[\s\S]*setMidiSource\(null\)/,
    )
    expect(app).toMatch(
      /handleFileSelect[\s\S]*beginPdfScoreSourceReplacement\(\{[\s\S]*previousMusicXml: musicXmlSource/,
    )
    expect(app).toMatch(
      /classified\.pdf\[0\][\s\S]*beginPdfScoreSourceReplacement\(\{[\s\S]*previousMidi: loadedMidi/,
    )
  })

  it('never lets stale OMR callbacks revive Piece A MusicXML/MIDI via nullish coalescing', () => {
    expect(app).toContain('const liveMusicXmlSource = currentBundle.musicXmlSource ?? null')
    expect(app).toContain('const liveMidiSource = currentBundle.midiSource ?? null')
    expect(app).toContain('musicXmlSource: liveMusicXmlSource')
    expect(app).toContain('setMidiSource(liveMidiSource)')
    expect(app).not.toContain('currentBundle.musicXmlSource ?? musicXmlSource')
  })

  it('calls the latest onGenerated through a ref so PDF replacement cannot keep Piece A closures', () => {
    expect(omrPanel).toContain('onGeneratedRef')
    expect(omrPanel).toContain('await onGeneratedRef.current?.(')
  })

  it('documents the Piece A → Piece B replacement matrix in orchestration comments', () => {
    const replacement = readSrc('features', 'library', 'scoreSourceReplacement.js')
    expect(replacement).toContain('A new PDF must not keep the previous piece')
    expect(replacement).toContain('MusicXML/MXL, MIDI, OMR output')
  })
})
