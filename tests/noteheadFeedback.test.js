import { describe, expect, it } from 'vitest'
import {
  NOTEHEAD_FEEDBACK_COLORS,
  feedbackColorForState,
  noteheadGeometryForShape,
  noteheadShapeForNote,
  noteheadBoxesForEntry,
  NOTEHEAD_SHAPE,
} from '../src/features/practice/noteheadFeedback.js'

/**
 * Native notehead feedback: the musician's own recognition is painted on the
 * printed notehead. Notes keep their engraved shape, a played note is blue, a
 * note completed with help is yellow, and a wrong attempt never lights a
 * correct note.
 */
describe('native notehead feedback', () => {
  it('keeps the engraved shape of each notehead', () => {
    expect(noteheadShapeForNote({ noteType: 'quarter' })).toBe(NOTEHEAD_SHAPE.FILLED)
    expect(noteheadShapeForNote({ noteType: 'eighth' })).toBe(NOTEHEAD_SHAPE.FILLED)
    expect(noteheadShapeForNote({ noteType: '16th' })).toBe(NOTEHEAD_SHAPE.FILLED)
    expect(noteheadShapeForNote({ noteType: 'half' })).toBe(NOTEHEAD_SHAPE.HALF)
    expect(noteheadShapeForNote({ noteType: 'whole' })).toBe(NOTEHEAD_SHAPE.WHOLE)
    expect(noteheadShapeForNote({ noteType: 'breve' })).toBe(NOTEHEAD_SHAPE.WHOLE)
    expect(noteheadShapeForNote(null)).toBe(NOTEHEAD_SHAPE.FILLED)
  })

  it('draws hollow heads for half and whole notes, filled otherwise', () => {
    expect(noteheadGeometryForShape(NOTEHEAD_SHAPE.FILLED).filled).toBe(true)
    expect(noteheadGeometryForShape(NOTEHEAD_SHAPE.HALF).filled).toBe(false)
    expect(noteheadGeometryForShape(NOTEHEAD_SHAPE.WHOLE).filled).toBe(false)
    // A whole note is wider than it is tall, a half note is not.
    expect(noteheadGeometryForShape(NOTEHEAD_SHAPE.WHOLE).rx).toBeGreaterThan(
      noteheadGeometryForShape(NOTEHEAD_SHAPE.WHOLE).ry,
    )
  })

  it('colours a played note blue and an assisted one yellow', () => {
    expect(feedbackColorForState('completed')).toBe(NOTEHEAD_FEEDBACK_COLORS.correct)
    expect(feedbackColorForState('completed', { assisted: true })).toBe(
      NOTEHEAD_FEEDBACK_COLORS.assisted,
    )
  })

  it('colours a missed or wrong note red, and leaves a required note unpainted', () => {
    expect(feedbackColorForState('missed')).toBe(NOTEHEAD_FEEDBACK_COLORS.missed)
    expect(feedbackColorForState('wrong')).toBe(NOTEHEAD_FEEDBACK_COLORS.missed)
    // The required note stays black; it only gains a focus ring.
    expect(feedbackColorForState('current')).toBeNull()
    expect(feedbackColorForState('current-partial')).toBeNull()
  })

  it('uses the printed notehead extent when the score owns it', () => {
    const entry = {
      checkpoint: { notes: [{ midi: 60, sourceNoteheadId: 'sfnh-1', noteType: 'half' }] },
      target: {
        noteheadSize: { width: 0.02, height: 0.01 },
        notePlacements: [
          {
            x: 0.4,
            y: 0.3,
            midi: 60,
            sourceNoteheadId: 'sfnh-1',
            sourceBBox: { x0: 0.39, y0: 0.29, x1: 0.41, y1: 0.31 },
          },
        ],
      },
    }
    const boxes = noteheadBoxesForEntry(entry)
    expect(boxes).toHaveLength(1)
    expect(boxes[0].shape).toBe(NOTEHEAD_SHAPE.HALF)
    expect(boxes[0].rect).toEqual({ x0: 0.39, y0: 0.29, x1: 0.41, y1: 0.31 })
  })

  it('sizes a notehead from the staff when the exact head is not owned', () => {
    const entry = {
      checkpoint: { notes: [{ midi: 60, noteType: 'quarter' }] },
      target: {
        noteheadSize: { width: 0.02, height: 0.01 },
        notePlacements: [{ x: 0.4, y: 0.3, midi: 60, sourceNoteheadId: null, sourceBBox: null }],
      },
    }
    const boxes = noteheadBoxesForEntry(entry)
    expect(boxes).toHaveLength(1)
    expect(boxes[0].shape).toBe(NOTEHEAD_SHAPE.FILLED)
    expect(boxes[0].rect.x0).toBeCloseTo(0.39, 6)
    expect(boxes[0].rect.x1).toBeCloseTo(0.41, 6)
    expect(boxes[0].rect.y0).toBeCloseTo(0.295, 6)
    expect(boxes[0].rect.y1).toBeCloseTo(0.305, 6)
  })

  it('returns nothing when the event owns no notehead geometry', () => {
    expect(noteheadBoxesForEntry({ checkpoint: { notes: [] }, target: { visible: true } })).toEqual([])
    expect(noteheadBoxesForEntry(null)).toEqual([])
  })
})
