/**
 * Neural pipeline harness page (Stage 8, L7) — test-only, no TF.js.
 *
 * Validates the experimental notes→feedback path inside a real browser
 * JS engine on REAL model outputs: fetches Basic Pitch note events for a
 * clip, streams them through micNeuralStream (0.5 s windows / 0.25 s
 * hop), confirms against the annotated expectation, emits canonical
 * events, and runs the bounded WFY evaluator. The audio→notes step is
 * covered separately (TF.js pages, Stage 6/7); combined, the whole
 * experimental chain is proven in-browser.
 *
 * Query: clip=<notes.json id> & expected=<midi,csv> & anchor=<seconds>.
 * Writes window.__pipelineResults when done.
 */
import { createNeuralStreamState, drainNeuralStreamEvents, emitNeuralStreamNotes } from '/src/features/microphone-input/micNeuralStream.js'
import { confirmNeuralNotes } from '/src/features/practice/micNeuralHybrid.js'
import { toCanonicalMicrophoneEvent } from '/src/features/practice/micCanonicalBridge.js'
import { evaluateCanonicalWaitForYouInput } from '/src/features/practice/canonicalInputEvent.js'
import { createChordMatchState } from '/src/features/practice/waitForYouNoteMatch.js'

const WINDOW_SECONDS = 0.5
const HOP_SECONDS = 0.25

async function main() {
  const params = new URLSearchParams(location.search)
  const clipId = params.get('clip') ?? 'acoustic-power-dense'
  const expected = (params.get('expected') ?? '').split(',').map(Number).filter(Number.isFinite)
  const anchor = Number(params.get('anchor') ?? 0.5)
  try {
    const started = performance.now()
    const notesJson = await (await fetch('/data/notes.json')).json()
    const entry = notesJson[clipId]
    if (!entry) {
      throw new Error(`no transcribed notes for ${clipId}`)
    }
    // Simulate live capture: slice note events per window (by start time)
    // and stamp them on a running capture clock.
    const captureStart = performance.now()
    const state = createNeuralStreamState({ windowSeconds: WINDOW_SECONDS, hopSeconds: HOP_SECONDS })
    const duration = Math.max(...entry.notes.map((note) => note.end), WINDOW_SECONDS)
    for (let start = 0; start < duration; start += HOP_SECONDS) {
      const windowNotes = entry.notes
        .filter((note) => note.start >= start && note.start < start + WINDOW_SECONDS)
        .map((note) => ({
          midi: note.midi,
          startOffsetSeconds: note.start - start,
          endOffsetSeconds: note.end - start,
        }))
      emitNeuralStreamNotes(state, windowNotes, captureStart + start * 1000)
    }
    const events = drainNeuralStreamEvents(state)
    const pool = events.map((event) => ({
      midi: event.midi,
      start: event.onsetCaptureMs / 1000,
      end: event.endCaptureMs / 1000,
    }))
    const baseSeconds = captureStart / 1000
    const verdict = confirmNeuralNotes(
      pool.map((note) => ({ ...note, start: note.start - baseSeconds, end: note.end - baseSeconds })),
      expected,
      anchor,
    )
    const chordState = createChordMatchState()
    const checkpoint = { id: `pipeline-${clipId}`, expectedMidis: expected }
    let outcome = null
    for (const midi of verdict.confirmedMidis) {
      const event = toCanonicalMicrophoneEvent(
        { midi, midiFloat: midi, v2DetectedMidis: verdict.confirmedMidis, clarity: 0.85 },
        { wallTimestampMs: captureStart, attemptId: 'att-pipeline', chordGroupId: 'grp-pipeline' },
      )
      outcome = evaluateCanonicalWaitForYouInput(checkpoint, event, chordState, {})
    }
    window.__pipelineResults = {
      status: 'done',
      clip: clipId,
      pipelineMs: Math.round((performance.now() - started) * 10) / 10,
      eventCount: events.length,
      confirmed: verdict.confirmedMidis,
      missing: verdict.missingMidis,
      complete: verdict.complete,
      outcome: outcome?.outcome ?? null,
    }
  } catch (error) {
    window.__pipelineResults = { status: 'error', message: String(error?.message ?? error) }
  }
  document.title = 'DONE'
}

main()
