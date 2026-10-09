import { describe, expect, it } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { resolveNoteTargetPosition } from '../src/features/practice/noteTargetPosition.js'
import { SCORE_NOTE_STATE } from '../src/features/practice/scoreNoteStates.js'
import ScoreFollowOverlay from '../src/components/pdf/ScoreFollowOverlay.jsx'
import * as F from './helpers/buildXml.js'

globalThis.React = React

function timingForMelody() {
  return parseMusicXml(F.straight4())
}

function anchors() {
  return [
    { page: 1, x: 0.1, y: 0.5, measureNumber: 1, source: 'manual' },
    { page: 1, x: 0.9, y: 0.5, measureNumber: 2, source: 'manual' },
  ]
}

function overlayProps(entries) {
  return {
    pageNumber: 1,
    alignmentMode: false,
    showAnchorMarkers: false,
    showSystemBands: false,
    pageSystems: [],
    placementMeasureNumber: 1,
    cursorVisibility: { show: true },
    cursor: { visible: true, page: 1, x: 0.2, y: 0.5 },
    noteTarget: null,
    showNoteTarget: false,
    anchors: anchors(),
    scoreNoteStates: entries,
    showScoreNoteStates: entries.length > 0,
    viewerRotation: 0,
  }
}

describe('score overlay note states', () => {
  it('renders WFY current + completed with distinct states', () => {
    const timingMap = timingForMelody()
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints.length).toBeGreaterThanOrEqual(2)

    const entries = [0, 1].map((index) => {
      const checkpoint = checkpoints[index]
      const target = resolveNoteTargetPosition({
        checkpoint,
        timingMap,
        anchors: anchors(),
        mode: 'wait-for-you',
      })
      expect(target.visible).toBe(true)
      return {
        key: `wfy:${checkpoint.id}`,
        checkpoint,
        target,
        state: index === 0 ? SCORE_NOTE_STATE.COMPLETED : SCORE_NOTE_STATE.CURRENT,
        toneStates: null,
      }
    })

    const markup = renderToStaticMarkup(createElement(ScoreFollowOverlay, overlayProps(entries)))
    expect(markup).toContain('data-score-note-state="completed"')
    expect(markup).toContain('data-score-note-state="current"')
    expect(markup).toContain('score-follow-overlay__note-highlight--state-completed')
    expect(markup).toContain('score-follow-overlay__note-highlight--state-current')
    // Non-color "play now" marker on the required event only.
    expect(markup).toContain('score-follow-overlay__now-tick')
    // Accessibility: state is announced, not color-only.
    expect(markup).toContain('Played')
    expect(markup).toContain('Play')
  })

  it('renders chord partials per tone only from owned source noteheads', () => {
    const timingMap = timingForMelody()
    const checkpoints = buildNoteCheckpoints(timingMap)
    const checkpoint = {
      ...checkpoints[0],
      expectedMidis: [60, 64, 67],
      isChord: true,
    }
    const target = resolveNoteTargetPosition({
      checkpoint,
      timingMap,
      anchors: anchors(),
      mode: 'wait-for-you',
    })
    expect(target.visible).toBe(true)
    const entries = [
      {
        key: 'wfy:chord',
        checkpoint,
        target,
        state: SCORE_NOTE_STATE.CURRENT_PARTIAL,
        toneStates: [
          { midi: 60, index: 0, completed: true },
          { midi: 64, index: 1, completed: true },
          { midi: 67, index: 2, completed: false },
        ],
      },
    ]
    const markup = renderToStaticMarkup(createElement(ScoreFollowOverlay, overlayProps(entries)))
    // Approximate (non-source) highlights must NOT invent per-tone boxes.
    if (target.highlight?.renderMode === 'individual-source-boxes') {
      expect(markup).toContain('score-follow-overlay__note-highlight--tone-done')
      expect(markup).toContain('score-follow-overlay__note-highlight--tone-needed')
      expect(markup).toContain('2 of 3 tones played')
    } else {
      expect(markup).not.toContain('score-follow-overlay__note-highlight--tone-done')
      expect(markup).toContain('data-score-note-state="current-partial"')
    }
  })

  it('renders play-along wrong flashes and muted past misses', () => {
    const timingMap = timingForMelody()
    const checkpoints = buildNoteCheckpoints(timingMap)
    const entries = [0, 1].map((index) => ({
      key: `pa:${index}`,
      checkpoint: checkpoints[index],
      target: resolveNoteTargetPosition({
        checkpoint: checkpoints[index],
        timingMap,
        anchors: anchors(),
        mode: 'play-along',
      }),
      state: index === 0 ? SCORE_NOTE_STATE.MISSED : SCORE_NOTE_STATE.WRONG,
      toneStates: null,
    }))
    const markup = renderToStaticMarkup(createElement(ScoreFollowOverlay, overlayProps(entries)))
    expect(markup).toContain('data-score-note-state="missed"')
    expect(markup).toContain('data-score-note-state="wrong"')
    expect(markup).toContain('score-follow-overlay__note-highlight--state-missed')
    expect(markup).toContain('score-follow-overlay__note-highlight--state-wrong')
  })

  it('renders nothing extra when states are disabled', () => {
    const markup = renderToStaticMarkup(
      createElement(ScoreFollowOverlay, {
        ...overlayProps([]),
        cursorVisibility: { show: false },
        cursor: { visible: false },
      }),
    )
    expect(markup).toBe('')
  })
})
