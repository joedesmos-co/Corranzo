import { afterEach, describe, expect, it } from 'vitest'
import { normalizePracticeMode, PRACTICE_MODE, practiceInputEnabled } from '../src/features/practice/practiceMode.js'
import { normalizePlaybackPreferences } from '../src/features/playback/playbackPreferences.js'
import { workspaceStatus } from '../src/features/practice/workspaceStatus.js'
import { buildSessionMeta, loadSessionMeta, saveSessionMeta, updateSessionPracticePrefs } from '../src/features/session/sessionPersistence.js'
import { saveAnnotations, loadAnnotations } from '../src/utils/annotationStorage.js'

afterEach(() => { delete globalThis.localStorage })
describe('workspace mode and preference compatibility', () => {
  it('migrates legacy timed practice while fresh sessions open Preview', () => {
    expect(normalizePracticeMode('normal')).toBe(PRACTICE_MODE.PLAY_ALONG)
    expect(normalizePracticeMode(undefined)).toBe(PRACTICE_MODE.PREVIEW)
    expect(normalizePracticeMode('wait-for-you')).toBe(PRACTICE_MODE.WAIT_FOR_YOU)
    expect(normalizePracticeMode('broken')).toBe(PRACTICE_MODE.PREVIEW)
  })
  it('never enables player input for Preview or invalid modes', () => {
    expect(practiceInputEnabled('preview')).toBe(false)
    expect(practiceInputEnabled('normal')).toBe(false)
    expect(practiceInputEnabled('play-along')).toBe(true)
    expect(practiceInputEnabled('wait-for-you')).toBe(true)
  })
  it('restores valid playback preferences and bounds corrupt stored values', () => {
    const valid = { playbackRate: .75, metronomeEnabled: true, metronomeLevel: .4, metronomeSubdivision: 'eighth', metronomeCountIn: 2 }
    expect(normalizePlaybackPreferences(valid)).toEqual(valid)
    expect(normalizePlaybackPreferences({ playbackRate: 20, metronomeEnabled: 'yes', metronomeLevel: -10, metronomeCountIn: 999, metronomeSubdivision: 'invalid' })).toEqual({ playbackRate: 1.5, metronomeEnabled: false, metronomeLevel: 0, metronomeCountIn: 0, metronomeSubdivision: 'quarter' })
    expect(normalizePlaybackPreferences().playbackRate).toBe(1)
    expect(normalizePlaybackPreferences(null).playbackRate).toBe(1)
  })
})
describe('durable annotation storage', () => {
  it('writes the newest mark synchronously and isolates score identity', () => {
    const memory = new Map()
    globalThis.localStorage = { setItem: (key, value) => memory.set(key, value), getItem: key => memory.get(key) }
    const payload = { strokesByPage: { 1: [{ id: 'last-stroke', points: [{ x: .2, y: .4 }] }] } }
    expect(saveAnnotations('score-a', payload)).toBe(true)
    expect(loadAnnotations('score-a').strokesByPage).toEqual(payload.strokesByPage)
    expect(loadAnnotations('score-b')).toBeNull()
  })
  it('reports storage failure instead of claiming marks were saved', () => {
    globalThis.localStorage = { setItem: () => { throw new Error('Quota exceeded') } }
    expect(saveAnnotations('score-a', { strokesByPage: {} })).toBe(false)
  })
})
describe('musician-facing workspace states', () => {
  const session = { timing: {}, playback: {}, hasMusicXml: true, practiceMode: 'preview', waitForYou: {} }
  it('prioritizes a failed preparation over a ready follower', () => {
    expect(workspaceStatus({ ...session, timing: { error: 'private implementation detail' } }, { canFollow: true }).label).toBe('Playback unavailable')
  })
  it('distinguishes preparing, reading-only and available score following', () => {
    expect(workspaceStatus({ ...session, timing: { isLoading: true } }, {}).kind).toBe('preparing')
    expect(workspaceStatus({ ...session, hasMusicXml: false }, {}).label).toBe('Read & mark')
    expect(workspaceStatus(session, { enabled: true, canFollow: true }).label).toBe('Listen & follow')
  })
  it('keeps a manual fallback visible after denied microphone access', () => {
    expect(workspaceStatus({ ...session, isWaitForYou: true, wfyInputSourceReady: true, wfyInputSource: 'microphone', microphone: { permission: 'denied' } }, {}).label).toContain('use Continue')
  })
})


describe('saved session preference ownership', () => {
  it('updates current score settings without changing saved file identities or the other instrument', () => {
    const memory = new Map()
    globalThis.localStorage = { setItem: (key, value) => memory.set(key, value), getItem: key => memory.get(key) }
    const pdfMeta = { fileName: 'Menuet.pdf', size: 100, lastModified: 2 }
    const other = { pdfMeta: { fileName: 'Guitar.pdf', size: 75, lastModified: 3 }, practicePrefs: { playback: { playbackRate: 1 } } }
    const meta = buildSessionMeta({ pdfMeta, instrumentId: 'piano', practicePrefs: {}, musicXmlSource: { fileName: 'notes.xml', data: new Uint8Array(4) } })
    saveSessionMeta({ ...meta, instrumentBundles: { piano: { pdfMeta, practicePrefs: {} }, guitar: other } })
    const prefs = { playback: { playbackRate: .65, metronomeEnabled: true } }
    expect(updateSessionPracticePrefs(prefs, pdfMeta, 'piano')).toBe(true)
    const saved = loadSessionMeta().meta
    expect(saved.practicePrefs).toEqual(prefs)
    expect(saved.instrumentBundles.piano.practicePrefs).toEqual(prefs)
    expect(saved.instrumentBundles.guitar).toMatchObject(other)
    expect(saved.pdfIdentity).toBe(meta.pdfIdentity)
    expect(saved.musicXmlSize).toBe(4)
    expect(updateSessionPracticePrefs({}, { ...pdfMeta, lastModified: 4 }, 'piano')).toBe(false)
    expect(updateSessionPracticePrefs({}, pdfMeta, 'guitar')).toBe(false)
    expect(loadSessionMeta().meta.practicePrefs).toEqual(prefs)
  })
})
