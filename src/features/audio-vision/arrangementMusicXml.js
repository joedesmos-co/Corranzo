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
  const isPiano = targetPart === PART_INSTRUMENTS.SOLO_PIANO
  const partId = isPiano ? 'P1' : 'G1'
  const partName = isPiano ? 'Solo Piano' : 'Solo Guitar'
  const instrumentName = isPiano ? 'piano' : 'acoustic-guitar'
  // MusicXML voices are monophonic: a staff/voice must not contain overlapping
  // notes. Overlaps (a held harmony note under a moving line) would otherwise
  // be written back-to-back, overrun the barline, and shift the parsed time of
  // every later note. Clip each note to the next onset in the same voice; the
  // remaining sustain is expressed by ties across barlines, not by overlap.
  const clipped = prepareEventsForNotation(events, beats, isPiano)
  for (const e of clipped) {
    const m = Math.min(measureCount - 1, Math.max(0, measureIndexOf(e.startBeat, beats)))
    byMeasure[m].push(e)
  }
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
        // Guitar: standard notation staff + a six-line TAB staff in standard
        // tuning, so the arrangement shows BOTH the notes and the fingering.
        xml += `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>` +
          `<clef number="2"><sign>TAB</sign><line>6</line></clef>` +
          guitarStaffDetails()
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
      xml += emitGuitarMeasure(measureEvents, m, beats)
    }
    xml += `    </measure>\n`
  }
  xml += `  </part>\n</score-partwise>\n`
  void warnings
  void STEP_NAMES
  return xml
}

/**
 * Clip events so each staff/voice stays monophonic (shared with preview MIDI
 * generation so a playable preview and its engraved score always agree).
 * A note lasting under the next onset in the same voice is split; sustains
 * crossing barlines are tied by the barline splitter upstream.
 */
export function clipEventsForVoices(pieces, beats, isPiano) {
  const byVoice = new Map()
  for (const piece of pieces) {
    const key = `${piece.measureIndex}:${isPiano ? (piece.hand ?? 'RH') : 'V1'}`
    if (!byVoice.has(key)) byVoice.set(key, [])
    byVoice.get(key).push(piece)
  }
  const clipped = []
  for (const group of byVoice.values()) {
    const sorted = [...group].sort((a, b) => a.startBeat - b.startBeat)
    for (let i = 0; i < sorted.length; i += 1) {
      const e = sorted[i]
      // Find the next note with a DIFFERENT onset: notes sharing an onset are
      // one chord group and must not clip each other (that is what turned a
      // 0.5-beat chord root into a 32nd-note stub).
      let j = i + 1
      while (j < sorted.length && Math.abs(sorted[j].startBeat - e.startBeat) < 1e-6) j += 1
      const next = sorted[j]
      const limit = next ? next.startBeat : (e.measureIndex + 1) * beats
      clipped.push({ ...e, durBeats: Math.max(1 / 16, Math.min(e.durBeats, limit - e.startBeat)) })
    }
  }
  clipped.sort((a, b) => a.measureIndex - b.measureIndex || a.startBeat - b.startBeat)
  return clipped.map((c) => ({ ...c, prepared: true }))
}

/**
 * Full notation preparation: split barline crossings (tied), then clip per
 * voice. Used by the engraver AND by preview-MIDI generation so the engraved
 * score and the playable preview contain the same notated events.
 */
export function prepareEventsForNotation(events, beats, isPiano) {
  const split = events.flatMap((e) => splitNoteAcrossBarlines(e, beats))
  return clipEventsForVoices(split, beats, isPiano)
}

/** Measure owning an onset: exact barline hits belong to the NEW measure. */
function measureIndexOf(startBeat, beats) {
  return Math.floor((Math.max(0, startBeat) + 1e-9) / beats)
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

/** Split a note into per-measure pieces (ties across barlines preserved). */
function splitNoteAcrossBarlines(event, beats) {
  const pieces = []
  let start = event.startBeat
  let remaining = event.durBeats
  let first = true
  let guard = 0
  while (remaining > 1e-9 && guard < 1024) {
    guard += 1
    const m = measureIndexOf(start, beats)
    const measureEnd = (m + 1) * beats
    const dur = Math.min(remaining, measureEnd - start)
    const after = remaining - dur
    pieces.push({
      ...event,
      startBeat: start,
      durBeats: dur,
      measureIndex: m,
      tieStop: !first,
      tieStart: after > 1e-9,
    })
    start = measureEnd
    remaining = after
    first = false
  }
  return pieces.length ? pieces : [{ ...event, tieStart: false, tieStop: false }]
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
      .map((e) => (e.prepared ? [e] : splitAcrossMeasures([e], m, beats)))
      .flat()
      .filter((e) => measureIndexOf(e.startBeat, beats) === m)
    // Always emit the backup: even an empty LH produces a full-bar rest, and
    // without the backup the parser continues the voice-1 timeline into it
    // (64 + 64 = 128 divisions), which is exactly what read as overfull.
    if (hand === 'LH') s += `      <backup><duration>${beats * ARR_DIVISIONS}</duration></backup>\n`
    s += emitStaffVoice(handEvents, { measureIndex: m, beats, voice, staff, withTab: false })
  }
  return s
}

/**
 * Emit one staff's voice so its written total is EXACTLY beats * ARR_DIVISIONS.
 *
 * Notes are laid out on a division grid: an onset occupies a whole number of
 * divisions, a note's duration is clipped to the remaining divisions in this
 * measure, a <chord/> note reuses its parent's duration (invalid MusicXML
 * otherwise — the original overfull-measure cause), and the deficit is filled
 * with a single rest. An explicit accumulator makes the total exact by
 * construction rather than by cursor arithmetic.
 */
function emitStaffVoice(events, { measureIndex, beats, voice, staff, withTab }) {
  const endDiv = beats * ARR_DIVISIONS
  const sorted = [...events].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
  // Group notes sharing an onset; a group member never clips the group's parent.
  const groups = []
  for (const e of sorted) {
    const onsetDiv = Math.max(0, Math.min(endDiv, Math.round((e.startBeat - measureIndex * beats) * ARR_DIVISIONS)))
    const prev = groups[groups.length - 1]
    if (prev && prev.onsetDiv === onsetDiv) {
      prev.members.push(e)
    } else {
      groups.push({ onsetDiv, members: [e] })
    }
  }
  let s = ''
  let cursorDiv = 0
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi]
    if (group.onsetDiv < cursorDiv || group.onsetDiv >= endDiv) continue
    if (group.onsetDiv > cursorDiv) {
      s += restXml(group.onsetDiv - cursorDiv, voice, staff)
    }
    // Duration: intended length, clipped to the barline.
    const nextOnsetDiv = gi + 1 < groups.length ? groups[gi + 1].onsetDiv : endDiv
    const maxDur = Math.max(1, endDiv - group.onsetDiv)
    const dur = Math.max(1, Math.min(maxDur, beatsToDiv(group.members[0].durBeats ?? 0.5)))
    const tieStart = group.members.some((e) => e.tieStart)
    // Clip to the next onset only when the note is NOT tied forward; a tied
    // note's remainder belongs to the continuation in the next measure.
    const finalDur = tieStart ? dur : Math.min(dur, Math.max(1, nextOnsetDiv - group.onsetDiv))
    group.members.forEach((e, mi) => {
      s += noteXml({
        pitch: midiToPitch(e.midi),
        divisions: finalDur,
        voice,
        staff,
        stringFret: withTab && e.string != null ? { string: e.string, fret: e.fret } : null,
        chord: mi > 0,
        tieStart: e.tieStart,
        tieStop: e.tieStop,
      })
    })
    cursorDiv = group.onsetDiv + finalDur
  }
  const deficit = endDiv - cursorDiv
  if (deficit > 0) s += restXml(deficit, voice, staff)
  return s
}

/**
 * TAB staff declaration: six lines with standard tuning. String 1 is the
 * highest string (E4) — the same convention Corranzo's fretboard uses, so the
 * generated string/fret numbers stay truthful on the TAB.
 */
function guitarStaffDetails() {
  const tunings = [
    { line: 1, step: 'E', octave: 4 },
    { line: 2, step: 'B', octave: 3 },
    { line: 3, step: 'G', octave: 3 },
    { line: 4, step: 'D', octave: 3 },
    { line: 5, step: 'A', octave: 2 },
    { line: 6, step: 'E', octave: 2 },
  ]
  let s = `<staff-details number="1"><staff-lines>5</staff-lines></staff-details>`
  s += `<staff-details number="2"><staff-lines>6</staff-lines>`
  for (const t of tunings) {
    s += `<staff-tuning line="${t.line}"><tuning-step>${t.step}</tuning-step><tuning-octave>${t.octave}</tuning-octave></staff-tuning>`
  }
  s += `</staff-details>`
  return s
}

/**
 * Guitar measure: standard notation staff (voice 1) then a matching TAB staff
 * (voice 2 after the backup). Both carry the same pitch/duration/ties so the
 * canonical timing map (and every practice mode) reads ONE musical truth; the
 * TAB copy is a placement mirror for the eyes.
 */
function emitGuitarMeasure(measureEvents, m, beats) {
  const split = measureEvents
    .filter((e) => measureIndexOf(e.startBeat, beats) === m)
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
  const upper = emitStaffVoice(split, { measureIndex: m, beats, voice: 1, staff: 1, withTab: true })
  // emitStaffVoice always writes a full measure (beats * ARR_DIVISIONS), so
  // the backup is exact and the TAB staff can never drift out of alignment.
  const backupDivisions = beats * ARR_DIVISIONS
  const lower = emitStaffVoice(split, { measureIndex: m, beats, voice: 2, staff: 2, withTab: true })
  return (
    upper +
    `      <backup><duration>${backupDivisions}</duration></backup>\n` +
    lower
  )
}



export function pitchStepForTest(midi) {
  return midiToPitch(midi)
}
void STEP_BASE
