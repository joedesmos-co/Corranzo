import { describe, expect, it } from 'vitest'
import PracticeErrorBoundary from '../src/components/practice/PracticeErrorBoundary.jsx'

describe('PracticeErrorBoundary', () => {
  it('captures render errors via getDerivedStateFromError', () => {
    const error = new ReferenceError("Cannot access 'labelHelper' before initialization")
    expect(PracticeErrorBoundary.getDerivedStateFromError(error)).toEqual({ error })
  })

  it('exposes recovery actions for reload and library navigation', () => {
    let reloaded = false
    let returned = false
    const boundary = new PracticeErrorBoundary({
      resetKey: 'a:0',
      children: null,
      onReloadPractice: () => {
        reloaded = true
      },
      onReturnToLibrary: () => {
        returned = true
      },
    })
    boundary.state = { error: new Error('boom') }
    boundary.handleReload()
    boundary.handleReturnToLibrary()
    expect(reloaded).toBe(true)
    expect(returned).toBe(true)
  })
})
