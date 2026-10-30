/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/purity, react-hooks/refs */
/**
 * Physical microphone acceptance flow (RESEARCH ONLY — not product UI).
 *
 * Uses the REAL production capture hook and the REAL Wait For You mic hook
 * with the actual microphone (no injected audio). It records per-step
 * evidence plus input level, sample rate, device, calibration, expected vs
 * detected notes, wrong reports and advance latency, and exports a local JSON
 * report. Nothing is uploaded and no raw audio is recorded.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useMicrophoneCapture from '/src/features/microphone-input/useMicrophoneCapture.js'
import useWaitForYouMicInput from '/src/features/practice/useWaitForYouMicInput.js'
import { normalizeMatchSettings } from '/src/features/practice/waitForYouMatchSettings.js'
import { PERFORMANCE_MODE } from '/src/features/microphone-input/v3/performanceExpectation.js'

const settings = normalizeMatchSettings({})

const STEPS = [
  { id: 'single-c4', expected: [60], title: 'Single note (C4)', instruction: 'Play middle C once, hold about one second.', expectAdvance: true },
  { id: 'single-g3', expected: [55], title: 'Single note (G3)', instruction: 'Play G3 once (guitar open G or piano G3).', expectAdvance: true },
  { id: 'wrong-note', expected: [60], title: 'Wrong note', instruction: 'While it expects C4, play D4 for about one second.', expectAdvance: false },
  { id: 'octave-ghost', expected: [72], title: 'Octave ghost', instruction: 'While it expects C5, play C4 for about one second.', expectAdvance: false },
  { id: 'chord', expected: [60, 64, 67], title: 'Triad', instruction: 'Play C4+E4+G4 together as one block chord.', expectAdvance: true },
  { id: 'partial-chord', expected: [60, 64, 67], title: 'Partial chord', instruction: 'Play only C4+E4 (omit G4).', expectAdvance: false },
  { id: 'repeat-note-1', expected: [60], title: 'Repeated note 1', instruction: 'Play C4 once.', expectAdvance: true },
  { id: 'repeat-note-2', expected: [60], title: 'Repeated note 2', instruction: 'Play C4 again after a short gap.', expectAdvance: true },
  { id: 'repeat-chord-1', expected: [60, 64, 67], title: 'Repeated chord 1', instruction: 'Play the C-major triad once.', expectAdvance: true },
  { id: 'repeat-chord-2', expected: [60, 64, 67], title: 'Repeated chord 2', instruction: 'Strum/strike the same triad again after a gap.', expectAdvance: true },
  { id: 'quiet-note', expected: [60], title: 'Quiet note', instruction: 'Play C4 softly (pp); do not whisper or tap the mic.', expectAdvance: true },
  { id: 'silence', expected: [60], title: 'Silence / room noise', instruction: 'Stop playing; stay quiet or talk for about six seconds.', expectAdvance: false },
]

function checkpointFor(step, instrument) {
  if (!step) return null
  return {
    id: `accept-${instrument}-${step.id}`,
    expectedMidis: step.expected,
    expectedMidi: step.expected[0],
    isChord: step.expected.length > 1,
    kind: step.expected.length > 1 ? 'chord' : 'note',
    rollingWindowMs: step.expected.length > 1 ? 900 : undefined,
    notes: step.expected.map((midi, index) => ({ id: `n${index}`, midi })),
  }
}

function Acceptance() {
  const [instrument, setInstrument] = useState('piano')
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState([])
  const [paused, setPaused] = useState(false)
  const microphone = useMicrophoneCapture({ active: !paused, deviceId: deviceId || null })
  const [stepIndex, setStepIndex] = useState(-1)
  const [outcome, setOutcome] = useState({ matched: [], wrong: 0, feedback: null, detected: [] })
  const [results, setResults] = useState([])
  const startedRef = useRef(null)
  const firstEvidenceRef = useRef(null)
  const advancedRef = useRef(false)
  const step = stepIndex >= 0 ? STEPS[stepIndex] : null

  useEffect(() => {
    microphone.requestAccess?.().catch(() => {})
  }, [])

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices?.()
      setDevices((all ?? []).filter((entry) => entry.kind === 'audioinput'))
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    if (microphone.isGranted) refreshDevices()
  }, [microphone.isGranted, refreshDevices])

  const selectDevice = async (nextDeviceId) => {
    setDeviceId(nextDeviceId)
    try {
      microphone.disable?.()
      await new Promise((resolve) => setTimeout(resolve, 120))
      await microphone.requestAccess?.()
    } catch {
      // The capture hook exposes the error message in the UI.
    }
  }

  const togglePause = async () => {
    if (paused) {
      setPaused(false)
      await new Promise((resolve) => setTimeout(resolve, 60))
      await microphone.requestAccess?.()
    } else {
      setPaused(true)
      microphone.disable?.()
    }
  }

  const mic = useWaitForYouMicInput({
    active: !paused,
    checkpointMode: 'note',
    currentCheckpoint: checkpointFor(step, instrument),
    checkpoints: [],
    checkpointIndex: 0,
    performanceMode: PERFORMANCE_MODE.WAIT_FOR_YOU,
    matchSettings: settings,
    microphone,
    instrumentId: instrument,
    onPlayerInputMatched: () => {
      if (advancedRef.current) return
      advancedRef.current = true
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, { atMs: performance.now() }] }))
    },
    onWrongNote: () => setOutcome((previous) => ({ ...previous, wrong: previous.wrong + 1 })),
  })

  useEffect(() => {
    const live = mic?.liveFrame
    const detected = Array.isArray(live?.v2DetectedMidis)
      ? live.v2DetectedMidis
      : mic?.lastHeardMidi != null ? [mic.lastHeardMidi] : []
    if (detected.length && firstEvidenceRef.current == null) {
      firstEvidenceRef.current = performance.now()
    }
    setOutcome((previous) => ({
      ...previous,
      detected,
      feedback: mic?.inputFeedback
        ? { message: mic.inputFeedback.message, outcome: mic.inputFeedback.outcome }
        : null,
    }))
  }, [mic?.liveFrame, mic?.lastHeardMidi, mic?.inputFeedback])

  const startStep = async (index) => {
    if (paused) {
      setPaused(false)
      await new Promise((resolve) => setTimeout(resolve, 60))
      await microphone.requestAccess?.()
    }
    startedRef.current = performance.now()
    firstEvidenceRef.current = null
    advancedRef.current = false
    setOutcome({ matched: [], wrong: 0, feedback: null, detected: [] })
    setStepIndex(index)
  }

  const finishStep = () => {
    if (!step) return
    const advanced = advancedRef.current
    const live = mic?.liveFrame
    const device = devices.find((entry) => entry.deviceId === deviceId)
    const record = {
      step: step.id,
      title: step.title,
      instrument,
      expectedMidis: step.expected,
      expectAdvance: step.expectAdvance,
      advanced,
      pass: advanced === step.expectAdvance,
      firstEvidenceMs: firstEvidenceRef.current != null && startedRef.current != null
        ? Math.round(firstEvidenceRef.current - startedRef.current)
        : null,
      advanceMs: advanced && startedRef.current != null
        ? Math.round(performance.now() - startedRef.current)
        : null,
      wrongReports: outcome.wrong,
      detectedMidis: outcome.detected,
      feedback: outcome.feedback,
      inputLevel: live?.level ?? null,
      filteredRms: live?.filteredRms ?? null,
      noiseFloor: live?.noiseFloor ?? null,
      sampleRate: microphone?.sampleRate ?? null,
      deviceId: (microphone?.captureSettings?.deviceId ?? deviceId) || null,
      deviceLabel: device?.label ?? null,
      calibration: mic?.calibration
        ? { status: mic.calibration.status, noiseFloor: mic.calibration.noiseFloor }
        : null,
    }
    setResults((previous) => [...previous, record])
    setStepIndex(-1)
  }

  const downloadReport = () => {
    const report = {
      kind: 'corranzo-mic-acceptance',
      version: 2,
      generatedAt: new Date().toISOString(),
      instrument,
      userAgent: navigator.userAgent,
      sampleRate: microphone?.sampleRate ?? null,
      deviceId: (microphone?.captureSettings?.deviceId ?? deviceId) || null,
      deviceLabel: devices.find((entry) => entry.deviceId === deviceId)?.label ?? null,
      steps: results,
      notes: 'Research-only local report. Physical-microphone input; no raw audio was recorded or uploaded.',
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mic-acceptance-${Date.now()}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const status = paused
    ? 'Paused'
    : mic?.micStatusLabel ?? (microphone?.isListening ? 'Listening' : 'Starting…')
  const live = mic?.liveFrame

  return createElement('div', null,
    createElement('p', { className: 'note' },
      'Local research page. Nothing is uploaded. No raw audio is recorded. ',
      'Use headphones for Play Along / playback tests so the speakers do not feed back.',
    ),
    createElement('div', { className: 'toolbar' },
      createElement('label', null, 'Instrument: '),
      createElement('select', {
        value: instrument,
        onChange: (event) => setInstrument(event.target.value),
      },
        createElement('option', { value: 'piano' }, 'Piano'),
        createElement('option', { value: 'guitar' }, 'Guitar'),
      ),
      '  ',
      createElement('label', null, 'Microphone: '),
      createElement('select', {
        value: deviceId,
        onChange: (event) => { void selectDevice(event.target.value) },
      },
        createElement('option', { value: '' }, 'System default'),
        ...devices.map((device) => createElement('option', {
          key: device.deviceId,
          value: device.deviceId,
        }, device.label || 'Microphone')),
      ),
      '  ',
      createElement('button', { onClick: () => { void togglePause() } }, paused ? 'Resume mic' : 'Pause mic'),
      createElement('button', { onClick: () => { void refreshDevices() } }, 'Refresh devices'),
      createElement('button', { onClick: () => setResults([]) }, 'Clear results'),
      createElement('button', { onClick: downloadReport, disabled: !results.length }, 'Download local report'),
    ),
    createElement('p', { className: 'note' },
      'Status: ', status,
      ' · level: ', live?.level != null ? Number(live.level).toFixed(3) : '—',
      ' · filter RMS: ', live?.filteredRms != null ? Number(live.filteredRms).toFixed(4) : '—',
      ' · noise floor: ', live?.noiseFloor != null ? Number(live.noiseFloor).toFixed(4) : '—',
      ' · sample rate: ', microphone?.sampleRate ?? '—',
    ),
    ...STEPS.map((entry, index) => createElement('div', {
      key: entry.id,
      className: `step${index === stepIndex ? ' active' : ''}`,
    },
      createElement('strong', null, `${index + 1}. ${entry.title}`),
      createElement('div', null, entry.instruction),
      createElement('div', null,
        createElement('button', {
          onClick: () => { void startStep(index) },
          disabled: stepIndex !== -1,
        }, 'Start this step'),
        stepIndex === index
          ? createElement('button', { onClick: finishStep }, 'Finish / record result')
          : null,
      ),
      index === stepIndex
        ? createElement('div', { className: 'result' },
          `detected: [${(outcome.detected ?? []).join(',')}]  advanced: ${advancedRef.current ? 'yes' : 'no'}  wrong reports: ${outcome.wrong}`,
          outcome.feedback ? `\nfeedback: ${outcome.feedback.message} (${outcome.feedback.outcome})` : '',
        )
        : null,
      results.filter((record) => record.step === entry.id).map((record) => createElement('div', { className: 'result' },
        `${record.pass ? 'PASS' : 'FAIL'}  advanced=${record.advanced}  firstEvidence=${record.firstEvidenceMs ?? '—'}ms  advance=${record.advanceMs ?? '—'}ms  detected=[${record.detectedMidis.join(',')}]`,
      )),
    )),
  )
}

createRoot(document.getElementById('root')).render(createElement(Acceptance))
