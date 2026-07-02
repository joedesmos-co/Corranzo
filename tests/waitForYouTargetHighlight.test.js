import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'
import {
  NOTE_TARGET_SOURCE,
  resolveNoteTargetPosition,
} from '../src/features/practice/noteTargetPosition.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

const C4 = 60
const E4 = 64
const G4 = 67

function timingMap(notes) {
  return {
    measures: [
      { number: 1, startTimeSeconds: 0, durationSeconds: 2 },
      { number: 2, startTimeSeconds: 2, durationSeconds: 2 },
    ],
    notes,
    beats: [{ measureNumber: 1, beat: 1, timeSeconds: 0 }],
  }
}

function anchors() {
  return [
    {
      id: 'm1',
      page: 1,
      x: 0.12,
      y: 0.38,
      measureNumber: 1,
      source: 'manual',
      meta: { playableStartX: 0.12, playableEndX: 0.52, systemEndX: 0.9 },
    },
    {
      id: 'm2',
      page: 1,
      x: 0.52,
      y: 0.38,
      measureNumber: 2,
      source: 'manual',
      meta: { playableStartX: 0.52, playableEndX: 0.9, systemEndX: 0.9 },
    },
  ]
}

function checkpoint(notes, overrides = {}) {
  return {
    id: overrides.id ?? 'cp-1',
    kind: CHECKPOINT_KIND.NOTE,
    measureNumber: 1,
    timeSeconds: 0,
    expectedMidis: notes.map((note) => note.midi),
    notes,
    isChord: notes.length > 1,
    ...overrides,
  }
}

function layoutNote(midi, defaultX, defaultY = 0) {
  return {
    midi,
    label: String(midi),
    isRest: false,
    measureNumber: 1,
    timeSeconds: 0,
    staff: midi < C4 ? 2 : 1,
    defaultX,
    defaultY,
  }
}

describe('Wait For You target highlight geometry', () => {
  it('uses note geometry for the primary target highlight', () => {
    const notes = [layoutNote(C4, 40, 0)]
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes),
      timingMap: timingMap(notes),
      anchors: anchors(),
    })

    expect(target.visible).toBe(true)
    expect(target.displayMode).toBe('highlight')
    expect(target.highlight).toBeTruthy()
    expect(target.highlight.source).toBe(NOTE_TARGET_SOURCE.MUSICXML_LAYOUT)
    expect(target.highlight.noteCount).toBe(1)
    expect(target.highlight.isChord).toBe(false)
    expect(target.highlight.x0).toBeLessThan(target.x)
    expect(target.highlight.x1).toBeGreaterThan(target.x)
    expect(target.highlight.y0).toBeLessThan(target.noteAnchorY)
    expect(target.highlight.y1).toBeGreaterThan(target.noteAnchorY)
    expect(target.approximate).toBe(false)
  })

  it('uses direct detected notehead geometry when it is already available', () => {
    const notes = [
      {
        midi: C4,
        label: 'C4',
        isRest: false,
        measureNumber: 1,
        timeSeconds: 0,
        xNorm: 0.42,
        yNorm: 0.31,
      },
    ]
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes, { id: 'cp-direct' }),
      timingMap: timingMap(notes),
      anchors: anchors(),
    })

    expect(target.displayMode).toBe('highlight')
    expect(target.source).toBe(NOTE_TARGET_SOURCE.DIRECT_GEOMETRY)
    expect(target.highlight.source).toBe(NOTE_TARGET_SOURCE.DIRECT_GEOMETRY)
    expect(target.highlight.x0).toBeLessThan(0.42)
    expect(target.highlight.x1).toBeGreaterThan(0.42)
    expect(target.highlight.y0).toBeLessThan(0.31)
    expect(target.highlight.y1).toBeGreaterThan(0.31)
  })

  it('spans all note boxes for chord targets', () => {
    const notes = [
      layoutNote(C4, 60, -120),
      layoutNote(E4, 63, 0),
      layoutNote(G4, 66, 120),
    ]
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes, { id: 'cp-chord' }),
      timingMap: timingMap(notes),
      anchors: anchors(),
    })

    expect(target.displayMode).toBe('highlight')
    expect(target.highlight.isChord).toBe(true)
    expect(target.highlight.noteCount).toBe(3)

    const minY = Math.min(...target.highlight.noteBoxes.map((box) => box.y0))
    const maxY = Math.max(...target.highlight.noteBoxes.map((box) => box.y1))
    const minX = Math.min(...target.highlight.noteBoxes.map((box) => box.x0))
    const maxX = Math.max(...target.highlight.noteBoxes.map((box) => box.x1))

    expect(target.highlight.y0).toBeLessThanOrEqual(minY)
    expect(target.highlight.y1).toBeGreaterThanOrEqual(maxY)
    expect(target.highlight.x0).toBeLessThanOrEqual(minX)
    expect(target.highlight.x1).toBeGreaterThanOrEqual(maxX)
    expect(target.highlight.y1 - target.highlight.y0).toBeGreaterThan(0.04)
  })

  it('uses the dot fallback only when note geometry is missing', () => {
    const notes = [
      {
        midi: C4,
        label: 'C4',
        isRest: false,
        measureNumber: 1,
        timeSeconds: 0,
        staff: 1,
      },
    ]
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes, { id: 'cp-fallback' }),
      timingMap: timingMap(notes),
      anchors: anchors(),
    })

    expect(target.visible).toBe(true)
    expect(target.displayMode).toBe('dot-fallback')
    expect(target.highlight).toBeNull()
    expect(target.approximate).toBe(true)
    expect(target.confidence).toBeLessThan(0.7)
    expect(Number.isFinite(target.x)).toBe(true)
    expect(Number.isFinite(target.y)).toBe(true)
  })

  it('guards page, rotation, and target changes so highlights do not stale', () => {
    const overlay = readSrc('components', 'pdf', 'ScoreFollowOverlay.jsx')
    const frame = readSrc('components', 'pdf', 'PdfPageFrame.jsx')
    const hook = readSrc('features', 'practice', 'useWaitForYouNoteTarget.js')
    const position = readSrc('features', 'practice', 'noteTargetPosition.js')

    expect(overlay).toContain('noteTarget.page === pageNumber')
    expect(overlay).toContain('mapAnalysisAxisRectToViewerOverlay')
    expect(overlay).toContain('prev.viewerRotation !== next.viewerRotation')
    expect(overlay).toContain('pt?.targetKey !== nt?.targetKey')
    expect(frame).toContain('viewerRotation={viewRotation}')
    expect(hook).toContain('[currentCheckpoint, timingMap, anchors]')
    expect(position).toContain('targetKey: checkpoint.id')
  })

  it('changes target keys after Wait For You advances even when nearby geometry matches', () => {
    const notes = [layoutNote(C4, 40, 0)]
    const map = timingMap(notes)
    const targetA = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes, { id: 'cp-before' }),
      timingMap: map,
      anchors: anchors(),
    })
    const targetB = resolveNoteTargetPosition({
      checkpoint: checkpoint(notes, { id: 'cp-after' }),
      timingMap: map,
      anchors: anchors(),
    })

    expect(targetA.displayMode).toBe('highlight')
    expect(targetB.displayMode).toBe('highlight')
    expect(targetA.highlight.x0).toBe(targetB.highlight.x0)
    expect(targetA.targetKey).not.toBe(targetB.targetKey)
  })
})
