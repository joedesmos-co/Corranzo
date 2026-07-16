/**
 * Sprint 3 — Minimal UI / Copy Reduction guardrails.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuiltInPracticePieces } from '../src/features/library/practiceLibrary.js'
import { evaluateAccuracySetup } from '../src/features/import/accuracyGuide.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('copy reduction sprint', () => {
  it('keeps the welcome card to one summary without duplicate setup copy', () => {
    const welcome = readSrc('components', 'LibraryWelcomeCard.jsx')
    expect(welcome).toContain('library-welcome__summary')
    expect(welcome).not.toContain('library-welcome__lead')
    expect(welcome).not.toContain('library-welcome__best')
    expect(welcome).not.toMatch(/Best setup:/i)
    const summary = welcome.match(/library-welcome__summary">\s*([^<]+)/)?.[1]?.replace(/\s+/g, ' ').trim()
    expect(summary).toBeTruthy()
    expect(summary.length).toBeLessThanOrEqual(200)
    expect(summary).toMatch(/demo first/i)
    expect(summary).toMatch(/timing file/i)
  })

  it('keeps built-in teaches blurbs short skill tags', () => {
    const piano = getBuiltInPracticePieces({ instrumentId: 'piano', difficulty: 'all' })
    const guitar = getBuiltInPracticePieces({ instrumentId: 'guitar', difficulty: 'all' })
    const pieces = [...piano, ...guitar]
    expect(pieces.length).toBeGreaterThanOrEqual(5)
    for (const piece of pieces) {
      expect(piece.teaches.length).toBeLessThanOrEqual(48)
      expect(piece.teaches.split(/\s+/).length).toBeLessThanOrEqual(8)
    }
  })

  it('avoids duplicate timing hints under Practice file rows', () => {
    const summary = readSrc('components', 'practice', 'PracticeFilesSummary.jsx')
    expect(summary).toContain('PracticeHelpTip')
    expect(summary).not.toMatch(/Your score appears in the center panel/)
    expect(summary).not.toMatch(/Optional\. Add a MIDI file in Library/)
    expect(summary).toContain('Required — add MusicXML/MXL in Library.')
  })

  it('hides Wait For You progress chrome in compact mode', () => {
    const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(section).toMatch(/totalCheckpoints > 0 && !compact/)
  })

  it('keeps accuracy status details concise', () => {
    const states = [
      evaluateAccuracySetup({ hasPdf: false, hasMusicXml: false }),
      evaluateAccuracySetup({ hasPdf: true, hasMusicXml: false }),
      evaluateAccuracySetup({ hasPdf: true, hasMusicXml: true }),
      evaluateAccuracySetup({ hasPdf: false, hasMusicXml: true }),
    ]
    for (const state of states) {
      expect(state.detail.length).toBeLessThanOrEqual(72)
    }
  })

  it('shows a compact piece header on the default Practice surface', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toContain('practice-piece-header')
    expect(panel).toContain('practice-piece-header__title')
    expect(panel).toContain('pieceTitle')
  })

  it('collapses import warnings out of the default Practice chrome', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const topNotices = panel.indexOf('<PracticeImportNotices')
    const advancedIndex = panel.indexOf('title="Advanced"')
    expect(topNotices).toBeGreaterThan(advancedIndex)
    expect(panel).toContain('warnings={importWarnings}')
  })

  it('uses one input-status channel and collapses secondary WFY actions', () => {
    const wfy = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    const strip = readSrc('components', 'practice', 'PracticeStatusStrip.jsx')
    expect(strip).toContain('Mic listening')
    expect(strip).toContain('MIDI ready')
    expect(wfy).toContain('showMidiListeningLine')
    expect(wfy).toContain('!compact')
    expect(wfy).toContain('wait-for-you__more')
    expect(wfy).toMatch(/compact \?[\s\S]*wait-for-you__header--compact/)
  })

  it('keeps piano Hands and guitar Cursor chrome consistent and collapsed by default', () => {
    const scope = readSrc('components', 'practice', 'PracticeScopeSection.jsx')
    const cursor = readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')
    expect(scope).toContain('Hands')
    expect(scope).not.toMatch(/>\s*Practice\s*</)
    expect(cursor).toContain('practice-score-cursor__details')
    expect(cursor).toContain('<summary className="practice-score-cursor__summary">')
  })

  it('raises mobile Practice panel height so primary actions stay reachable', () => {
    const css = readSrc('styles', 'practice.css')
    expect(css).toContain('max-height: min(62vh, 640px)')
    expect(css).toContain('max-height: 58vh')
    expect(css).not.toContain('max-height: min(50vh, 520px)')
    expect(css).not.toContain('max-height: 46vh')
  })
})
