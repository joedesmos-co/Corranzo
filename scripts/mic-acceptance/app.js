/**
 * Physical microphone acceptance flow (RESEARCH ONLY — not product UI).
 *
 * Uses the REAL production capture hook and the REAL Wait For You mic hook
 * with the actual microphone (no getUserMedia stub, no injected audio). It
 * walks a fixed checklist, records per-step evidence (advance, first
 * detection time, advance time, detected notes, feedback) plus input level,
 * sample rate and device label, and produces a local JSON report.
 *
 * Nothing is uploaded. The optional recording is a local download started
 * only by an explicit button press.
 */
import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useMicrophoneCapture from '/src/features/microphone-input/useMicrophoneCapture.js'
import useWaitForYouMicInput from '/src/features/practice/useWaitForYouMicInput.js'
import { normalizeMatchSettings } from '/src/features/practice/waitForYouMatchSettings.js'
import { PERFORMANCE_MODE } from '/src/features/microphone-input/v3/performanceExpectation.js'

const settings = normalizeMatchSettings({})

const STEPS = [
  { id: 'single-c4', expected: [60], title: 'Single note', instruction: 'Play middle C (C4) on the instrument, hold ~1 s.', expectAdvance: true },
  { id: 'wrong-note', expected: [60], title: 'Wrong note', instruction: 'Play D4 (a wrong note) for ~1 s.', expectAdvance: false },
  { id: 'octave-ghost', expected: [72], title: 'Octave ghost', instruction: 'While it expects C5, play C4 (middle C) for ~1 s.', expectAdvance: false },
  { id: 'chord', expected: [60, 64, 67], title: 'Full chord', instruction: 'Play C4+E4+G4 together (one block chord).', expectAdvance: true },
  { id: 'partial-chord', expected: [60, 64, 67], title: 'Partial chord', instruction: 'Play only C4+E4 (omit G4).', expectAdvance: false },
  { id: 'silence', expected: [60], title: 'Silence', instruction: 'Stop playing and stay quiet for ~6 s.', expectAdvance: false },
]

function Acceptance() {
  const microphone = useMicrophoneCapture({ active: true })
  const [stepIndex, setStepIndex] = useState(-1)
  const [outcome, setOutcome] = useState({ matched: [], wrong: 0, feedback: null, detected: [] })
  const [results, setResults] = useState([])
  const [startedAt, setStartedAt] = useState(null)
  const startedRef = useRef(null)
  const firstEvidenceRef = useRef(null)
  const advancedRef = useRef(false)

  useEffect(() => {
    microphone.requestAccess?.().catch(() => {})
  }, [])

  const step = stepIndex >= 0 ? STEPS[stepIndex] : null
  const mic = useWaitForYouMicInput({
    active: true,
    checkpointMode: 'note',
    currentCheckpoint: step ? { id: `accept-${step.id}`, expectedMidis: step.expected, expectedMidi: step.expected[0], isChord: step.expected.length > 1, kind: step.expected.length > 1 ? 'chord' : 'note', rollingWindowMs: step.expected.length > 1 ? 900 : undefined, notes: step.expected.map((midi, index) => ({ id: `n${index}`, midi })) } : null,
    checkpoints: [],
    checkpointIndex: 0,
    performanceMode: PERFORMANCE_MODE.WAIT_FOR_YOU,
    matchSettings: settings,
    microphone,
    instrumentId: window.__acceptanceInstrument ?? 'piano',
    onPlayerInputMatched: () => {
      if (advancedRef.current) return
      advancedRef.current = true
      setOutcome((previous) => ({ ...previous, matched: [...previous.matched, { atMs: performance.now() }] }))
    },
    onWrongNote: () => setOutcome((previous) => ({ ...previous, wrong: previous.wrong + 1 })),
  })

  useEffect(() => {
    const detected = (mic?.detectedNotes ?? []).map((note) => note.midi)
    if (detected.length && firstEvidenceRef.current == null) {
      firstEvidenceRef.current = performance.now()
    }
    setOutcome((previous) => ({
      ...previous,
      detected,
      feedback: mic?.inputFeedback ? { message: mic.inputFeedback.message, outcome: mic.inputFeedback.outcome } : null,
    }))
  }, [mic?.detectedNotes, mic?.inputFeedback])

  const startStep = (index) => {
    startedRef.current = performance.now()
    firstEvidenceRef.current = null
    advancedRef.current = false
    setStartedAt(Date.now())
    setOutcome({ matched: [], wrong: 0, feedback: null, detected: [] })
    setStepIndex(index)
  }

  const finishStep = () => {
    if (!step) return
    const advanced = advancedRef.current
    const record = {
      step: step.id,
      title: step.title,
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
      inputLevel: mic?.level ?? null,
      sampleRate: microphone?.sampleRate ?? null,
      deviceLabel: microphone?.captureSettings?.deviceId ?? null,
      calibration: mic?.calibration ? { status: mic.calibration.status, noiseFloor: mic.calibration.noiseFloor } : null,
    }
    setResults((previous) => [...previous, record])
    setStepIndex(-1)
  }

  const downloadReport = () => {
    const report = {
      kind: 'corranzo-mic-acceptance',
      generatedAt: new Date().toISOString(),
      instrument: window.__acceptanceInstrument ?? 'piano',
      userAgent: navigator.userAgent,
      sampleRate: microphone?.sampleRate ?? null,
      steps: results,
      notes: 'Research-only report. Input was a physical microphone; no audio was uploaded.',
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mic-acceptance-${Date.now()}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return createElement('div', null,
    createElement('p', null,
      createElement('label', null, 'Instrument: '),
      createElement('select', {
        defaultValue: window.__acceptanceInstrument ?? 'piano',
        onChange: (event) => { window.__acceptanceInstrument = event.target.value },
      },
        createElement('option', { value: 'piano' }, 'Piano'),
        createElement('option', { value: 'guitar' }, 'Guitar'),
      ),
      '  ',
      createElement('button', { onClick: () => setResults([]) }, 'Clear results'),
      createElement('button', { onClick: downloadReport, disabled: !results.length }, 'Download report'),
    ),
    createElement('p', { className: 'note' },
      'Mic status: ', mic?.micStatusLabel ?? 'unknown',
      ' · level: ', mic?.level != null ? mic.level.toFixed(3) : '—',
      ' · sample rate: ', microphone?.sampleRate ?? '—',
    ),
    ...STEPS.map((entry, index) => createElement('div', {
      key: entry.id,
      className: `step${index === stepIndex ? ' active' : ''}`,
    },
      createElement('strong', null, `${index + 1}. ${entry.title}`),
      createElement('div', null, entry.instruction),
      createElement('div', null,
        createElement('button', { onClick: () => startStep(index), disabled: stepIndex !== -1 }, 'Start this step'),
        stepIndex === index ? createElement('button', { onClick: finishStep }, 'Finish / record result') : null,
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
