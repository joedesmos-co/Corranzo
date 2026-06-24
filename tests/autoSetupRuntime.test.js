import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  buildAutoSetupRuntimeDiagnostics,
  describeAutoSetupRejection,
  summarizePerSystemAllocation,
} from '../src/features/score-follow/autoSetupRuntimeDiagnostics.js'
import {
  clearAutoSetupAttempted,
  hasAutoSetupBeenAttempted,
  markAutoSetupAttempted,
  shouldClearStaleAutoSetupFlag,
} from '../src/features/score-follow/scoreFollowAutoSetupStorage.js'

describe('describeAutoSetupRejection', () => {
  it('returns null when setup is plausible', () => {
    expect(
      describeAutoSetupRejection(
        { ok: true },
        { plausible: true, proposedAnchors: [{}, {}], systemCount: 5 },
      ),
    ).toBeNull()
  })

  it('describes no-systems failures', () => {
    const rejection = describeAutoSetupRejection(
      { ok: false, noSystems: true, message: 'no systems' },
      null,
    )
    expect(rejection.code).toBe('no-systems')
  })

  it('describes implausible mapping with system-count mismatch', () => {
    const rejection = describeAutoSetupRejection(
      { ok: true },
      {
        plausible: false,
        proposedAnchors: [{ y: 0.2 }, { y: 0.4 }],
        systemCount: 20,
        expectedSystemCount: 5,
        reconciled: false,
      },
    )
    expect(rejection.code).toBe('implausible-mapping')
    expect(rejection.detail).toContain('system-count-mismatch')
  })
})

describe('summarizePerSystemAllocation', () => {
  it('reads measure ranges from debug report systems', () => {
    const allocation = summarizePerSystemAllocation({
      debugReport: {
        systems: [
          { index: 0, page: 1, measureStart: 1, measureEnd: 6, measureCount: 6 },
          { index: 1, page: 1, measureStart: 7, measureEnd: 12, measureCount: 6 },
        ],
      },
    })
    expect(allocation).toEqual([
      { index: 0, page: 1, measureStart: 1, measureEnd: 6, measureCount: 6 },
      { index: 1, page: 1, measureStart: 7, measureEnd: 12, measureCount: 6 },
    ])
  })
})

describe('buildAutoSetupRuntimeDiagnostics', () => {
  it('includes timing, layout, and allocation fields', () => {
    const diagnostics = buildAutoSetupRuntimeDiagnostics({
      result: { ok: true },
      preview: {
        plausible: true,
        systemCount: 20,
        expectedSystemCount: 19,
        systemCountHint: 19,
        proposedAnchors: [{}, {}],
        confidence: 1,
        stage: 'staff-lines',
        allocationMode: 'breaks-or-even',
        layoutConfidence: { level: 'approximate', reasons: ['test'] },
        layoutMismatch: { mismatch: false, reasons: [] },
        debugReport: {
          systems: [{ index: 0, page: 1, measureStart: 1, measureEnd: 6, measureCount: 6 }],
        },
      },
      timingMap: { measures: Array.from({ length: 104 }) },
      numPages: 4,
      setupStatus: { phase: 'ready' },
      semiAutoSetup: { status: 'confirmed', error: null },
      autoSetupAttempted: true,
    })
    expect(diagnostics.timingMeasureCount).toBe(104)
    expect(diagnostics.pdfPageCount).toBe(4)
    expect(diagnostics.detectedSystemCount).toBe(20)
    expect(diagnostics.expectedSystemCount).toBe(19)
    expect(diagnostics.layoutConfidenceLevel).toBe('approximate')
    expect(diagnostics.allocationMode).toBe('breaks-or-even')
    expect(diagnostics.perSystemAllocation).toHaveLength(1)
    expect(diagnostics.rejectionCode).toBeNull()
    expect(diagnostics.needsQuickSetupReason).toBeNull()
  })
})

describe('scoreFollowAutoSetupStorage', () => {
  const key = 'scoreflow-auto-setup-v1-test::timing'
  const store = new Map()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('sessionStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v)
      },
      removeItem: (k) => {
        store.delete(k)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks only explicit success marks', () => {
    clearAutoSetupAttempted(key)
    expect(hasAutoSetupBeenAttempted(key)).toBe(false)
    markAutoSetupAttempted(key)
    expect(hasAutoSetupBeenAttempted(key)).toBe(true)
    clearAutoSetupAttempted(key)
    expect(hasAutoSetupBeenAttempted(key)).toBe(false)
  })

  it('clears stale success flags when auto anchors were never applied', () => {
    expect(
      shouldClearStaleAutoSetupFlag({ attempted: true, autoAnchorCount: 0 }),
    ).toBe(true)
    expect(
      shouldClearStaleAutoSetupFlag({ attempted: true, autoAnchorCount: 2 }),
    ).toBe(false)
    expect(
      shouldClearStaleAutoSetupFlag({ attempted: false, autoAnchorCount: 0 }),
    ).toBe(false)
  })
})
