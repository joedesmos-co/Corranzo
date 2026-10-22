/**
 * Live mic frame runtime.
 *
 * The detector publishes one frame per animation frame and the level meter
 * renders it. While that frame lived in React state inside
 * `useWaitForYouMicInput`, every publish invalidated the session's
 * `waitForYouInput` memo, so the practice session re-rendered roughly 16 times a
 * second for a level meter (~1 650 state-slot renders per second).
 *
 * The frame now publishes to an imperative store (the same pattern the
 * score-follow cursor runtime uses) and only the small mic readout subscribes.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const {
  getMicLiveFrameSnapshot,
  publishMicLiveFrame,
  subscribeMicLiveFrame,
} = await import('../src/features/microphone-input/micLiveFrameRuntime.js')

function frame(overrides) {
  return { level: 0.4, midi: 60, noteLabel: 'C4', ...overrides }
}

describe('live mic frame runtime', () => {
  afterEach(() => {
    publishMicLiveFrame(null)
  })

  it('publishes unchanged frames once', () => {
    expect(publishMicLiveFrame(frame())).toBe(true)
    const first = getMicLiveFrameSnapshot()
    // Identical content must not replace the snapshot.
    expect(publishMicLiveFrame(frame())).toBe(false)
    expect(getMicLiveFrameSnapshot()).toBe(first)
    // A real change must.
    expect(publishMicLiveFrame(frame({ level: 0.5 }))).toBe(true)
    expect(getMicLiveFrameSnapshot()).not.toBe(first)
    expect(getMicLiveFrameSnapshot().level).toBe(0.5)
  })

  it('resets to an empty frame', () => {
    publishMicLiveFrame(frame())
    expect(getMicLiveFrameSnapshot().level).toBe(0.4)
    expect(publishMicLiveFrame(null)).toBe(true)
    expect(getMicLiveFrameSnapshot().level).toBe(0)
    expect(getMicLiveFrameSnapshot().midi).toBe(null)
  })

  it('notifies subscribers only when content changes', () => {
    let notifications = 0
    const unsubscribe = subscribeMicLiveFrame(() => {
      notifications += 1
    })
    // subscribeMicLiveFrame calls the listener once immediately.
    expect(notifications).toBe(1)
    publishMicLiveFrame(frame())
    expect(notifications).toBe(2)
    publishMicLiveFrame(frame()) // identical
    expect(notifications).toBe(2)
    publishMicLiveFrame(frame({ midi: 62 }))
    expect(notifications).toBe(3)
    unsubscribe()
    publishMicLiveFrame(frame({ level: 0.9 }))
    expect(notifications).toBe(3)
  })

  it('mic readout subscribes to the runtime instead of taking the frame as a prop', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const panel = readFileSync(join(root, 'src/components/practice/MicTestPanel.jsx'), 'utf8')
    expect(panel).toContain('useMicLiveFrame')
    expect(panel).not.toMatch(/\{\s*liveFrame\s*,/)
  })

  it('mic input hook publishes live frames instead of storing them in state', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const hook = readFileSync(
      join(root, 'src/features/practice/useWaitForYouMicInput.js'),
      'utf8',
    )
    expect(hook).toContain('publishMicLiveFrame(')
    expect(hook).not.toMatch(/const \[liveFrame, setLiveFrame\]/)
  })
})
