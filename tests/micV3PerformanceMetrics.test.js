import { describe, expect, it } from 'vitest'
import {
  evaluateMicV3PerformanceClip,
  formatMicV3PerformanceMetricsMarkdown,
  summarizeMicV3PerformanceMetrics,
} from '../src/features/microphone-input/v3/performanceMetrics.js'

function frame(timeMs, detectedMidis, expectedMidis) {
  return {
    timeMs,
    detectedMidis,
    notes: expectedMidis.map((midi) => ({
      midi,
      detected: detectedMidis.includes(midi),
      confidence: detectedMidis.includes(midi) ? 0.92 : 0.1,
      ratio: detectedMidis.includes(midi) ? 4.2 : 0.8,
    })),
  }
}

describe('Mic V3 performance metrics', () => {
  it('measures staggered guitar double-stop completion from an explicit onset', () => {
    const clip = {
      id: 'guitar-double-stop',
      label: 'chord',
      instrument: 'guitar',
      tone: 'acoustic-guitar',
      expectedMidis: [55, 59],
      expectedStringFrets: [
        { midi: 55, string: 3, fret: 0 },
        { midi: 59, string: 2, fret: 0 },
      ],
      performanceOnsetMs: 40,
    }
    const evaluation = evaluateMicV3PerformanceClip(clip, {
      frames: [frame(40, [55], clip.expectedMidis), frame(70, [55, 59], clip.expectedMidis)],
      stableDetections: [],
    })

    expect(evaluation.accepted).toBe(true)
    expect(evaluation.category).toBe('double-stop')
    expect(evaluation.firstAttemptSuccess).toBe(true)
    expect(evaluation.confirmationLatencyMs).toBe(30)
    expect(evaluation.chordCompletionLatencyMs).toBe(30)
    expect(evaluation.falseAdvance).toBe(false)
  })

  it('keeps an incomplete four-note piano event as an explicit false reject', () => {
    const clip = {
      id: 'piano-cmaj7-missing-e',
      label: 'chord',
      instrument: 'piano',
      expectedMidis: [60, 64, 67, 71],
      performanceOnsetMs: 0,
    }
    const evaluation = evaluateMicV3PerformanceClip(clip, {
      frames: [frame(0, [60, 67, 71], clip.expectedMidis)],
      stableDetections: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.falseReject).toBe(true)
    expect(evaluation.missingMidis).toEqual([64])
    expect(evaluation.category).toBe('large-chord')
  })

  it('counts a stable pitch on a control as a false advance', () => {
    const evaluation = evaluateMicV3PerformanceClip(
      { id: 'room-noise', label: 'noise', instrument: 'piano' },
      { frames: [], stableDetections: [{ midi: 60 }] },
    )
    expect(evaluation.falseAdvance).toBe(true)
    expect(evaluation.correctReject).toBe(false)
  })

  it('summarizes required reliability slices without hiding invalid onset annotations', () => {
    const accepted = {
      clipId: 'accepted',
      label: 'chord',
      instrument: 'guitar',
      category: 'double-stop',
      accepted: true,
      firstAttemptSuccess: true,
      falseAdvance: false,
      falseReject: false,
      quiet: true,
      toneClass: 'electric',
      ringingTransition: true,
      naturalPerformance: false,
      latencyAnnotationValid: true,
      confirmationLatencyMs: 35,
      chordCompletionLatencyMs: 20,
      matchedMidis: [45, 52],
      expectedMidis: [45, 52],
      finalReason: 'expected-guitar-event-complete',
    }
    const invalid = {
      ...accepted,
      clipId: 'invalid-onset',
      category: 'triad',
      confirmationLatencyMs: -80,
      latencyAnnotationValid: false,
    }
    const control = {
      clipId: 'control',
      label: 'noise',
      category: 'control',
      accepted: false,
      correctReject: true,
      falseAdvance: false,
      falseReject: false,
      firstAttemptSuccess: false,
      quiet: false,
      toneClass: null,
      ringingTransition: false,
      naturalPerformance: false,
      latencyAnnotationValid: true,
      confirmationLatencyMs: null,
      chordCompletionLatencyMs: null,
      matchedMidis: [],
      expectedMidis: [],
      finalReason: 'control-correct-reject',
    }
    const summary = summarizeMicV3PerformanceMetrics([accepted, invalid, control])

    expect(summary.firstAttemptSuccessRate).toBe(1)
    expect(summary.averageConfirmationLatencyMs).toBe(35)
    expect(summary.invalidLatencyAnnotationCount).toBe(1)
    expect(summary.doubleStopAccuracy.successRate).toBe(1)
    expect(summary.falseAdvanceCount).toBe(0)
    expect(formatMicV3PerformanceMetricsMarkdown(summary)).toContain('Proxy results are not described')
  })
})
