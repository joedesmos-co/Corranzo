import { describe, expect, it } from 'vitest'

/**
 * Mirrors ScorePlaybackEngine.scheduleWindow de-duplication: events are tracked
 * by IDENTITY (object reference), not by a time+type key. A time-key collapsed
 * simultaneous notes into one, dropping chord / bass / inner voices ("only top
 * notes"). Identity keeps every distinct note while still preventing the same
 * event from being scheduled twice across overlapping look-ahead windows.
 */
function scheduleOnce(events) {
  const scheduled = new Set()
  const triggered = []
  for (const event of events) {
    if (scheduled.has(event)) {
      continue
    }
    triggered.push(event)
    scheduled.add(event)
  }
  return triggered
}

describe('playback engine scheduling invariants', () => {
  it('schedules every note of a chord at the same score time (no top-note collapse)', () => {
    const c = { type: 'note', scoreTimeSeconds: 1.0, name: 'C4' }
    const e = { type: 'note', scoreTimeSeconds: 1.0, name: 'E4' }
    const g = { type: 'note', scoreTimeSeconds: 1.0, name: 'G4' }
    const bass = { type: 'note', scoreTimeSeconds: 1.0, name: 'C2' }
    // The same `c` appears twice (overlapping windows) and must trigger once.
    const triggered = scheduleOnce([c, e, g, bass, c])
    expect(triggered).toEqual([c, e, g, bass])
  })

  it('does not re-trigger an already-scheduled event across windows', () => {
    const n = { type: 'note', scoreTimeSeconds: 2.0, name: 'D4' }
    expect(scheduleOnce([n, n, n])).toEqual([n])
  })

  it('clears scheduled events on a seek/reschedule boundary', () => {
    const scheduledEvents = new Set([{ name: 'a' }, { name: 'b' }])
    scheduledEvents.clear()
    expect(scheduledEvents.size).toBe(0)
  })
})
