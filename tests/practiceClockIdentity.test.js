// @vitest-environment happy-dom
/**
 * Practice-clock identity regression.
 *
 * usePracticeClock sits in the practice session's dependency array, so a fresh
 * object literal on every render used to rebuild the session memo, the provider
 * value and every practice subscriber at the audio progress-tick rate. That
 * churn is what produced the intermittent "Maximum update depth exceeded"
 * warning: a setState inside an effect keyed on context identity then recursed.
 *
 * Renders the real hook and asserts the returned identity is stable whenever no
 * real input changed, and moves only when a value actually changes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import usePracticeClock from '../src/features/practice/usePracticeClock.js'

// React 18+ requires this flag before act() may flush effects.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function renderClock(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const seen = []
  function Probe(value) {
    seen.push(usePracticeClock(value))
    return null
  }
  act(() => {
    root.render(createElement(Probe, props))
  })
  const rerender = (next) => {
    act(() => {
      root.render(createElement(Probe, next))
    })
  }
  return {
    get latest() {
      return seen[seen.length - 1]
    },
    get identities() {
      return seen
    },
    rerender,
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('usePracticeClock identity', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns a stable identity while nothing changed', () => {
    const probe = renderClock({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 4,
      sourcesRevision: 'score-1',
    })
    const first = probe.latest
    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 4,
      sourcesRevision: 'score-1',
    })
    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 4,
      sourcesRevision: 'score-1',
    })
    expect(probe.identities.length).toBe(3)
    // Same object: downstream useMemos do not recompute.
    expect(probe.latest).toBe(first)
    // Paused with MusicXML: the clock reports manual time, not the old
    // playback position (0 until the user scrubs).
    expect(first.practiceTime).toBe(0)
    expect(first.isFollowingPlayback).toBe(false)
    expect(first.canManualScrub).toBe(true)
    probe.unmount()
  })

  it('moves the identity only when a real value changes', () => {
    const probe = renderClock({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 4,
      sourcesRevision: 'score-1',
    })
    const paused = probe.latest
    expect(paused.practiceTime).toBe(0)

    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: true,
      playbackCurrentTime: 7.5,
      sourcesRevision: 'score-1',
    })
    const playing = probe.latest
    expect(playing).not.toBe(paused)
    expect(playing.practiceTime).toBe(7.5)
    expect(playing.isFollowingPlayback).toBe(true)
    // Stable across repeated ticks at the same time.
    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: true,
      playbackCurrentTime: 7.5,
      sourcesRevision: 'score-1',
    })
    expect(probe.latest).toBe(playing)
    // A new score revision resets manual time but keeps the same members.
    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 0,
      sourcesRevision: 'score-2',
    })
    expect(probe.latest).not.toBe(playing)
    expect(probe.latest.practiceTime).toBe(0)
    probe.unmount()
  })

  it('exposes stable setters so callers can keep them out of dependency arrays', () => {
    const probe = renderClock({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 1,
      sourcesRevision: 's',
    })
    const { setManualTime, syncManualTimeToPlayback } = probe.latest
    probe.rerender({
      hasMidi: false,
      hasMusicXml: true,
      isPlaying: false,
      playbackCurrentTime: 1,
      sourcesRevision: 's',
    })
    expect(probe.latest.setManualTime).toBe(setManualTime)
    expect(probe.latest.syncManualTimeToPlayback).toBe(syncManualTimeToPlayback)
    probe.unmount()
  })
})
