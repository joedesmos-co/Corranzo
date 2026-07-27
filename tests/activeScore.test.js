/**
 * Unit tests for ActiveScore sync + ownership invariants.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  createEmptyActiveScore,
  createScoreId,
  syncActiveScoreFromLegacy,
  withActiveScoreMusicXml,
  assertDerivedBelongsToActiveScore,
  stampMusicXmlOwnerScoreId,
} from '../src/features/score/activeScore.js'
import { createMusicXmlSource } from '../src/features/import/musicXmlSource.js'

function pdfMeta(name, size = 100, lastModified = 1) {
  return { fileName: name, size, lastModified }
}

function bufferFrom(text) {
  return new TextEncoder().encode(text).buffer
}

describe('activeScore', () => {
  beforeEach(() => {
    // score ids are unique per call; no global reset required
  })

  it('creates empty score with null scoreId', () => {
    const empty = createEmptyActiveScore({ generation: 3 })
    expect(empty.scoreId).toBeNull()
    expect(empty.generation).toBe(3)
    expect(empty.pdf).toBeNull()
    expect(empty.musicXml).toBeNull()
  })

  it('assigns a new scoreId when a PDF is first selected', () => {
    const score = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-a-bytes'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
    })
    expect(score.scoreId).toMatch(/^score-/)
    expect(score.pdf.contentHash).toBeTruthy()
    expect(score.musicXml).toBeNull()
  })

  it('keeps scoreId when the same PDF identity syncs again', () => {
    const buffer = bufferFrom('same-pdf')
    const meta = pdfMeta('Same.pdf', 9, 42)
    const first = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:1',
      pdfBuffer: buffer,
      pdfMeta: meta,
      generation: 1,
    })
    const second = syncActiveScoreFromLegacy(first, {
      pdfFile: 'blob:1',
      pdfBuffer: buffer,
      pdfMeta: meta,
      generation: 1,
      musicXmlSource: stampMusicXmlOwnerScoreId(
        createMusicXmlSource('a.musicxml', '<score/>', { source: 'omr' }),
        first.scoreId,
      ),
    })
    expect(second.scoreId).toBe(first.scoreId)
    expect(second.musicXml?.ownerScoreId).toBe(first.scoreId)
    expect(second.musicXml?.hash).toBeTruthy()
  })

  it('creates a NEW scoreId when PDF content changes (does not mutate A into B)', () => {
    const scoreA = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A-content'),
      pdfMeta: pdfMeta('A.pdf', 10, 1),
      generation: 1,
    })
    const scoreB = syncActiveScoreFromLegacy(scoreA, {
      pdfFile: 'blob:b',
      pdfBuffer: bufferFrom('pdf-B-content-different'),
      pdfMeta: pdfMeta('B.pdf', 20, 2),
      generation: 2,
    })
    expect(scoreB.scoreId).not.toBe(scoreA.scoreId)
    expect(scoreB.generation).toBe(2)
    expect(scoreB.pdf.contentHash).not.toBe(scoreA.pdf.contentHash)
  })

  it('drops MusicXML owned by a different scoreId instead of re-parenting', () => {
    const scoreA = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
    })
    const foreignXml = stampMusicXmlOwnerScoreId(
      createMusicXmlSource('a.musicxml', '<score-partwise/>', { source: 'omr' }),
      'score-foreign',
    )
    const synced = syncActiveScoreFromLegacy(scoreA, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
      musicXmlSource: foreignXml,
    })
    expect(synced.musicXml).toBeNull()
  })

  it('withActiveScoreMusicXml rejects foreign ownerScoreId', () => {
    const score = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
    })
    const foreign = stampMusicXmlOwnerScoreId(
      createMusicXmlSource('x.musicxml', '<score/>', { source: 'omr' }),
      createScoreId(),
    )
    const next = withActiveScoreMusicXml(score, foreign)
    expect(next.musicXml).toBeNull()
    expect(next.scoreId).toBe(score.scoreId)
  })

  it('assertDerivedBelongsToActiveScore detects mismatch', () => {
    const score = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
    })
    const ok = assertDerivedBelongsToActiveScore(
      { ownerScoreId: score.scoreId },
      score,
      'timing',
    )
    expect(ok.ok).toBe(true)
    expect(() =>
      assertDerivedBelongsToActiveScore({ ownerScoreId: 'other' }, score, 'timing'),
    ).toThrow(/ownerScoreId/)
  })

  it('drops unowned MusicXML when PDF identity changes (no re-parent)', () => {
    const scoreA = syncActiveScoreFromLegacy(null, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
    })
    const unownedXml = createMusicXmlSource('a.musicxml', '<score-partwise/>', {
      source: 'omr',
    })
    const withA = syncActiveScoreFromLegacy(scoreA, {
      pdfFile: 'blob:a',
      pdfBuffer: bufferFrom('pdf-A'),
      pdfMeta: pdfMeta('A.pdf'),
      generation: 1,
      musicXmlSource: stampMusicXmlOwnerScoreId(unownedXml, scoreA.scoreId),
    })
    expect(withA.musicXml?.hash).toBeTruthy()

    const scoreB = syncActiveScoreFromLegacy(withA, {
      pdfFile: 'blob:b',
      pdfBuffer: bufferFrom('pdf-B-different'),
      pdfMeta: pdfMeta('B.pdf', 20, 2),
      generation: 2,
      // Stale A companion still present in React state for one frame.
      musicXmlSource: withA.musicXml.legacySource,
    })
    expect(scoreB.scoreId).not.toBe(scoreA.scoreId)
    expect(scoreB.musicXml).toBeNull()
  })
})
