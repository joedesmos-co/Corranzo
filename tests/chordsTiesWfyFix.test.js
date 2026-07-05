import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  CHORD_SHEET_DETECTED_WARNING,
  analyzeChordSheetScore,
  buildChordSheetNoteEvents,
  chordSymbolToMidis,
  extractChordSymbolsFromText,
} from '../src/features/musicxml/chordSymbolSheet.js'
import {
  classifyImportWarning,
  partitionImportWarnings,
  IMPORT_WARNING_KIND,
} from '../src/features/import/importWarningCategories.js'
import { buildOmrGeneratedWarnings } from '../src/features/import/useImportReadiness.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import {
  buildWfyInputModalActions,
  buildWfyInputSelectorOptions,
  wfyInputSourceLabel,
} from '../src/features/practice/wfyInputSourceOptions.js'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { WFY_INPUT_SOURCE } from '../src/features/microphone-input/micInputConstants.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function tieNotations(type) {
  return `<tie type="${type}"/><notations><tied type="${type}"/></notations>`
}

function markedNote(step, octave, notations = '') {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>1</duration><voice>1</voice><type>quarter</type>${notations}</note>`
  )
}

describe('compact import warning disclosure', () => {
  it('treats TAB/capo/repeat approximation messages as disclosure items', () => {
    const warnings = [
      { id: 'tab', strength: 'mild', message: 'TAB notes detected — rhythm is approximate.' },
      { id: 'capo', strength: 'mild', message: 'Capo marking detected — playback sounds at written TAB pitch.' },
      { id: 'error', strength: 'strong', message: 'MIDI file failed to load.' },
    ]
    const { critical, disclosure } = partitionImportWarnings(warnings)
    expect(critical).toHaveLength(1)
    expect(critical[0].message).toContain('MIDI file failed')
    expect(disclosure).toHaveLength(2)
    expect(classifyImportWarning(warnings[0])).toBe(IMPORT_WARNING_KIND.APPROXIMATION)
  })

  it('renders a single Import notes disclosure with count badge', () => {
    const notices = readSrc('components', 'practice', 'PracticeImportNotices.jsx')
    expect(notices).toContain('partitionImportWarnings')
    expect(notices).toContain('practice-import-notices__disclosure')
    expect(notices).toContain('Import notes')
    expect(notices).toContain('practice-import-notices__disclosure-count')
  })

  it('stores OMR approximation warnings as mild strength', () => {
    const warnings = buildOmrGeneratedWarnings({
      source: 'omr',
      omrMeta: {
        warnings: [
          'TAB notes detected — rhythm is approximate.',
          'Repeat/coda markings were detected but not fully expanded.',
        ],
      },
    })
    expect(warnings.every((warning) => warning.strength === 'mild')).toBe(true)
  })
})

describe('guitar-specific WFY input setup', () => {
  it('labels guitar MIDI as a device, not a keyboard', () => {
    expect(wfyInputSourceLabel(WFY_INPUT_SOURCE.MIDI, INSTRUMENT_IDS.GUITAR)).toBe('MIDI device')
    expect(wfyInputSourceLabel(WFY_INPUT_SOURCE.MIDI, INSTRUMENT_IDS.PIANO)).toBe('MIDI keyboard')
  })

  it('orders guitar modal actions as Microphone, Continue, optional MIDI device', () => {
    const actions = buildWfyInputModalActions({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(actions.map((action) => action.label)).toEqual([
      'Use Microphone',
      'Use Continue button',
      'Use MIDI device',
    ])
    expect(actions.some((action) => action.label.includes('Keyboard'))).toBe(false)
  })

  it('keeps piano modal with MIDI keyboard when available', () => {
    const actions = buildWfyInputModalActions({
      instrumentId: INSTRUMENT_IDS.PIANO,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(actions.map((action) => action.label)).toEqual([
      'Use Microphone',
      'Continue button',
      'Use MIDI Keyboard',
    ])
  })

  it('does not duplicate Continue below MIDI in the guitar selector', () => {
    const options = buildWfyInputSelectorOptions({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(options.map((option) => option.label)).toEqual([
      'Use Microphone',
      'Use Continue button',
      'Use MIDI device',
    ])
    const selector = readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')
    expect(selector).not.toContain('wfy-input-source__manual')
  })
})

describe('WFY tie-aware checkpoints', () => {
  it('skips tied continuation notes as separate checkpoints', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes({ beats: 5 })}${F.soundTempo(120)}` +
        markedNote('C', 4, tieNotations('start')) +
        markedNote('C', 4, tieNotations('stop')) +
        markedNote('D', 4) +
        markedNote('E', 4) +
        markedNote('F', 4) +
        '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'ties.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints).toHaveLength(4)
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['C4', 'D4', 'E4', 'F4'])
  })

  it('keeps one checkpoint for a tied pair on guitar TAB notes', () => {
    const attributes =
      '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>TAB</sign><line>5</line></clef></attributes>'
    const tabNote = (step, octave, string, fret, tieType = null) => {
      const tie =
        tieType != null
          ? `<tie type="${tieType}"/><notations><technical><string>${string}</string><fret>${fret}</fret></technical><tied type="${tieType}"/></notations>`
          : `<notations><technical><string>${string}</string><fret>${fret}</fret></technical></notations>`
      return (
        `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
        `<duration>1</duration><voice>1</voice><type>quarter</type>${tie}</note>`
      )
    }
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${attributes}${F.soundTempo(120)}` +
        tabNote('E', 4, 1, 0, 'start') +
        tabNote('E', 4, 1, 0, 'stop') +
        tabNote('G', 4, 1, 3) +
        '</measure></part>',
    )
    const timingMap = parseMusicXml(xml, 'guitar-ties.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints).toHaveLength(2)
  })
})

describe('chord-symbol guitar sheets', () => {
  it('parses common chord symbols into playable midis', () => {
    expect(chordSymbolToMidis('Am')).toEqual(expect.arrayContaining([57, 60, 64]))
    expect(chordSymbolToMidis('G7')).toEqual(expect.arrayContaining([55, 59, 62, 66]))
  })

  it('detects a sparse harmony-first score as a chord sheet', () => {
    const harmony = (symbol) =>
      `<harmony><root><root-step>${symbol.charAt(0)}</root-step></root>` +
      `<kind text="${symbol.slice(1)}"/></harmony>`
    const xml = F.scoreWrap(
      `<part id="P1">` +
        `<measure number="1">${F.attributes()}${F.soundTempo(120)}${harmony('C')}${F.rest(4)}</measure>` +
        `<measure number="2">${harmony('Am')}${F.rest(4)}</measure>` +
        `<measure number="3">${harmony('F')}${F.rest(4)}</measure>` +
        `<measure number="4">${harmony('G')}${F.rest(4)}</measure>` +
        `</part>`,
    )
    const timingMap = parseMusicXml(xml, 'chord-sheet.musicxml')
    expect(timingMap.chordSheet?.isChordSheet).toBe(true)
    expect(timingMap.chordSheet?.warnings).toContain(CHORD_SHEET_DETECTED_WARNING)
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints.length).toBeGreaterThanOrEqual(4)
    expect(checkpoints.some((checkpoint) => checkpoint.chordSymbol === 'C')).toBe(true)
  })

  it('extracts chord symbols from lyric/chord text', () => {
    const symbols = extractChordSymbolsFromText('C Am F G7 Dm Bb/C sparks fly upward')
    expect(symbols).toEqual(expect.arrayContaining(['C', 'Am', 'F', 'G7', 'Dm']))
  })

  it('builds steady chord events without pretending exact rhythm', () => {
    const analysis = analyzeChordSheetScore({
      harmonyEvents: [
        { measureNumber: 1, quarterTime: 0, symbol: 'C' },
        { measureNumber: 2, quarterTime: 4, symbol: 'G' },
      ],
      notes: [],
      measures: [
        { number: 1, startTimeSeconds: 0, startQuarterTime: 0, lengthQuarters: 4 },
        { number: 2, startTimeSeconds: 2, startQuarterTime: 4, lengthQuarters: 4 },
      ],
    })
    expect(analysis.isChordSheet).toBe(true)
    const events = buildChordSheetNoteEvents({
      harmonyEvents: analysis.harmonyEvents,
      measures: [
        { number: 1, startTimeSeconds: 0, lengthQuarters: 4 },
        { number: 2, startTimeSeconds: 2, lengthQuarters: 4 },
      ],
    })
    expect(events).toHaveLength(2)
    expect(events[0].chordSymbol).toBe('C')
  })

  it('uses guitar-friendly chord guidance for mic sequence mode', () => {
    const guidance = buildGuidance({
      checkpoint: {
        chordSymbol: 'Am',
        expectedMidis: [57, 60, 64],
        notes: [{ chordSymbol: 'Am', midi: 57 }],
      },
      matchingActive: true,
      chordAsSequence: true,
      instrument: { id: 'guitar', notation: { grandStaff: false } },
    })
    expect(guidance.primary).toContain('Am')
    expect(guidance.primary).toContain('one at a time')
  })
})
