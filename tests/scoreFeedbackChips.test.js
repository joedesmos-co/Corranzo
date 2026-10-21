import { describe, expect, it } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ScoreFeedbackChips from '../src/components/practice/ScoreFeedbackChips.jsx'
import { SCORE_NOTE_STATE } from '../src/features/practice/scoreNoteStates.js'
import { NOTEHEAD_FEEDBACK_COLORS } from '../src/features/practice/noteheadFeedback.js'

globalThis.React = React

function checkpoint(id, expectedMidis, extra = {}) {
  return {
    id,
    expectedMidis,
    isChord: expectedMidis.length > 1,
    measureNumber: 1,
    displayLabel: expectedMidis.join(' '),
    ...extra,
  }
}

function render(entries, props = {}) {
  return renderToStaticMarkup(createElement(ScoreFeedbackChips, { entries, ...props }))
}

describe('practice feedback chips (PDF practice controls)', () => {
  it('marks a played note blue, using the engraved-surface palette', () => {
    const markup = render([
      {
        key: 'wfy:1',
        checkpoint: checkpoint('c1', [60]),
        state: SCORE_NOTE_STATE.COMPLETED,
        toneStates: null,
      },
    ])
    expect(markup).toContain('data-score-feedback-state="completed"')
    expect(markup).toContain('data-score-feedback-midi="60"')
    // The chip palette is the SAME palette the engraved surface paints on the
    // real notehead glyphs.
    expect(markup).toContain(NOTEHEAD_FEEDBACK_COLORS.correct)
    expect(markup).toContain('C4')
  })

  it('never colours a chord member the musician has not played', () => {
    const markup = render([
      {
        key: 'wfy:chord',
        checkpoint: checkpoint('c2', [60, 64, 67]),
        state: SCORE_NOTE_STATE.CURRENT_PARTIAL,
        toneStates: [
          { midi: 60, index: 0, completed: true },
          { midi: 64, index: 1, completed: true },
          { midi: 67, index: 2, completed: false },
        ],
      },
    ])
    // One chip per chord member.
    expect(markup.split('data-score-feedback-midi=').length - 1).toBe(3)
    // Exactly the two recognised members are painted blue.
    expect(markup.split(`background:${NOTEHEAD_FEEDBACK_COLORS.correct}`).length - 1).toBe(2)
    // The unplayed member is present but NOT blue.
    expect(markup).toContain('data-score-feedback-midi="67"')
    const unplayed = markup.slice(markup.indexOf('data-score-feedback-midi="67"'))
    expect(unplayed.slice(0, 200)).not.toContain(NOTEHEAD_FEEDBACK_COLORS.correct)
  })

  it('marks a wrong attempt and a miss red', () => {
    const markup = render([
      {
        key: 'pa:0',
        checkpoint: checkpoint('c3', [62]),
        state: SCORE_NOTE_STATE.WRONG,
        toneStates: null,
      },
      {
        key: 'pa:1',
        checkpoint: checkpoint('c4', [64]),
        state: SCORE_NOTE_STATE.MISSED,
        toneStates: null,
      },
    ])
    expect(markup).toContain(NOTEHEAD_FEEDBACK_COLORS.missed)
    expect(markup).toContain('Try again')
    expect(markup).toContain('Missed')
  })

  it('gives every repeated note its own chip, in order', () => {
    const markup = render([
      { key: 'a', checkpoint: checkpoint('r1', [60]), state: SCORE_NOTE_STATE.COMPLETED },
      { key: 'b', checkpoint: checkpoint('r2', [60]), state: SCORE_NOTE_STATE.COMPLETED },
      { key: 'c', checkpoint: checkpoint('r3', [62]), state: SCORE_NOTE_STATE.CURRENT },
    ])
    expect(markup.split('data-score-feedback-midi="60"').length - 1).toBe(2)
    expect(markup.split('data-score-feedback-midi="62"').length - 1).toBe(1)
    // The pending note comes after the two played ones.
    expect(markup.indexOf('data-score-feedback-midi="62"')).toBeGreaterThan(
      markup.lastIndexOf('data-score-feedback-midi="60"'),
    )
  })

  it('renders nothing when there is nothing to report', () => {
    expect(render([])).toBe('')
  })
})
