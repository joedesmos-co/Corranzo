/**
 * Practice Page Simplification Pass — the default Practice view shows only
 * primary controls (Play, Mode, current WFY target, view switch); Loop,
 * Session stats, Cursor options, and the input chooser rest behind summaries.
 * Node-env suite, so these are source-level guardrails like the other UI
 * passes: they assert the wiring, not a rendered DOM.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('practice default view is decluttered', () => {
  it('collapses Loop behind a summary row that mirrors loop state', () => {
    const loop = readSrc('components', 'practice', 'PracticeLoopCompactSection.jsx')
    expect(loop).toContain('<PracticeCollapsibleSection')
    expect(loop).toContain('title="Loop"')
    expect(loop).toContain('summary={loopSummary(loop)}')
    // An active loop auto-expands its section; otherwise it stays collapsed.
    expect(loop).toContain('defaultOpen={loop.enabled}')
    expect(loop).toContain("'Off'")
  })

  it('collapses Session stats out of the default view', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toContain('title="Session stats"')
    expect(panel).toContain('summary="Saved locally"')
    expect(panel).toContain('showHeader={false}')

    const stats = readSrc('components', 'practice', 'PracticeStatsCard.jsx')
    expect(stats).toContain('showHeader = true')
    expect(stats).toContain('practice-stats-card--flat')
  })

  it('reduces Cursor to a status summary that expands on demand', () => {
    const cursor = readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')
    expect(cursor).toContain('practice-score-cursor__details')
    expect(cursor).toContain('<summary className="practice-score-cursor__summary">')
    // Tutorial target stays on the always-visible section root.
    expect(cursor).toContain('data-tour-id="score-cursor"')
    expect(cursor).toContain('Show cursor on score')
  })

  it('keeps one obvious primary action during Wait For You', () => {
    const transport = readSrc('components', 'practice', 'PracticeTransportSection.jsx')
    // The transport shows the status chip only — no duplicate Continue.
    expect(transport).toContain('Wait For You active')
    expect(transport).toContain('{!waitForYouActive && (')
    expect(transport).not.toContain('onWaitForYouContinue')

    const wfy = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(wfy).toContain('className="wait-for-you__btn wait-for-you__btn--primary"')
  })

  it('does not repeat the add-a-timing-file hint in Mode', () => {
    const mode = readSrc('components', 'practice', 'PracticeModeSection.jsx')
    expect(mode).toMatch(/if \(!hasMusicXml\) \{\s*return null/)
    const transport = readSrc('components', 'practice', 'PracticeTransportSection.jsx')
    expect(transport).toContain('Add a timing file in Library to enable practice.')
  })
})

describe('controls are contextual, not always-on', () => {
  it('Play Along renders no WFY-only controls', () => {
    const wfy = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(wfy).toMatch(/if \(!active\) \{\s*return null/)
  })

  it('Wait For You mode shows the WFY section wired from the session', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toContain('<WaitForYouSection')
    expect(panel).toContain('active={session.waitForYou.active}')
    expect(panel).toContain('<PracticeScopeSection')
    expect(panel).toContain('visible={session.practiceScopeAvailable}')
  })

  it('mic/MIDI status panels appear only for the chosen WFY input source', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toMatch(/midiWaitForYouActive && \(\s*<MidiInputStatusPanel/)
    expect(panel).toMatch(/micWaitForYouActive && \(\s*<MicrophoneInputStatusPanel/)
    expect(panel).toMatch(/wfyInputSource === WFY_INPUT_SOURCE\.MIDI/)
    expect(panel).toMatch(/wfyInputSource === WFY_INPUT_SOURCE\.MICROPHONE/)
  })

  it('keeps the input-source modal wiring intact', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toContain('<WaitForYouInputSourceModal')
    expect(panel).toContain('open={session.showWfyInputSourceModal}')
    expect(panel).toContain('onChooseSource={session.setWfyInputSource}')
  })

  it('collapses the in-panel input chooser to a one-line summary', () => {
    const selector = readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')
    expect(selector).toContain('<details className="wfy-input-source wfy-input-source--compact"')
    expect(selector).toContain('wfy-input-source__summary')
    expect(selector).toContain('wfyInputSourceLabel(inputSource, instrumentId)')
    expect(selector).toContain('Input: {currentLabel}')
    expect(selector).toContain('wfy-input-source__change')
    expect(selector).not.toContain("How you'll play")
    // The full chooser is still inside, unchanged.
    expect(selector).toContain('role="radiogroup"')
    expect(selector).toContain('data-tour-id="practice-input-source"')
  })

  it('shows the guitar notation/TAB target only when the piece has both', () => {
    const cursor = readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')
    expect(cursor).toContain('Boolean(targetPreference?.selectable)')
    expect(cursor).toMatch(/\{showTargetPreference && \(/)
  })

  it('hides structurally unavailable WFY actions instead of stacking disabled buttons', () => {
    const wfy = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(wfy).toContain('const structurallyDone =')
    // Whole actions row disappears when there is nothing to practice.
    expect(wfy).toMatch(/status !== WFY_STATUS\.NO_CHECKPOINTS && \(\s*<div className="wait-for-you__actions">/)
    // Hear it / Show hint / Skip hide once the run is complete…
    expect(wfy).toMatch(/\{!structurallyDone && checkpointMode === WFY_CHECKPOINT_MODE\.NOTE && currentCheckpoint && \(/)
    expect(wfy).toMatch(/\{!structurallyDone && onSkip && \(/)
    // …while Restart stays as the single follow-up action.
    expect(wfy).toMatch(/\{totalCheckpoints > 0 && \(\s*<button type="button" className="wait-for-you__btn" onClick=\{onRestart\}>/)
    expect(wfy).not.toContain('wait-for-you__primary-action')
    expect(wfy).toMatch(/className="wait-for-you__btn wait-for-you__btn--primary"[\s\S]*Continue/)
  })
})

describe('expanded sections keep full functionality', () => {
  it('loop controls stay complete inside the collapsed section', () => {
    const loop = readSrc('components', 'practice', 'PracticeLoopCompactSection.jsx')
    for (const wiring of [
      'onSnapModeChange={loop.setLoopSnapMode}',
      'onSetStart={loop.setStartFromCurrent}',
      'onSetEnd={loop.setEndFromCurrent}',
      'onClear={loop.clearLoop}',
      'loop.setLoopEnabled(event.target.checked)',
    ]) {
      expect(loop).toContain(wiring)
    }
    expect(loop).toContain('Loop range sets which notes Wait For You stops at.')
  })

  it('cursor controls stay complete inside the disclosure', () => {
    const cursor = readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')
    expect(cursor).toContain('scoreFollow.setEnabled(event.target.checked)')
    expect(cursor).toContain('targetPreference.setTarget(option.target)')
    expect(cursor).toContain('Cursor setup failed — open Advanced → Practice setup.')
  })

  it('collapsible sections stay accessible', () => {
    const collapsible = readSrc('components', 'practice', 'PracticeCollapsibleSection.jsx')
    expect(collapsible).toContain('aria-expanded={open}')
    expect(collapsible).toContain('aria-controls={panelId}')
    expect(collapsible).toContain('aria-label={ariaLabel ?? undefined}')

    // Section labels preserved from the pre-collapse markup.
    expect(readSrc('components', 'practice', 'PracticeLoopCompactSection.jsx')).toContain(
      'ariaLabel="Loop"',
    )
    expect(readSrc('components', 'practice', 'PracticeControlPanel.jsx')).toContain(
      'ariaLabel="Practice stats"',
    )
    expect(readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')).toContain(
      'aria-label="Score cursor"',
    )
  })
})

describe('responsive layout holds with the collapsed sections', () => {
  const practiceCss = readSrc('styles', 'practice.css')

  const blockFor = (selector) => {
    const start = practiceCss.indexOf(selector)
    expect(start).toBeGreaterThan(-1)
    return practiceCss.slice(start, practiceCss.indexOf('}', start) + 1)
  }

  it('panel children still shrink horizontally without overflow', () => {
    const shared = blockFor('.practice-control-panel__primary,')
    expect(shared).toMatch(/overflow-x:\s*hidden/)
    expect(shared).toMatch(/max-width:\s*100%/)
  })

  it('collapsed sections span the portrait two-column grid', () => {
    expect(practiceCss).toMatch(
      /\.practice-control-panel__primary > \.practice-section--collapsible \{\s*grid-column: 1 \/ -1;/,
    )
    expect(practiceCss).toContain('.practice-control-panel__primary > .practice-scope')
  })

  it('new summary rows use flexible layout without fixed widths', () => {
    for (const selector of [
      '.practice-score-cursor__summary {',
      '.wfy-input-source__summary {',
    ]) {
      const block = blockFor(selector)
      expect(block).toMatch(/display:\s*(inline-)?flex/)
      expect(block).not.toMatch(/[^-]width:\s*\d/)
    }
  })

  it('adds no gradients in the new rules', () => {
    for (const selector of [
      '.practice-score-cursor__summary {',
      '.wfy-input-source__summary {',
      '.wfy-input-source__current {',
      '.practice-stats-card--flat {',
      '.practice-loop-compact {',
    ]) {
      const block = blockFor(selector)
      expect(block).not.toMatch(/gradient/)
    }
  })
})
