import { describe, expect, it } from 'vitest'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import {
  buildGuitarChordShape,
  enrichGuitarChordCheckpoint,
  guitarChordDisplayLabel,
  guitarShapeTargetLabel,
  minimumGuitarChordTonesRequired,
  resolveGroupChordSymbol,
} from '../src/features/practice/guitarChordShapeCheckpoint.js'
import { CHORD_CHECKPOINT_KIND } from '../src/features/practice/chordCheckpoint.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'
import {
  createGuitarChordShapeBufferState,
  evaluateGuitarChordShapeMicInput,
  evaluateMicScoreInformedInput,
  evaluateNoteInput,
  createMusicalEventBufferState,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { buildTabChordShapeOverlays } from '../src/features/practice/tabLaneLayout.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildWfyInputModalLayout } from '../src/features/practice/wfyInputSourceOptions.js'
import { renderSyntheticClip, synthSpeech } from '../src/features/microphone-input/micSyntheticClips.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
import { isMusicalMicFrame, micMusicalRejectReason } from '../src/features/practice/micMusicalAcceptance.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 44100
const FFT = 2048
const HOP = Math.round(SAMPLE_RATE / 60)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function guitarNote(step, octave, duration, { string = null, fret = null, chord = false } = {}) {
  const technical =
    string != null || fret != null
      ? `<notations><technical>${string != null ? `<string>${string}</string>` : ''}${
          fret != null ? `<fret>${fret}</fret>` : ''
        }</technical></notations>`
      : ''
  return (
    `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>1</voice><type>quarter</type><staff>1</staff>${technical}</note>`
  )
}

function guitarChordXml() {
  const tuning =
    `<staff-details><staff-lines>6</staff-lines>` +
    `<staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>` +
    `<staff-tuning line="2"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>` +
    `<staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>` +
    `</staff-details>`
  const notes =
    guitarNote('G', 4, 1, { string: 1, fret: 8 }) +
    guitarNote('B', 3, 1, { string: 2, fret: 8, chord: true }) +
    guitarNote('D', 4, 1, { string: 3, fret: 8, chord: true })
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef>${tuning}</attributes>
      <direction><sound tempo="120"/></direction>
      <harmony><root><root-step>G</root-step></root><kind text=""/></harmony>
      ${notes}
    </measure>
  </part>
</score-partwise>`
}

function doubleStopCheckpoint() {
  return enrichGuitarChordCheckpoint(
    {
      isChord: true,
      expectedMidis: [52, 57],
      notes: [
        { midi: 52, string: 6, fret: 5 },
        { midi: 57, string: 3, fret: 2 },
      ],
    },
    { instrumentId: INSTRUMENT_IDS.GUITAR },
  )
}

function threeNoteChordCheckpoint() {
  return enrichGuitarChordCheckpoint(
    {
      isChord: true,
      expectedMidis: [67, 71, 74],
      notes: [
        { midi: 67, string: 3, fret: 8 },
        { midi: 71, string: 2, fret: 8 },
        { midi: 74, string: 1, fret: 8 },
      ],
    },
    { instrumentId: INSTRUMENT_IDS.GUITAR },
  )
}

function analyzeNoiseFrame() {
  const samples = renderSyntheticClip({ type: 'noise', seconds: 0.4, seed: 7 }, SAMPLE_RATE)
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('guitar')
  return analyzeMicFrame(samples.subarray(0, FFT), SAMPLE_RATE, analyzer.noiseFloor, {
    gateOptions: profile?.gate ?? null,
  })
}

function mixInto(target, source, offsetSamples = 0) {
  for (let index = 0; index < source.length; index += 1) {
    const at = offsetSamples + index
    if (at >= target.length) {
      break
    }
    target[at] += source[index]
  }
}

function pluckMidi(midi, { seconds = 0.9, amplitude = 0.32, decay = 2.2 } = {}) {
  return renderSyntheticClip({ type: 'pluck', midi, seconds, amplitude, decay }, SAMPLE_RATE)
}

function runGuitarShapeLiveFrames(samples, checkpoint) {
  const state = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('guitar')
  const buffer = createGuitarChordShapeBufferState()
  const seen = []
  let result = null

  for (let end = FFT; end <= samples.length; end += HOP) {
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate: SAMPLE_RATE,
      expectedMidis: checkpoint.expectedMidis,
      expectedStringFrets: checkpoint.expectedStringFrets ?? null,
      noiseFloor: analyzer.noiseFloor,
      state,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / SAMPLE_RATE) * 1000,
    })
    const detected = tick.frame?.v2DetectedMidis ?? []
    if (detected.length) {
      seen.push([...detected])
      result = evaluateGuitarChordShapeMicInput(checkpoint, detected, buffer, {}, tick.frame)
      if (result.outcome === 'complete') {
        return { result, seen }
      }
    }
  }

  return { result, seen }
}

function highLowDoubleStopCheckpoint({ lowMidi, lowString, highMidi, highString, highFret }) {
  return enrichGuitarChordCheckpoint(
    {
      isChord: true,
      expectedMidis: [lowMidi, highMidi],
      notes: [
        { midi: lowMidi, string: lowString, fret: 5 },
        { midi: highMidi, string: highString, fret: highFret },
      ],
    },
    { instrumentId: INSTRUMENT_IDS.GUITAR },
  )
}

describe('guitar chord shape checkpoint model', () => {
  it('labels 3+ note stacks as Play this chord', () => {
    const checkpoint = {
      isChord: true,
      chordSymbol: 'G',
      expectedMidis: [67, 71, 74],
      notes: [
        { midi: 67, string: 3, fret: 8 },
        { midi: 71, string: 2, fret: 8 },
        { midi: 74, string: 1, fret: 8 },
      ],
    }
    const enriched = enrichGuitarChordCheckpoint(checkpoint, { instrumentId: INSTRUMENT_IDS.GUITAR })
    expect(enriched.kind).toBe(CHORD_CHECKPOINT_KIND.CHORD_SHAPE)
    expect(enriched.displayLabel).toBe('Play G chord')
    expect(enriched.expectedStringFrets).toHaveLength(3)
    expect(enriched.minimumRequiredTones).toBe(2)
    expect(enriched.rollingWindowMs).toBeGreaterThan(0)
    expect(enriched.minimumChordTonesRequired).toBe(2)
    expect(enriched.label).not.toContain('one at a time')
  })

  it('labels 2-note stacks as Play this double-stop', () => {
    const shape = buildGuitarChordShape(
      {
        notes: [
          { midi: 52, string: 6, fret: 5 },
          { midi: 57, string: 3, fret: 2 },
        ],
      },
      null,
    )
    expect(guitarChordDisplayLabel({}, shape)).toBe('Play this double-stop')
    expect(guitarShapeTargetLabel(2)).toBe('Play this double-stop')
  })

  it('groups vertical TAB stacks from MusicXML into one guitar chord checkpoint', () => {
    const map = parseMusicXml(guitarChordXml(), 'guitar-chord.musicxml')
    const [checkpoint] = buildNoteCheckpoints(map)
    expect(checkpoint.isChord).toBe(true)
    expect(checkpoint.chordSymbol).toBe('G')
    const enriched = enrichGuitarChordCheckpoint(checkpoint, { instrumentId: INSTRUMENT_IDS.GUITAR })
    expect(enriched.isGuitarChordShape).toBe(true)
    expect(enriched.displayLabel).toBe('Play G chord')
    expect(enriched.label).toBe('Play G chord')
    expect(enriched.detailsLabel).toContain('string')
    expect(enriched.label).not.toContain(' + ')
    expect(enriched.label).not.toContain('one at a time')
  })

  it('requires quorum tones for mic acceptance', () => {
    expect(minimumGuitarChordTonesRequired(2)).toBe(2)
    expect(minimumGuitarChordTonesRequired(3)).toBe(2)
    expect(minimumGuitarChordTonesRequired(4)).toBe(3)
    expect(minimumGuitarChordTonesRequired(5)).toBe(3)
    expect(minimumGuitarChordTonesRequired(6)).toBe(3)
  })
})

describe('guitar chord WFY guidance', () => {
  it('shows concise guitar chord copy instead of pitch lists', () => {
    const checkpoint = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        chordSymbol: 'Am',
        expectedMidis: [57, 60, 64],
        notes: [
          { midi: 57, string: 3, fret: 7 },
          { midi: 60, string: 2, fret: 8 },
          { midi: 64, string: 1, fret: 8 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const guidance = buildGuidance({
      checkpoint,
      inputFeedback: { outcome: 'idle' },
      matchingActive: true,
      guitarChordShapeMode: true,
      chordAsSequence: false,
    })
    expect(guidance.primary).toBe('Play Am chord')
    expect(guidance.primary).not.toContain('one at a time')
    expect(guidance.primary).not.toContain(' + ')
  })
})

describe('guitar chord mic acceptance', () => {
  const checkpoint = threeNoteChordCheckpoint()

  it('accepts a 2-note double-stop when both notes are played together', () => {
    const doubleStop = doubleStopCheckpoint()
    const result = evaluateGuitarChordShapeMicInput(
      doubleStop,
      [52, 57],
      createGuitarChordShapeBufferState(),
      {},
    )
    expect(result.outcome).toBe('complete')
  })

  it('does not accept a 2-note target from only one note', () => {
    const doubleStop = doubleStopCheckpoint()
    const result = evaluateGuitarChordShapeMicInput(doubleStop, [52], null, {})
    expect(result.outcome).not.toBe('complete')
  })

  it('does not let one octave-related guitar string satisfy a double-stop in the live scorer', () => {
    const octaveDoubleStop = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [45, 57],
        notes: [
          { midi: 45, string: 6, fret: 5 },
          { midi: 57, string: 3, fret: 2 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const lowAOnly = pluckMidi(45, { amplitude: 0.32 })
    const { result, seen } = runGuitarShapeLiveFrames(lowAOnly, octaveDoubleStop)

    expect(seen.some((midis) => midis.includes(45))).toBe(true)
    expect(seen.some((midis) => midis.includes(57))).toBe(false)
    expect(result?.outcome).not.toBe('complete')
  })

  it('collects a weak octave double-stop tone when both guitar strings are present', () => {
    const octaveDoubleStop = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [45, 57],
        notes: [
          { midi: 45, string: 6, fret: 5 },
          { midi: 57, string: 3, fret: 2 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.0))
    mixInto(total, pluckMidi(45, { amplitude: 0.32 }), 0)
    mixInto(total, pluckMidi(57, { amplitude: 0.04 }), 0)

    const { result, seen } = runGuitarShapeLiveFrames(total, octaveDoubleStop)

    expect(seen.some((midis) => midis.includes(45))).toBe(true)
    expect(seen.some((midis) => midis.includes(57))).toBe(true)
    expect(result?.outcome).toBe('complete')
  })

  it('collects a slightly staggered weak guitar double-stop in one rolling window', () => {
    const octaveDoubleStop = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [45, 57],
        notes: [
          { midi: 45, string: 6, fret: 5 },
          { midi: 57, string: 3, fret: 2 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.2))
    mixInto(total, pluckMidi(45, { amplitude: 0.3 }), 0)
    mixInto(total, pluckMidi(57, { amplitude: 0.05 }), Math.round(SAMPLE_RATE * 0.08))

    const { result } = runGuitarShapeLiveFrames(total, octaveDoubleStop)

    expect(result?.outcome).toBe('complete')
  })

  it('accepts a strummed 3-note chord when enough expected tones are heard', () => {
    const buffer = createGuitarChordShapeBufferState()
    const first = evaluateGuitarChordShapeMicInput(checkpoint, [67], buffer, {})
    expect(first.outcome).toBe('chord-progress')
    const second = evaluateGuitarChordShapeMicInput(checkpoint, [71], buffer, {})
    expect(second.outcome).toBe('complete')
  })

  it('accepts a strummed chord with slightly staggered onsets in one rolling window', () => {
    const buffer = createGuitarChordShapeBufferState()
    evaluateGuitarChordShapeMicInput(checkpoint, [67], buffer, {})
    const staggered = evaluateGuitarChordShapeMicInput(checkpoint, [74], buffer, {})
    expect(staggered.outcome).toBe('complete')
    expect(staggered.matchedCount).toBeGreaterThanOrEqual(2)
  })

  it('does not accept a single tone for a 3-note chord', () => {
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [67], null, {})
    expect(result.outcome).not.toBe('complete')
  })

  it('does not accept one random correct tone for a 3-note chord in the rolling window', () => {
    const buffer = createGuitarChordShapeBufferState()
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [67], buffer, {})
    expect(result.outcome).toBe('chord-progress')
    expect(result.outcome).not.toBe('complete')
  })

  it('does not accept a 3-note chord from two upper tones without the bass anchor', () => {
    const buffer = createGuitarChordShapeBufferState()
    evaluateGuitarChordShapeMicInput(checkpoint, [71], buffer, {})
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [74], buffer, {})
    expect(result.matchedCount).toBe(2)
    expect(result.outcome).not.toBe('complete')
  })

  it('accepts a 3-note chord when bass and one upper tone are heard across the window', () => {
    const buffer = createGuitarChordShapeBufferState()
    evaluateGuitarChordShapeMicInput(checkpoint, [67], buffer, {})
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [74], buffer, {})
    expect(result.outcome).toBe('complete')
  })

  it('accepts a 4-note chord by quorum', () => {
    const fourNote = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [52, 57, 60, 64],
        notes: [
          { midi: 52, string: 6, fret: 5 },
          { midi: 57, string: 5, fret: 5 },
          { midi: 60, string: 4, fret: 5 },
          { midi: 64, string: 3, fret: 5 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const result = evaluateGuitarChordShapeMicInput(
      fourNote,
      [52, 57, 60],
      createGuitarChordShapeBufferState(),
      {},
    )
    expect(result.requiredTones).toBe(3)
    expect(result.outcome).toBe('complete')
  })

  it('does not advance on the wrong guitar chord', () => {
    const result = evaluateGuitarChordShapeMicInput(
      checkpoint,
      [60, 64, 65],
      createGuitarChordShapeBufferState(),
      {},
    )
    expect(result.outcome).toBe('wrong')
  })

  it('does not advance on speech even when pitch overlaps a chord tone', () => {
    const samples = synthSpeech(SAMPLE_RATE, 1.6, { f0: 220, seed: 17, driftSemitones: 2.4 })
    const analyzer = createMicFrameAnalyzer()
    const profile = getMicInstrumentProfile('guitar')
    const frame = analyzeMicFrame(samples.subarray(2048, 2048 + FFT), SAMPLE_RATE, analyzer.noiseFloor, {
      gateOptions: profile?.gate ?? null,
    })
    const rejectReason = micMusicalRejectReason(frame)
    const detected = frame.v2DetectedMidis?.length ? [...frame.v2DetectedMidis] : frame.midi != null ? [frame.midi] : []
    if (rejectReason || !isMusicalMicFrame(frame) || detected.length === 0) {
      expect(rejectReason || !frame.gateOpen || detected.length === 0).toBeTruthy()
      return
    }
    const preview = evaluateGuitarChordShapeMicInput(
      checkpoint,
      detected,
      createGuitarChordShapeBufferState(),
      {},
    )
    expect(preview.outcome).not.toBe('complete')
  })

  it('does not advance on noise', () => {
    const frame = analyzeNoiseFrame()
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBeTruthy()
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [], null, {})
    expect(result.outcome).not.toBe('complete')
  })

  it('does not treat score-informed piano-style all-tones rule as guitar default', () => {
    const pianoLike = {
      isChord: true,
      expectedMidis: [60, 64, 67],
    }
    const partial = evaluateMicScoreInformedInput(pianoLike, [60, 64], {})
    expect(partial.outcome).toBe('chord-progress')
    const complete = evaluateMicScoreInformedInput(pianoLike, [60, 64, 67], {})
    expect(complete.outcome).toBe('complete')
  })

  it('advances a high-string + low-E double-stop when both are played', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 40,
      lowString: 6,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.0))
    mixInto(total, pluckMidi(40, { amplitude: 0.34 }), 0)
    mixInto(total, pluckMidi(66, { amplitude: 0.045 }), 0)

    const { result, seen } = runGuitarShapeLiveFrames(total, checkpoint)

    expect(seen.some((midis) => midis.includes(40))).toBe(true)
    expect(seen.some((midis) => midis.includes(66))).toBe(true)
    expect(result?.outcome).toBe('complete')
  })

  it('advances a high-string + A-string double-stop when both are played', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 45,
      lowString: 5,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.0))
    mixInto(total, pluckMidi(45, { amplitude: 0.32 }), 0)
    mixInto(total, pluckMidi(66, { amplitude: 0.05 }), 0)

    const { result } = runGuitarShapeLiveFrames(total, checkpoint)

    expect(result?.outcome).toBe('complete')
  })

  it('does not satisfy a double-stop from the high string alone', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 40,
      lowString: 6,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const highOnly = pluckMidi(66, { amplitude: 0.2 })
    const { result } = runGuitarShapeLiveFrames(highOnly, checkpoint)
    expect(result?.outcome).not.toBe('complete')
  })

  it('does not satisfy a double-stop from the low string alone', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 40,
      lowString: 6,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const lowOnly = pluckMidi(40, { amplitude: 0.32 })
    const { result } = runGuitarShapeLiveFrames(lowOnly, checkpoint)
    expect(result?.outcome).not.toBe('complete')
  })

  it('does not count a low-string harmonic as the required high-string note', () => {
    const checkpoint = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [45, 69],
        notes: [
          { midi: 45, string: 5, fret: 0 },
          { midi: 69, string: 1, fret: 5 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const lowAOnly = pluckMidi(45, { amplitude: 0.34 })
    const { result, seen } = runGuitarShapeLiveFrames(lowAOnly, checkpoint)

    expect(seen.some((midis) => midis.includes(45))).toBe(true)
    expect(seen.some((midis) => midis.includes(69))).toBe(false)
    expect(result?.outcome).not.toBe('complete')
  })

  it('does not advance when the wrong high-string fret is played', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 40,
      lowString: 6,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.0))
    mixInto(total, pluckMidi(40, { amplitude: 0.34 }), 0)
    mixInto(total, pluckMidi(67, { amplitude: 0.08 }), 0)

    const { result } = runGuitarShapeLiveFrames(total, checkpoint)

    expect(result?.outcome).not.toBe('complete')
  })

  it('retains a weak G-string tone briefly after the rolling window resets', () => {
    const checkpoint = enrichGuitarChordCheckpoint(
      {
        isChord: true,
        expectedMidis: [45, 57],
        notes: [
          { midi: 45, string: 6, fret: 5 },
          { midi: 57, string: 3, fret: 2 },
        ],
      },
      { instrumentId: INSTRUMENT_IDS.GUITAR },
    )
    const buffer = createGuitarChordShapeBufferState()
    buffer.windowStartMs = Date.now() - 950
    buffer.heardMidis.add(45)
    buffer.stickyHighMidis.set(57, Date.now() - 200)
    buffer.heardMidis.add(57)

    const result = evaluateGuitarChordShapeMicInput(checkpoint, [45], buffer, {})
    expect(result.outcome).toBe('complete')
  })

  it('retains a weak high-string tone briefly after the rolling window resets', () => {
    const checkpoint = highLowDoubleStopCheckpoint({
      lowMidi: 40,
      lowString: 6,
      highMidi: 66,
      highString: 1,
      highFret: 2,
    })
    const buffer = createGuitarChordShapeBufferState()
    const stringByMidi = new Map([
      [40, 6],
      [66, 1],
    ])
    buffer.windowStartMs = Date.now() - 950
    buffer.heardMidis.add(40)
    buffer.stickyHighMidis.set(66, Date.now() - 200)
    buffer.heardMidis.add(66)

    const result = evaluateGuitarChordShapeMicInput(checkpoint, [40], buffer, {})
    expect(result.outcome).toBe('complete')
    expect(stringByMidi.get(66)).toBe(1)
  })
})

describe('guitar chord visual TAB grouping', () => {
  it('does not draw rectangular overlay bands for multi-string chords', () => {
    const overlays = buildTabChordShapeOverlays([
      { groupId: 'g1', status: 'current', isChord: true, x: 100, y: 10, string: 1, fret: 8, sustainWidth: 40 },
      { groupId: 'g1', status: 'current', isChord: true, x: 100, y: 25, string: 2, fret: 8, sustainWidth: 40 },
      { groupId: 'g1', status: 'current', isChord: true, x: 100, y: 40, string: 3, fret: 8, sustainWidth: 40 },
    ])
    expect(overlays).toEqual([])
  })

  it('marks visual lane groups as guitar chord shapes', () => {
    const map = parseMusicXml(guitarChordXml(), 'visual-guitar-chord.musicxml')
    const groups = buildVisualLaneGroups(map, null, { instrumentId: INSTRUMENT_IDS.GUITAR })
    expect(groups[0].isGuitarChordShape).toBe(true)
    expect(groups[0].displayLabel).toBe('Play G chord')
    expect(groups[0].detailsLabel).toContain('string')
  })

  it('builds fretboard targets for the whole shape as one target group', () => {
    const map = parseMusicXml(guitarChordXml(), 'visual-guitar-fretboard.musicxml')
    const [group] = buildVisualLaneGroups(map, null, { instrumentId: INSTRUMENT_IDS.GUITAR })
    const targets = group.guitarChordShape.positions
    expect(targets.map((target) => `${target.string}:${target.fret}`)).toEqual(['1:8', '2:8', '3:8'])
  })
})

describe('chord target display details', () => {
  it('renders chord details as a collapsed disclosure instead of main note chips', () => {
    const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    expect(section).toContain('conciseChordTargetLabel')
    expect(section).toContain('wait-for-you__target-details')
    expect(section).toContain('<summary>Details</summary>')
    expect(section).toContain('expectedMidis.length > 1 ? (')
  })
})

describe('guitar modal remains simple', () => {
  it('shows only Microphone by default with no fallback actions', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.primaryActions).toHaveLength(1)
    expect(layout.fallbackLink).toBeNull()
  })
})

describe('MIDI piano chord behavior unchanged', () => {
  it('still requires every rolled chord tone for MIDI polyphony', () => {
    const checkpoint = { expectedMidis: [60, 64, 67], isChord: true }
    const buffer = createMusicalEventBufferState()
    evaluateNoteInput(checkpoint, 60, buffer, { chordWindowMs: 500 })
    const partial = evaluateNoteInput(checkpoint, 64, buffer, { chordWindowMs: 500 })
    expect(partial.outcome).toBe('chord-progress')
    const complete = evaluateNoteInput(checkpoint, 67, buffer, { chordWindowMs: 500 })
    expect(complete.outcome).toBe('complete')
  })
})

describe('resolveGroupChordSymbol', () => {
  it('pulls harmony symbols onto multi-note groups', () => {
    const symbol = resolveGroupChordSymbol(
      {
        timeSeconds: 0,
        notes: [
          { measureNumber: 1, midi: 60, string: 1, fret: 8 },
          { measureNumber: 1, midi: 64, string: 2, fret: 8 },
        ],
      },
      [{ measureNumber: 1, timeSeconds: 0, symbol: 'G' }],
    )
    expect(symbol).toBe('G')
  })
})
