/**
 * A8 — Arrangement → MusicXML using Corranzo's existing schema subset
 * (compatible with features/musicxml/parseMusicXml.js and OMR emission).
 * Piano: grand staff (P1, 2 staves). Guitar: single staff + <technical> TAB.
 * Emits notes, pitches, durations, measures, time sig, tempo, rests, voices,
 * ties (sustain across barlines), instrument assignment, string/fret.
 */
import { PART_INSTRUMENTS } from './arrangementModel.js'

export const ARR_DIVISIONS = 16 // 16th-note resolution (matches OMR_DIVISIONS_PER_QUARTER)

const STEP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const STEP_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NATURAL_STEP_OF = { 0: 'C', 1: 'C', 2: 'D', 3: 'D', 4: 'E', 5: 'F', 6: 'F', 7: 'G', 8: 'G', 9: 'A', 10: 'A', 11: 'B' }
const ALTER_OF = { 0: 0, 1: 1, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1, 7: 0, 8: 1, 9: 0, 10: 1, 11: 0 }

export function midiToPitch(midi) {
  const m = Math.round(midi)
  const pc = ((m % 12) + 12) % 12
  const step = NATURAL_STEP_OF[pc]
  const alter = ALTER_OF[pc]
  const octave = Math.floor(m / 12) - 1
  return { step, alter, octave }
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function durationType(divisions) {
  if (divisions >= 64) return 'whole'
  if (divisions >= 32) return 'half'
  if (divisions >= 16) return 'quarter'
  if (divisions >= 8) return 'eighth'
  if (divisions >= 4) return '16th'
  return '32nd'
}

/**
 * events: arranged events with startBeat/durBeats (beats, quarter=1).
 * Layout: measures of beatsPerMeasure; voices: piano RH=1/staff1, LH=2/staff2; guitar voice 1.
 */
export function buildArrangementMusicXml({ events, targetPart, bpm, beatsPerMeasure = 4, title = 'Audio Arrangement', warnings = [] }) {
  const beats = Math.max(1, Math.round(beatsPerMeasure))
  const totalBeats = events.length ? Math.max(...events.map((e) => e.startBeat + e.durBeats)) : beats
  const measureCount = Math.max(1, Math.ceil(totalBeats / beats))
  const byMeasure = Array.from({ length: measureCount }, () => [])
  for (const e of events) {
    const m = Math.min(measureCount - 1, Math.max(0, Math.floor(e.startBeat / beats)))
    byMeasure[m].push(e)
  }
  const isPiano = targetPart === PART_INSTRUMENTS.SOLO_PIANO
  const partId = isPiano ? 'P1' : 'G1'
  const partName = isPiano ? 'Solo Piano' : 'Solo Guitar'
  const instrumentName = isPiano ? 'piano' : 'acoustic-guitar'
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`
  xml += `<score-partwise version="4.0">\n`
  xml += `  <work><work-title>${escapeXml(title)}</work-title></work>\n`
  xml += `  <identification><creator type="composer">Corranzo Audio Vision</creator>`
  xml += `<encoding><software>Corranzo Audio Vision V1</software></encoding></identification>\n`
  xml += `  <part-list><score-part id="${partId}"><part-name>${partName}</part-name>`
  xml += `<score-instrument id="${partId}-I1"><instrument-name>${instrumentName}</instrument-name></score-instrument>`
  xml += `<midi-instrument id="${partId}-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list>\n`
  xml += `  <part id="${partId}">\n`
  for (let m = 0; m < measureCount; m += 1) {
    xml += `    <measure number="${m + 1}">\n`
    if (m === 0) {
      xml += `      <attributes><divisions>${ARR_DIVISIONS}</divisions>`
      xml += `<key><fifths>0</fifths></key>`
      xml += `<time><beats>${beats}</beats><beat-type>4</beat-type></time>`
      if (isPiano) {
        xml += `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`
      } else {
        xml += `<clef><sign>G</sign><line>2</line></clef>`
      }
      xml += `</attributes>\n`
      if (Number.isFinite(bpm)) {
        xml += `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>\n`
      }
    }
    const measureEvents = byMeasure[m].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    if (isPiano) {
      xml += emitGrandStaffMeasure(measureEvents, m, beats)
    } else {
      xml += emitSingleStaffMeasure(measureEvents, m, beats, true)
    }
    xml += `    </measure>\n`
  }
  xml += `  </part>\n</score-partwise>\n`
  void warnings
  void STEP_NAMES
  return xml
}

function beatsToDiv(beatsValue) {
  return Math.max(1, Math.round(beatsValue * ARR_DIVISIONS))
}

function noteXml({ pitch, divisions, voice, staff, stringFret = null, chord = false, tieStart = false, tieStop = false }) {
  const { step, alter, octave } = pitch
  let s = `      <note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>`
  if (alter !== 0) s += `<alter>${alter}</alter>`
  s += `<octave>${octave}</octave></pitch>`
  s += `<duration>${divisions}</duration><voice>${voice}</voice><type>${durationType(divisions)}</type>`
  if (staff != null) s += `<staff>${staff}</staff>`
  if (tieStart) s += `<tie type="start"/>`
  if (tieStop) s += `<tie type="stop"/>`
  if (stringFret || tieStart || tieStop) {
    s += `<notations>`
    if (tieStart) s += `<tied type="start"/>`
    if (tieStop) s += `<tied type="stop"/>`
    if (stringFret) {
      s += `<technical><string>${stringFret.string}</string><fret>${stringFret.fret}</fret></technical>`
    }
    s += `</notations>`
  }
  s += `</note>\n`
  return s
}

function restXml(divisions, voice, staff = null) {
  let s = `      <note><rest/><duration>${divisions}</duration><voice>${voice}</voice><type>${durationType(divisions)}</type>`
  if (staff != null) s += `<staff>${staff}</staff>`
  s += `</note>\n`
  return s
}

/** Split overlong notes at barlines with ties (semantic correctness). */
function splitAcrossMeasures(events, measureIndex, beats) {
  const out = []
  for (const e of events) {
    const measureStart = measureIndex * beats
    const localStart = e.startBeat - measureStart
    const maxDur = beats - localStart
    if (e.durBeats <= maxDur + 1e-9) {
      out.push({ ...e, tieStart: false, tieStop: false })
    } else {
      out.push({ ...e, durBeats: maxDur, tieStart: true, tieStop: false })
      // Remainder continues next measure (emitted there as tie-stop stub).
      out.push({
        ...e,
        startBeat: (measureIndex + 1) * beats,
        durBeats: e.durBeats - maxDur,
        tieStart: e.durBeats - maxDur > 0.01,
        tieStop: true,
        carried: true,
      })
    }
  }
  return out
}

function emitGrandStaffMeasure(measureEvents, m, beats) {
  let s = ''
  for (const [staff, voice, hand] of [[1, 1, 'RH'], [2, 2, 'LH']]) {
    const handEvents = measureEvents.filter((e) => (e.hand ?? 'RH') === hand)
      .flatMap((e) => splitAcrossMeasures([e], m, beats))
      .filter((e) => Math.floor(e.startBeat / beats) === m || e.carried)
    if (hand === 'LH' && handEvents.length) s += `      <backup><duration>${beats * ARR_DIVISIONS}</duration></backup>\n`
    let cursor = 0
    const sorted = [...handEvents].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    let lastOnset = null
    for (const e of sorted) {
      const localStart = Math.max(0, e.startBeat - m * beats)
      const gap = localStart - cursor
      if (gap > 0.01) {
        s += restXml(beatsToDiv(gap), voice, staff)
        cursor = localStart
      }
      const chord = lastOnset != null && Math.abs(e.startBeat - lastOnset) < 1e-6
      s += noteXml({
        pitch: midiToPitch(e.midi),
        divisions: beatsToDiv(Math.min(e.durBeats, beats - localStart)),
        voice,
        staff,
        chord,
        tieStart: e.tieStart,
        tieStop: e.tieStop,
      })
      if (!chord) cursor = localStart + Math.min(e.durBeats, beats - localStart)
      lastOnset = e.startBeat
    }
    const tail = beats - cursor
    if (tail > 0.01) s += restXml(beatsToDiv(tail), voice, staff)
  }
  return s
}

function emitSingleStaffMeasure(measureEvents, m, beats, withTab) {
  let s = ''
  const split = measureEvents.flatMap((e) => splitAcrossMeasures([e], m, beats))
    .filter((e) => Math.floor(Math.max(0, e.startBeat - 1e-9) / beats) === m || Math.floor(e.startBeat / beats) === m)
  let cursor = 0
  const sorted = [...split].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
  let lastOnset = null
  for (const e of sorted) {
    const localStart = Math.max(0, Math.min(beats, e.startBeat - m * beats))
    const gap = localStart - cursor
    if (gap > 0.01) {
      s += restXml(beatsToDiv(gap), 1)
      cursor = localStart
    }
    const chord = lastOnset != null && Math.abs(e.startBeat - lastOnset) < 1e-6
    s += noteXml({
      pitch: midiToPitch(e.midi),
      divisions: beatsToDiv(Math.min(e.durBeats, Math.max(1 / 4, beats - localStart))),
      voice: 1,
      staff: null,
      stringFret: withTab && e.string != null ? { string: e.string, fret: e.fret } : null,
      chord,
      tieStart: e.tieStart,
      tieStop: e.tieStop,
    })
    if (!chord) cursor = localStart + Math.min(e.durBeats, Math.max(1 / 4, beats - localStart))
    lastOnset = e.startBeat
  }
  const tail = beats - cursor
  if (tail > 0.01) s += restXml(beatsToDiv(tail), 1)
  return s
}

export function pitchStepForTest(midi) {
  return midiToPitch(midi)
}
void STEP_BASE
