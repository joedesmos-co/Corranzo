import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { ANCHOR_SOURCE } from '../src/features/score-follow/anchorUtils.js'
import {
  hasUsableScoreFollowAnchors,
  OMR_AUTO_SETUP_TIMEOUT_MS,
  shouldClearStaleScanningUi,
  shouldSkipAutoSetupScan,
} from '../src/features/score-follow/scoreFollowSetupState.js'

const __dir = dirname(fileURLToPath(import.meta.url))

const timingMap = {
  measures: Array.from({ length: 32 }, (_, index) => ({
    number: index + 1,
    startTime: index,
    endTime: index + 1,
  })),
}

function demoAnchors() {
  return [
    { id: 'd1', page: 1, x: 0.1, y: 0.2, measureNumber: 1, source: ANCHOR_SOURCE.DEMO },
    { id: 'd2', page: 1, x: 0.5, y: 0.2, measureNumber: 8, source: ANCHOR_SOURCE.DEMO },
  ]
}

function autoSystemAnchors() {
  return [
    {
      id: 'a1',
      page: 1,
      x: 0.1,
      y: 0.2,
      measureNumber: 1,
      source: ANCHOR_SOURCE.AUTO_SYSTEM,
      meta: { role: 'system-start' },
    },
    {
      id: 'a2',
      page: 1,
      x: 0.8,
      y: 0.2,
      measureNumber: 16,
      source: ANCHOR_SOURCE.AUTO_SYSTEM,
      meta: { role: 'system-end' },
    },
  ]
}

describe('score follow restore setup state', () => {
  it('treats restored demo bundled anchors as ready without scanning', () => {
    const anchors = demoAnchors()
    const anchorTrust = assessScoreFollowTrust({
      anchors,
      timingMap,
      isDemoSession: true,
    })
    const anchorCounts = { manual: 0, auto: 0, demo: 2 }

    expect(anchorTrust.showCursor).toBe(true)
    expect(
      hasUsableScoreFollowAnchors({
        anchorCounts,
        anchorTrust,
        autoSetupAttempted: false,
      }),
    ).toBe(true)
    expect(
      shouldSkipAutoSetupScan({
        anchorCounts,
        anchorTrust,
        autoSetupAttempted: false,
      }),
    ).toBe(true)
    expect(
      shouldClearStaleScanningUi({
        setupPhase: 'running',
        semiAutoStatus: 'idle',
        hasUsableAnchors: true,
      }),
    ).toBe(true)
  })

  it('treats restored uploaded auto anchors as ready when setup was attempted', () => {
    const anchors = autoSystemAnchors()
    const anchorTrust = assessScoreFollowTrust({
      anchors,
      timingMap,
      isDemoSession: false,
    })
    const anchorCounts = { manual: 0, auto: 2, demo: 0 }

    expect(anchorTrust.showCursor).toBe(true)
    expect(
      hasUsableScoreFollowAnchors({
        anchorCounts,
        anchorTrust,
        autoSetupAttempted: true,
      }),
    ).toBe(true)
    expect(
      shouldSkipAutoSetupScan({
        anchorCounts,
        anchorTrust,
        autoSetupAttempted: true,
      }),
    ).toBe(true)
  })

  it('clears stale scanning UI when anchors become usable', () => {
    expect(
      shouldClearStaleScanningUi({
        setupPhase: 'running',
        semiAutoStatus: 'analyzing',
        hasUsableAnchors: true,
      }),
    ).toBe(true)
    expect(
      shouldClearStaleScanningUi({
        setupPhase: 'ready',
        semiAutoStatus: 'idle',
        hasUsableAnchors: true,
      }),
    ).toBe(false)
  })

  it('does not let stale scanning override ready when anchors are usable', () => {
    const anchors = autoSystemAnchors()
    const anchorTrust = assessScoreFollowTrust({
      anchors,
      timingMap,
      isDemoSession: false,
    })
    const usable = hasUsableScoreFollowAnchors({
      anchorCounts: { auto: 2 },
      anchorTrust,
      autoSetupAttempted: true,
    })

    expect(usable).toBe(true)
    expect(
      shouldClearStaleScanningUi({
        setupPhase: 'running',
        semiAutoStatus: 'analyzing',
        hasUsableAnchors: usable,
      }),
    ).toBe(true)
    expect(
      shouldSkipAutoSetupScan({
        force: false,
        anchorCounts: { auto: 2 },
        anchorTrust,
        autoSetupAttempted: true,
      }),
    ).toBe(true)
  })

  it('still allows forced re-run auto setup when anchors already exist', () => {
    const anchors = autoSystemAnchors()
    const anchorTrust = assessScoreFollowTrust({
      anchors,
      timingMap,
      isDemoSession: false,
    })

    expect(
      shouldSkipAutoSetupScan({
        force: true,
        anchorCounts: { auto: 2 },
        anchorTrust,
        autoSetupAttempted: true,
      }),
    ).toBe(false)
  })

  it('keeps scanning when no anchors are usable yet', () => {
    expect(
      hasUsableScoreFollowAnchors({
        anchorCounts: { auto: 0, demo: 0, manual: 0 },
        anchorTrust: { showCursor: false },
        autoSetupAttempted: false,
      }),
    ).toBe(false)
    expect(
      shouldClearStaleScanningUi({
        setupPhase: 'running',
        semiAutoStatus: 'analyzing',
        hasUsableAnchors: false,
      }),
    ).toBe(false)
  })

  it('does not auto-run generic score-follow setup for experimental OMR on Practice mount', () => {
    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollow.js'),
      'utf8',
    )
    expect(src).toMatch(/!autoSetupGateOpen\s*\|\|\s*experimentalOmrPlayback/)
    expect(src).toMatch(/cancelSemiAutoSetup/)
  })

  it('keeps experimental OMR score-follow setup bounded and retryable', () => {
    expect(OMR_AUTO_SETUP_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    expect(OMR_AUTO_SETUP_TIMEOUT_MS).toBeLessThanOrEqual(15_000)

    const src = readFileSync(
      join(__dir, '..', 'src', 'features', 'score-follow', 'useScoreFollow.js'),
      'utf8',
    )
    expect(src).toMatch(/experimentalOmrPlayback\s*\?\s*OMR_AUTO_SETUP_TIMEOUT_MS/)
    expect(src).toMatch(/Promise\.race\(\[analysisPromise, timeoutPromise\]\)/)
    expect(src).toMatch(/SCORE_FOLLOW_OMR_SETUP_FAILED/)
  })

  it('disables Wait For You for generated OMR until score-follow can follow', () => {
    const provider = readFileSync(
      join(__dir, '..', 'src', 'context', 'PracticeSessionContext.jsx'),
      'utf8',
    )
    const controls = readFileSync(
      join(__dir, '..', 'src', 'components', 'practice', 'PracticeControlPanel.jsx'),
      'utf8',
    )
    const modeSection = readFileSync(
      join(__dir, '..', 'src', 'components', 'practice', 'PracticeModeSection.jsx'),
      'utf8',
    )

    expect(provider).toMatch(/experimentalOmrPlayback[\s\S]*session\.isWaitForYou[\s\S]*!scoreFollow\.canFollow/)
    expect(provider).toMatch(/session\.setPracticeMode\(PRACTICE_MODE\.NORMAL\)/)
    expect(controls).toMatch(/scoreFollow\?\.experimentalOmrPlayback[\s\S]*!scoreFollow\?\.canFollow/)
    expect(modeSection).toMatch(/mode === PRACTICE_MODE\.WAIT_FOR_YOU && waitForYouDisabled/)
  })
})
