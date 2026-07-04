/**
 * Regression guard for React #301 (too many re-renders) in Wait For You wiring.
 *
 * The production crash came from unstable effect deps and object-identity feedback
 * tracking while Practice view mounted — not from Mic V2 detection itself.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { feedbackTrackingKey } from '../src/features/practice/useWaitForYouGuidance.js'
import { idleFeedbackForCheckpoint } from '../src/features/practice/waitForYouInputFeedback.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('feedbackTrackingKey', () => {
  const checkpoint = { expectedMidi: 60, isChord: false }

  it('treats semantically identical idle feedback as the same key', () => {
    const left = idleFeedbackForCheckpoint(checkpoint)
    const right = idleFeedbackForCheckpoint(checkpoint)
    expect(left).not.toBe(right)
    expect(feedbackTrackingKey(left)).toBe(feedbackTrackingKey(right))
  })

  it('changes when outcome or message changes', () => {
    const idle = idleFeedbackForCheckpoint(checkpoint)
    const wrong = { ...idle, outcome: 'wrong', message: 'Wrong note' }
    expect(feedbackTrackingKey(wrong)).not.toBe(feedbackTrackingKey(idle))
  })
})

describe('Wait For You render-loop guardrails', () => {
  it('tracks mic feedback resets by checkpoint id instead of object identity', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(mic).toContain('currentCheckpointRef')
    expect(mic).toMatch(/const resetFeedback = useCallback\([\s\S]*currentCheckpointRef\.current/)
    expect(mic).toMatch(/\[currentCheckpoint\?\.id, matchSettings, resetFeedback\]/)
    expect(mic).not.toMatch(/\[currentCheckpoint, resetMatchConfirm\]/)
    expect(mic).toContain('expectedMidisKey')
    expect(mic).toMatch(/expectedMidisKey\]\)/)
  })

  it('compares guidance feedback by semantic key, not object reference', () => {
    const guidance = readSrc('features', 'practice', 'useWaitForYouGuidance.js')
    expect(guidance).toContain('feedbackTrackingKey')
    expect(guidance).toContain('trackedFeedbackKey')
    expect(guidance).not.toMatch(/setTrackedFeedback[^K]/)
    expect(guidance).toMatch(/inputFeedbackKey !== trackedFeedbackKey/)
  })

  it('memoizes idle WFY input feedback in the practice session', () => {
    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    expect(session).toContain('idleWfyInputFeedback')
    expect(session).toMatch(/inputFeedback: idleWfyInputFeedback/)
    expect(session).not.toMatch(
      /if \(!wfyInputSourceReady\)[\s\S]*idleFeedbackForCheckpoint\(waitForYou\.currentCheckpoint\)/,
    )
    expect(session).toContain('waitForYouMic.inputFeedback')
    expect(session).not.toMatch(/waitForYouMic,\s*\n\s*waitForYouMidi,/)
  })
})
