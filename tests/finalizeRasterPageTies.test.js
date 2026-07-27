import { describe, expect, it } from 'vitest'
import { finalizeRasterPageTies } from '../src/features/omr/finalizeRasterPageTies.js'

describe('finalizeRasterPageTies', () => {
  it('pairs an enrich candidate to the next same-pitch note with start/stop', () => {
    const records = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true }],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [{ midi: 69, clef: 'treble', cx: 160, cy: 200 }],
          },
        ],
      },
    ]

    const { diagnostics } = finalizeRasterPageTies(records)
    expect(diagnostics.appliedTieCount).toBe(1)
    expect(records[0].events[0].notes[0].tieStart).toBe(true)
    expect(records[0].events[1].notes[0].tieStop).toBe(true)
  })

  it('drops orphan enrich starts with no same-pitch destination', () => {
    const records = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true }],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [{ midi: 71, clef: 'treble', cx: 160, cy: 190 }],
          },
        ],
      },
    ]

    const { diagnostics } = finalizeRasterPageTies(records)
    expect(diagnostics.appliedTieCount).toBe(0)
    expect(records[0].events[0].notes[0].tieStart).toBeUndefined()
  })

  it('does not treat staccato near-head marks as ties', () => {
    const records = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [
              {
                midi: 69,
                clef: 'treble',
                cx: 100,
                cy: 200,
                tieStart: true,
                articulation: { type: 'staccato' },
              },
            ],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [{ midi: 69, clef: 'treble', cx: 160, cy: 200 }],
          },
        ],
      },
    ]

    const { diagnostics } = finalizeRasterPageTies(records)
    expect(diagnostics.droppedStaccatoCount).toBe(1)
    expect(diagnostics.appliedTieCount).toBe(0)
  })

  it('does not classify different-pitch curves as ties', () => {
    const records = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true }],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [{ midi: 71, clef: 'treble', cx: 160, cy: 190, tieStart: true }],
          },
        ],
      },
    ]

    finalizeRasterPageTies(records)
    expect(records[0].events[0].notes[0].tieStart).toBeUndefined()
    expect(records[0].events[1].notes[0].tieStop).toBeUndefined()
  })

  it('does not invent raster enrich ties inside merged chord events', () => {
    const records = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [
              { midi: 69, clef: 'treble', cx: 100, cy: 200, tieStart: true },
              { midi: 64, clef: 'treble', cx: 100, cy: 210 },
            ],
          },
          {
            type: 'note',
            startDivision: 4,
            notes: [
              { midi: 69, clef: 'treble', cx: 160, cy: 200 },
              { midi: 64, clef: 'treble', cx: 160, cy: 210 },
            ],
          },
        ],
      },
    ]

    const { diagnostics } = finalizeRasterPageTies(records)
    expect(diagnostics.appliedTieCount).toBe(0)
    expect(records[0].events[0].notes[0].tieStart).toBeUndefined()
  })

  it('keeps one late staccato enrich orphan-start for cross-bar written ties', () => {
    const records = [
      {
        measureNumber: 3,
        events: [
          {
            type: 'note',
            startDivision: 8,
            notes: [
              {
                midi: 72,
                clef: 'treble',
                cx: 500,
                cy: 200,
                tieStart: true,
                articulation: { type: 'staccato' },
              },
              { midi: 67, clef: 'treble', cx: 500, cy: 210 },
            ],
          },
        ],
      },
      {
        measureNumber: 4,
        events: [
          {
            type: 'note',
            startDivision: 0,
            notes: [{ midi: 69, clef: 'treble', cx: 560, cy: 205 }],
          },
        ],
      },
    ]

    const { diagnostics } = finalizeRasterPageTies(records)
    expect(diagnostics.orphanStartKeepCount).toBe(1)
    expect(records[0].events[0].notes[0].tieStart).toBe(true)
    expect(records[0].events[0].notes[1].tieStart).toBeUndefined()
    expect(records[1].events[0].notes[0].tieStop).toBeUndefined()
  })
})
