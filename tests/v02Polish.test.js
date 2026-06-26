/**
 * v0.2 polish — UI/CSS regressions for: stale-warning clearing, temporary
 * approximate hint, sidebar filename overflow, and calibration overlay polish.
 * Source/CSS assertions (the suite runs in a node env without a DOM renderer).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...p) => readFileSync(join(root, 'src', ...p), 'utf8')

describe('stale score-follow warning clears on a new file (issue 1)', () => {
  const hook = readSrc('features', 'score-follow', 'useScoreFollow.js')

  it('resets setup status and semi-auto state in the autoSetupKey reset effect', () => {
    // The effect keyed on autoSetupKey already clears reports/overlay; it must
    // also clear the previous piece's warning so it cannot linger on a new one.
    const effect = hook.slice(
      hook.indexOf('setShowCalibrationOverlay(CALIBRATION_OVERLAY_DEFAULT_VISIBLE)'),
      hook.indexOf('}, [autoSetupKey])'),
    )
    expect(effect).toMatch(/setSemiAutoSetup\(idleSemiAutoSetupState\(\)\)/)
    expect(effect).toMatch(/setSetupStatus\(\{\s*phase:\s*'idle'/)
  })
})

describe('approximate cursor hint is temporary (issue 2)', () => {
  const hint = readSrc('components', 'practice', 'ScoreFollowApproximateHint.jsx')
  const panel = readSrc('components', 'practice', 'PracticeSetupPanel.jsx')
  const css = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')

  it('auto-dismisses after a delay and re-shows when the label changes', () => {
    expect(hint).toMatch(/setTimeout\(/)
    expect(hint).toMatch(/score-follow-approximate-hint--dismissed/)
    expect(hint).toMatch(/\[label, visibleMs\]/) // timer resets on label change
    expect(hint).toMatch(/if \(!label\)/) // renders nothing without a label
  })

  it('the setup panel renders the hint component, not a persistent paragraph', () => {
    expect(panel).toMatch(/ScoreFollowApproximateHint/)
    expect(panel).not.toMatch(/<p[^>]*>\s*\{scoreFollow\.followApproximateLabel\}/)
  })

  it('CSS fades the dismissed hint out', () => {
    expect(css).toMatch(/\.score-follow-approximate-hint\s*\{[^}]*transition/)
    expect(css).toMatch(/\.score-follow-approximate-hint--dismissed\s*\{[^}]*opacity:\s*0/)
  })
})

describe('sidebar filename overflow (issue 3)', () => {
  const summary = readSrc('components', 'practice', 'PracticeFilesSummary.jsx')
  const notices = readSrc('components', 'practice', 'PracticeImportNotices.jsx')
  const css = readFileSync(join(root, 'src', 'styles', 'practice.css'), 'utf8')

  it('adds full-name tooltips to each file value', () => {
    expect(summary).toMatch(/title=\{pdfFileName \|\| undefined\}/)
    expect(summary).toMatch(/title=\{hasMusicXml \? timingFileName \|\| undefined : undefined\}/)
    expect(summary).toMatch(/title=\{hasMidi \? playbackFileName \|\| undefined : undefined\}/)
  })

  it('marks filename values with truncation class', () => {
    expect(summary).toMatch(/practice-files__value--truncate/)
    expect(summary.match(/practice-files__value--truncate/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('marks warning and notes text for wrapping', () => {
    expect(summary).toMatch(/practice-files__hint--wrap/)
    expect(notices).toMatch(/practice-import-notices__warning--wrap/)
    expect(notices).toMatch(/practice-import-notices__guidance-item/)
  })

  it('lets the files panel shrink so long names truncate instead of overflowing', () => {
    const block = css.slice(css.indexOf('.practice-files {'), css.indexOf('.practice-files__item--ok'))
    expect(block).toMatch(/\.practice-files\s*\{[^}]*min-width:\s*0/)
    expect(block).toMatch(/max-width:\s*100%/)
    expect(block).toMatch(/overflow:\s*hidden/)
    expect(block).toMatch(/\.practice-files__item\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.practice-files__value--truncate\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.practice-files__hint--wrap[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.practice-import-notices__warning--wrap[^}]*word-break:\s*break-word/)
    expect(css).toMatch(/\.practice-more\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.practice-control-panel__footer[^}]*overflow-x:\s*hidden/)
  })
})

describe('calibration overlay polish (issue 5)', () => {
  const overlay = readSrc('components', 'pdf', 'CalibrationDebugOverlay.jsx')
  const calibrationDebug = readSrc('features', 'score-follow', 'calibrationDebug.js')
  const css = readFileSync(join(root, 'src', 'App.css'), 'utf8')

  it('hidden by default', () => {
    expect(calibrationDebug).toMatch(/CALIBRATION_OVERLAY_DEFAULT_VISIBLE\s*=\s*false/)
    expect(overlay).toMatch(/visible = false/)
  })

  it('renders a color legend', () => {
    expect(overlay).toMatch(/calibration-debug-overlay__legend/)
    expect(overlay).toMatch(/System bounds/)
    expect(overlay).toMatch(/Ink extent/)
    expect(overlay).toMatch(/Measure anchor/)
    expect(css).toMatch(/\.calibration-debug-overlay__legend\s*\{/)
  })

  it('uses smaller anchors and lower overlay opacity', () => {
    expect(overlay).toMatch(/r="0\.45"/) // was 0.9
    expect(css).toMatch(/\.calibration-debug-overlay\s*\{[^}]*opacity:\s*0\.55/)
  })
})
