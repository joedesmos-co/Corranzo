import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSessionMeta, saveSessionMeta, SESSION_MAX_AGE_MS } from '../src/features/session/sessionPersistence.js'
import { updateSavedSessionView } from '../src/features/session/sessionViewPersistence.js'
const pdfMeta = { fileName: 'Menuet.pdf', size: 1234, lastModified: 12 }
const snapshot = { pdfMeta, instrumentId: 'piano', activeView: 'practice', musicXmlFileName: 'Notes.xml', practicePrefs: { playback: { playbackRate: .75 } }, instrumentBundles: { guitar: { pdfMeta: { fileName: 'Etude.pdf', size: 2 } } } }
beforeEach(() => { const data = new Map(); globalThis.localStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } })
afterEach(() => { delete globalThis.localStorage })
describe('immediate route persistence for a saved score', () => {
  it('retains Library on immediate reload without resetting preferences, file identities or other instruments', () => {
    saveSessionMeta(snapshot)
    expect(updateSavedSessionView('library', pdfMeta, 'piano')).toBe(true)
    expect(loadSessionMeta().meta).toMatchObject({ ...snapshot, activeView: 'library' })
  })
  it('never stamps a new file or different instrument onto the previous saved session', () => {
    saveSessionMeta(snapshot)
    for (const other of [{ ...pdfMeta, lastModified: 13 }, { ...pdfMeta, size: 7 }, { ...pdfMeta, fileName: 'New.pdf' }]) expect(updateSavedSessionView('import', other, 'piano')).toBe(false)
    expect(updateSavedSessionView('import', pdfMeta, 'guitar')).toBe(false)
    expect(loadSessionMeta().meta).toMatchObject(snapshot)
  })
  it('does not create a partial session and never expires old saves', () => {
    expect(updateSavedSessionView('home', pdfMeta, 'piano')).toBe(false)
    // Durable contract (S2): user-owned saves never auto-expire. An old save
    // remains readable and its view stays updatable; nothing is deleted.
    saveSessionMeta({ ...snapshot, savedAt: Date.now() - SESSION_MAX_AGE_MS - 1000 })
    expect(updateSavedSessionView('home', pdfMeta, 'piano')).toBe(true)
    expect(loadSessionMeta()?.meta?.pdfMeta?.fileName).toBe('Menuet.pdf')
  })
  it('handles unavailable storage without breaking navigation', () => {
    saveSessionMeta(snapshot)
    globalThis.localStorage.setItem = () => { throw Error('Quota') }
    expect(updateSavedSessionView('library', pdfMeta, 'piano')).toBe(false)
  })
})
