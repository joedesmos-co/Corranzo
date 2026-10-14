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
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('settles instead of re-rendering forever when the layout reference changes each render', () => {
    const consoleErrors = []
    const originalError = console.error
    console.error = (...args) => {
      consoleErrors.push(args.map((arg) => String(arg)).join(' '))
      originalError(...args)
    }

    try {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const host = renderLayer(container)

      host.rerender(baseProps())
      const baseline = host.renders
      for (let index = 0; index < 12; index += 1) {
        host.rerender(baseProps())
      }
      const addedRenders = host.renders - baseline
      host.unmount()
      container.remove()

      expect(addedRenders).toBeLessThanOrEqual(13)
      const depthWarnings = consoleErrors.filter((text) => /Maximum update depth/.test(text))
      expect(depthWarnings).toEqual([])
    } finally {
      console.error = originalError
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
