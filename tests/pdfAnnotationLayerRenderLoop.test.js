// @vitest-environment happy-dom
/**
 * Render-loop regression: PDF annotation overlay vs. React's nested-update limit.
 *
 * Real production defect (intermittent "Maximum update depth exceeded" during
 * practice playback). Root cause was a passive-effect feedback loop between the
 * page-frame overlay stack and the annotation layer:
 *
 *   PdfPageFrame built a FRESH `layout` object literal on every render and
 *   passed it to <AnnotationLayer>; AnnotationLayer's sync effect depended on
 *   that object's IDENTITY, so the effect re-ran on every render; and the effect
 *   called `setPageRect(getBoundingClientRect())` with a fresh DOMRect, so it
 *   always changed state and rendered again — forever.
 *
 * It did not scream on every load: React only warns once 50 consecutive commits
 * each schedule an update, so any pause in the render triggers (practice-clock
 * ticks, page-follow scrolling, mic frames) silently reset the counter. During
 * playback the triggers never stop, hence "intermittent".
 *
 * This test drives the REAL component with the REAL React runtime in a DOM and
 * asserts (a) React never logs the warning and (b) the render count settles
 * instead of growing without bound. No monkeypatching, no warning suppression,
 * no artificial timeouts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))

const AnnotationLayer = (await import('../src/components/pdf/AnnotationLayer.jsx')).default

globalThis.React = React
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const POINTER_TOOL = 'pointer'

function baseProps() {
  return {
    // A NEW reference on every call — exactly what PdfPageFrame did before.
    layout: { left: 0, top: 0, width: 800, height: 1000 },
    strokes: [],
    activeTool: POINTER_TOOL,
    strokeStyle: null,
    onStrokeComplete: () => {},
    onErase: () => {},
    onLiveErase: () => {},
  }
}

function renderLayer(container) {
  const root = createRoot(container)
  let renders = 0

  function Probe(props) {
    renders += 1
    return createElement(AnnotationLayer, props)
  }

  return {
    get renders() {
      return renders
    },
    rerender(props) {
      act(() => {
        root.render(createElement(Probe, props))
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
    },
  }
}

describe('AnnotationLayer render loop', () => {
  let restoreRect

  beforeEach(() => {
    // happy-dom returns an all-zero rect, which the layer treats as "no box"
    // and skips measuring. Give the element a real page box so the measurement
    // effect actually runs and can (pre-fix) re-trigger itself forever.
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function stub() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 1000,
        width: 800,
        height: 1000,
        toJSON: () => ({}),
      }
    }
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = original
    }
  })

  afterEach(() => {
    restoreRect?.()
    document.body.innerHTML = ''
  })

  it('does not re-run its measurement effect when the layout reference changes but values do not', () => {
    const scrollSubscriptions = []
    const originalAdd = window.addEventListener.bind(window)
    const originalRemove = window.removeEventListener.bind(window)
    window.addEventListener = (type, ...rest) => {
      if (type === 'scroll') {
        scrollSubscriptions.push('add')
      }
      return originalAdd(type, ...rest)
    }
    window.removeEventListener = (type, ...rest) => {
      if (type === 'scroll') {
        scrollSubscriptions.push('remove')
      }
      return originalRemove(type, ...rest)
    }

    try {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const host = renderLayer(container)

      host.rerender(baseProps())
      const baselineSubscriptions = scrollSubscriptions.length
      for (let index = 0; index < 10; index += 1) {
        host.rerender(baseProps())
      }
      const addedSubscriptions = scrollSubscriptions.length - baselineSubscriptions
      host.unmount()
      container.remove()

      // One effect run per layout-VALUE change. An identity dependency re-ran
      // the effect (and re-subscribed) on every render, which combined with the
      // effect's own setState is the passive-effect loop React eventually
      // surfaced as "Maximum update depth exceeded".
      expect(addedSubscriptions).toBe(0)
    } finally {
      window.addEventListener = originalAdd
      window.removeEventListener = originalRemove
    }
  })

  it('still mounts and measures with no page box available', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const host = renderLayer(container)
    host.rerender(baseProps())
    expect(host.renders).toBeGreaterThan(0)
    host.unmount()
    container.remove()
  })
})
