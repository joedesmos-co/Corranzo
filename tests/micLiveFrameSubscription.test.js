// @vitest-environment happy-dom
/**
 * Live mic frame React binding.
 *
 * Guards the point of the optimization: a per-frame level meter must re-render
 * only its own component. When the live frame was React state inside
 * `useWaitForYouMicInput`, each publish invalidated the session's
 * `waitForYouInput` memo and re-rendered the whole practice tree.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const {
  publishMicLiveFrame,
  useMicLiveFrame,
} = await import('../src/features/microphone-input/micLiveFrameRuntime.js')

describe('useMicLiveFrame', () => {
  it('re-renders the subscribed component only when the frame really changes', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let renders = 0

    function Probe() {
      renders += 1
      const live = useMicLiveFrame()
      return createElement('span', null, `${Math.round((live.level ?? 0) * 100)}`)
    }

    act(() => {
      root.render(createElement(Probe))
    })
    const baseline = renders

    // Establish the frame the component will then be fed unchanged.
    act(() => {
      publishMicLiveFrame({ level: 0.4, midi: 60, noteLabel: 'C4' })
    })
    expect(renders).toBe(baseline + 1)

    // Publishing identical content must not re-render.
    for (let index = 0; index < 5; index += 1) {
      act(() => {
        publishMicLiveFrame({ level: 0.4, midi: 60, noteLabel: 'C4' })
      })
    }
    expect(renders).toBe(baseline + 1)

    // A real change re-renders exactly once.
    act(() => {
      publishMicLiveFrame({ level: 0.75, midi: 60, noteLabel: 'C4' })
    })
    expect(renders).toBe(baseline + 2)
    expect(container.textContent).toBe('75')

    act(() => {
      publishMicLiveFrame(null)
    })
    expect(renders).toBe(baseline + 3)
    expect(container.textContent).toBe('0')

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
