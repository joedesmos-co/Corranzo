/**
 * Wait For You setup simplification + Chrome "too quiet" plumbing.
 *
 * Source-level guardrails (the suite runs in a node env, so these assert on the
 * wiring rather than a rendered DOM): a beginner-simple Mic/MIDI choice that
 * auto-starts, raw instrument capture, a collapsed Troubleshooting drawer, and
 * a stable window.SCOREFLOW_MIC_DEBUG for diagnosing input in any build.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('mic capture asks for raw instrument input', () => {
  const capture = readSrc('features', 'microphone-input', 'useMicrophoneCapture.js')

  it('disables Chrome speech processing that suppresses sustained tones', () => {
    expect(capture).toContain('echoCancellation: false')
    expect(capture).toContain('noiseSuppression: false')
    expect(capture).toContain('autoGainControl: false')
    expect(capture).toContain('INSTRUMENT_AUDIO_CONSTRAINTS')
  })

  it('falls back to default constraints if the raw-input hint is rejected', () => {
    expect(capture).toContain('acquireInstrumentStream')
    expect(capture).toContain("getUserMedia({ audio: true, video: false })")
  })

  it('exposes the applied capture settings for diagnostics', () => {
    expect(capture).toContain('readCaptureSettings')
    expect(capture).toContain('captureSettings')
  })
})

describe('choosing Microphone or MIDI is the whole setup', () => {
  it('offers two clear choices plus a quiet manual fallback', () => {
    const selector = readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')
    expect(selector).toContain('role="radiogroup"')
    expect(selector).toContain('Use Microphone')
    expect(selector).toContain('Use MIDI')
    expect(selector).toContain('No device')
  })

  it('auto-requests the microphone so calibration starts on its own', () => {
    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    expect(session).toContain('autoMicRequestedRef')
    expect(session).toContain('microphone.requestAccess()')
    expect(session).toContain('MIC_PERMISSION.PROMPT')
  })

  it('shows the calibrate-then-play copy states', () => {
    const calibration = readSrc('features', 'microphone-input', 'micCalibration.js')
    expect(calibration).toContain('Stay quiet for a moment…')
    expect(calibration).toContain('Ready — play the highlighted note')
  })
})

describe('microphone lifecycle follows Wait For You', () => {
  const session = readSrc('features', 'practice', 'usePracticeSession.js')
  const capture = readSrc('features', 'microphone-input', 'useMicrophoneCapture.js')

  it('only captures while in Wait For You with the mic source selected', () => {
    expect(session).toMatch(
      /micCaptureActive =[\s\S]*practiceActive[\s\S]*isWaitForYou[\s\S]*WFY_INPUT_SOURCE\.MICROPHONE/,
    )
  })

  it('tears the mic down when it becomes inactive (leaving WFY)', () => {
    expect(capture).toMatch(/if \(!active\)[\s\S]*teardown/)
  })

  it('stops the mic when switching away from the microphone source', () => {
    expect(session).toMatch(
      /handleWfyInputSourceChange[\s\S]*!== WFY_INPUT_SOURCE\.MICROPHONE[\s\S]*microphone\.disable\(\)/,
    )
  })
})

describe('advanced mic controls collapse under Troubleshooting', () => {
  const panel = readSrc('components', 'practice', 'MicrophoneInputStatusPanel.jsx')

  it('puts the test meter and details inside a Troubleshooting disclosure', () => {
    const summaryIndex = panel.indexOf('<summary>Troubleshooting</summary>')
    expect(summaryIndex).toBeGreaterThan(-1)
    expect(panel.indexOf('<MicTestPanel')).toBeGreaterThan(summaryIndex)
    expect(panel.indexOf('mic-input-status__grid')).toBeGreaterThan(summaryIndex)
    expect(panel.indexOf('Export mic debug JSON')).toBeGreaterThan(summaryIndex)
  })

  it('keeps the Advanced control-panel drawer separate from mic Troubleshooting', () => {
    const control = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(control).not.toContain('aria-label="Troubleshooting"')
  })
})

describe('mic diagnostics are inspectable in any build', () => {
  const hook = readSrc('features', 'practice', 'useWaitForYouMicInput.js')

  it('publishes a stable window.SCOREFLOW_MIC_DEBUG object', () => {
    expect(hook).toContain('globalThis.SCOREFLOW_MIC_DEBUG')
    expect(hook).toContain('exportLastFrames')
  })

  it('reports the fields needed to diagnose "too quiet"', () => {
    for (const field of [
      'rms:',
      'filteredRms:',
      'spectralEnergy:',
      'noiseFloor:',
      'gateOpen:',
      'signalShape:',
      'rejectReason:',
      'frequency:',
      'midiFloat:',
      'expectedMidis:',
      'instrumentId:',
      'inputSource:',
    ]) {
      expect(hook).toContain(field)
    }
  })

  it('threads the selected instrument into the detectors', () => {
    const detector = readSrc('features', 'microphone-input', 'useMicEngineV2Detector.js')
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(detector).toContain('getMicInstrumentProfile')
    expect(detector).toContain('gateOptions:')
    expect(mic).toContain('instrumentId')
    expect(mic).toContain('analysisKey:')
  })
})
