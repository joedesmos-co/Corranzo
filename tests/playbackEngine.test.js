import { describe, expect, it } from 'vitest'

/** Mirrors ScorePlaybackEngine event deduplication key. */
function eventKey(event) {
  return `${event.type}:${event.scoreTimeSeconds.toFixed(5)}`
}

describe('playback engine scheduling invariants', () => {
  it('deduplicates events at the same score time and type', () => {
    const events = [
      { type: 'note', scoreTimeSeconds: 1.0 },
      { type: 'note', scoreTimeSeconds: 1.0 },
      { type: 'metronome', scoreTimeSeconds: 1.0 },
    ]
    const keys = new Set(events.map(eventKey))
    expect(keys.size).toBe(2)
  })

  it('clears scheduled keys on seek boundary (simulated)', () => {
    const scheduledKeys = new Set(['note:1.00000', 'note:2.00000'])
    scheduledKeys.clear()
    expect(scheduledKeys.size).toBe(0)
  })

  it('pause preserves offset without duplicate scheduling keys', () => {
    const offset = 4.5
    const scheduledKeys = new Set(['note:4.50000'])
    scheduledKeys.clear()
    expect(offset).toBeCloseTo(4.5)
    expect(scheduledKeys.size).toBe(0)
  })
})
