#!/usr/bin/env node
/**
 * Repair voice-flattened practice-library MusicXML from the bundled MIDI.
 *
 * PROVENANCE. The practice library was imported by
 * scripts/import-practice-library.mjs: a Mutopia MIDI is downloaded, then
 * music21 converts MIDI → MusicXML. music21 flattens the two-voice texture
 * into ONE sequential stream (no <voice>, no <backup>), so measure N's notes
 * are laid end-to-end past its barline and every later measure drifts
 * (H1/H2 in docs/upstream-handoff-parser-timing.md). The bundled MIDI is the
 * AUTHORITATIVE SOURCE the file was derived from and still holds the true
 * onsets.
 *
 * This script re-times the flattened parts from that MIDI:
 *   - note PITCHES and WRITTEN DURATIONS are preserved 1:1 from the file
 *     (notation fidelity untouched: types, dots, beams, ties, articulations)
 *   - note ONSETS are restored from the MIDI note-on ticks
 *   - the voice split is DERIVED from the MIDI onsets by non-overlap coloring
 *     (deterministic: notes that overlap in time cannot share a voice), with
 *     <backup> + padding rests only as positioning mechanics
 *   - every non-note XML child (attributes, directions, barlines, prints)
 *     keeps its original document position
 * It refuses to repair unless the MIDI matches the file note-for-note
 * (pitch + duration, per measure) and every onset lands inside its written
 * measure window.
 *
 * Usage:
 *   node scripts/repair-flattened-practice-musicxml.mjs --check <pieceId>
 *   node scripts/repair-flattened-practice-musicxml.mjs --check-all
 *   node scripts/repair-flattened-practice-musicxml.mjs --repair <pieceId>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const libraryDir = join(root, 'public', 'fixtures', 'practice-library')

const EPSILON = 1e-6
const DURATION_TOLERANCE_QUARTERS = 1 / 48

// ---------------------------------------------------------------- MIDI reader

function readVarLen(data, index) {
  let value = 0
  while (true) {
    const byte = data[index]
    index += 1
    value = (value << 7) | (byte & 0x7f)
    if (!(byte & 0x80)) break
  }
  return [value, index]
}

/**
 * Parse a format-1 MIDI file into tracks of note events
 * { onsetTicks, durationTicks, midi, velocity, channel }.
 */
function parseMidiNotes(buffer) {
  if (buffer.toString('utf8', 0, 4) !== 'MThd') {
    throw new Error('not a MIDI file (missing MThd)')
  }
  const headerLength = buffer.readUInt32BE(4)
  const format = buffer.readUInt16BE(8)
  const trackCount = buffer.readUInt16BE(10)
  const division = buffer.readUInt16BE(12)
  let index = 8 + headerLength
  const tracks = []
  for (let track = 0; track < trackCount; track += 1) {
    if (buffer.toString('utf8', index, index + 4) !== 'MTrk') {
      throw new Error(`bad MIDI chunk header in track ${track}`)
    }
    const trackLength = buffer.readUInt32BE(index + 4)
    index += 8
    const end = index + trackLength
    let tick = 0
    let runningStatus = null
    const open = new Map() // `${channel}:${midi}` → [{ tick, velocity }]
    const notes = []
    while (index < end) {
      const [delta, nextIndex] = readVarLen(buffer, index)
      tick += delta
      index = nextIndex
      let status = buffer[index]
      if (status === 0xff) {
        index += 2
        const [metaLength, afterMeta] = readVarLen(buffer, index)
        index = afterMeta + metaLength
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        index += 1
        const [sysexLength, afterSysex] = readVarLen(buffer, index)
        index = afterSysex + sysexLength
        continue
      }
      if (status & 0x80) {
        runningStatus = status
        index += 1
      }
      status = runningStatus
      const kind = status & 0xf0
      if (kind === 0x90 || kind === 0x80) {
        const midi = buffer[index]
        const velocity = buffer[index + 1]
        index += 2
        const channel = status & 0x0f
        const key = `${channel}:${midi}`
        if (kind === 0x90 && velocity > 0) {
          if (!open.has(key)) open.set(key, [])
          open.get(key).push({ tick, velocity })
        } else {
          const queue = open.get(key)
          const start = queue?.shift()
          if (start) {
            notes.push({
              onsetTicks: start.tick,
              durationTicks: tick - start.tick,
              midi,
              velocity: start.velocity,
              channel,
            })
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) {
        index += 1
      } else {
        index += 2
      }
    }
    index = end
    notes.sort((left, right) => left.onsetTicks - right.onsetTicks || left.midi - right.midi)
    if (notes.length > 0) tracks.push(notes)
  }
  return { format, division, tracks }
}

// ------------------------------------------------- lightweight ordered-XML walk

/**
 * Minimal ordered-node walker for the music21 output we repair: enough to
 * split a measure body into (preserved children, note stream) without
 * re-serializing the whole file.
 */
function splitMeasureBody(measureXml) {
  const openTag = /^<measure\b[^>]*>/
  const inner = measureXml.replace(openTag, '')
  const children = []
  let cursor = 0
  while (cursor < inner.length) {
    const nextTag = inner.indexOf('<', cursor)
    if (nextTag < 0) break
    if (nextTag > cursor) {
      // whitespace/text between children — keep attached to the next child
    }
    const tagMatch = /^<(\/?)([A-Za-z][\w:-]*)/.exec(inner.slice(nextTag))
    if (!tagMatch) {
      cursor = nextTag + 1
      continue
    }
    if (tagMatch[1] === '/') {
      // stray close tag — attach and continue
      const closeEnd = inner.indexOf('>', nextTag)
      cursor = closeEnd + 1
      continue
    }
    const tag = tagMatch[2]
    const selfClosing = /^<[^>]*\/>/.exec(inner.slice(nextTag))
    if (selfClosing) {
      children.push({ tag, xml: selfClosing[0] })
      cursor = nextTag + selfClosing[0].length
      continue
    }
    const openEnd = inner.indexOf('>', nextTag)
    const closeTag = `</${tag}>`
    const closeIndex = inner.indexOf(closeTag, openEnd + 1)
    if (closeIndex < 0) {
      children.push({ tag, xml: inner.slice(nextTag).trim() })
      cursor = inner.length
      continue
    }
    const closeEnd = closeIndex + closeTag.length
    children.push({ tag, xml: inner.slice(nextTag, closeEnd) })
    cursor = closeEnd
  }
  return children
}

function readNoteMeta(noteXml) {
  const chord = /<chord\s*\/>/.test(noteXml)
  const grace = /<grace\s*\/>/.test(noteXml)
  const rest = /<rest\s*\/>/.test(noteXml)
  const durationMatch = /<duration>(-?\d+(?:\.\d+)?)<\/duration>/.exec(noteXml)
  const duration = durationMatch ? Number(durationMatch[1]) : null
  const stepMatch = /<step>([A-G])<\/step>/.exec(noteXml)
  const alterMatch = /<alter>(-?\d+)<\/alter>/.exec(noteXml)
  const octaveMatch = /<octave>(\d+)<\/octave>/.exec(noteXml)
  const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let midi = null
  if (stepMatch && octaveMatch) {
    midi =
      (Number(octaveMatch[1]) + 1) * 12 +
      STEP_TO_SEMITONE[stepMatch[1]] +
      (alterMatch ? Number(alterMatch[1]) : 0)
  }
  return { chord, grace, rest, duration, midi }
}

/** Insert <voice>N</voice> after duration/tie, before type (MusicXML order). */
function withVoiceTag(noteXml, voice) {
  if (/<voice>\d+<\/voice>/.test(noteXml)) {
    return noteXml.replace(/<voice>\d+<\/voice>/, `<voice>${voice}</voice>`)
  }
  const durationEnd = noteXml.indexOf('</duration>')
  if (durationEnd >= 0) {
    let insertAt = durationEnd + '</duration>'.length
    // skip following <tie .../> / <tie ...>...</tie> elements
    while (true) {
      const rest_ = noteXml.slice(insertAt)
      const tieMatch = /^\s*<tie\b[^>]*?\/>/.exec(rest_)
      if (tieMatch) {
        insertAt += tieMatch[0].length
        continue
      }
      const tieOpen = /^\s*<tie\b[^>]*>/.exec(rest_)
      if (tieOpen) {
        const closeAt = rest_.indexOf('</tie>', tieOpen[0].length)
        if (closeAt >= 0) {
          insertAt += closeAt + '</tie>'.length
          continue
        }
      }
      break
    }
    return `${noteXml.slice(0, insertAt)}<voice>${voice}</voice>${noteXml.slice(insertAt)}`
  }
  const closeIndex = noteXml.lastIndexOf('</note>')
  return `${noteXml.slice(0, closeIndex)}<voice>${voice}</voice>${noteXml.slice(closeIndex)}`
}

function restXml(duration, voice) {
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice></note>`
}

function backupXml(duration) {
  return `<backup><duration>${duration}</duration></backup>`
}

// ------------------------------------------------------------------- analysis

/**
 * Per-part analysis: flat written note stream + per-measure nominal windows,
 * mirroring walkPart's cursor semantics (chords/grace don't advance).
 */
function analyzePart(partXml, timingMap, partId) {
  const measureRegex = /<measure\b[^>]*>[\s\S]*?<\/measure>/g
  const measures = []
  let match
  while ((match = measureRegex.exec(partXml)) !== null) {
    measures.push(match[0])
  }
  let divisions = 1
  let beats = 4
  let beatType = 4
  const rows = []
  measures.forEach((measureXml, index) => {
    const numberMatch = /<measure\b[^>]*\bnumber="([^"]+)"/.exec(measureXml)
    const number = numberMatch ? Number(numberMatch[1].split('.')[0]) : index + 1
    const children = splitMeasureBody(measureXml)
    let cursor = 0
    let lastOnset = 0
    let maxNoteEnd = 0
    let noteCount = 0
    const stream = []
    for (const child of children) {
      if (child.tag === 'attributes') {
        const divisionsMatch = /<divisions>(\d+(?:\.\d+)?)<\/divisions>/.exec(child.xml)
        if (divisionsMatch) divisions = Number(divisionsMatch[1])
        const beatsMatch = /<beats>(\d+(?:\.\d+)?)<\/beats>/.exec(child.xml)
        const beatTypeMatch = /<beat-type>(\d+(?:\.\d+)?)<\/beat-type>/.exec(child.xml)
        if (beatsMatch) beats = Number(beatsMatch[1])
        if (beatTypeMatch) beatType = Number(beatTypeMatch[1])
      } else if (child.tag === 'backup') {
        const durationMatch = /<duration>(\d+(?:\.\d+)?)<\/duration>/.exec(child.xml)
        cursor = Math.max(0, cursor - (durationMatch ? Number(durationMatch[1]) : 0))
        lastOnset = cursor
      } else if (child.tag === 'forward') {
        const durationMatch = /<duration>(\d+(?:\.\d+)?)<\/duration>/.exec(child.xml)
        cursor += durationMatch ? Number(durationMatch[1]) : 0
        lastOnset = cursor
      } else if (child.tag === 'note') {
        const meta = readNoteMeta(child.xml)
        const onset = meta.chord ? lastOnset : cursor
        stream.push({ xml: child.xml, docIndex: stream.length, ...meta, onset })
        if (!meta.chord && !meta.grace && meta.duration != null) {
          lastOnset = cursor
          cursor += meta.duration
          maxNoteEnd = Math.max(maxNoteEnd, cursor)
          noteCount += 1
        }
      }
    }
    rows.push({
      xml: measureXml,
      number,
      index,
      divisions,
      nominalQuarters: (beats * 4) / beatType,
      notatedNoteEndQuarters: maxNoteEnd / divisions,
      noteCount,
      stream,
    })
  })
  return rows
}

/** Measure windows from the shipped parser (time-signature driven). */
function measureWindows(timingMap) {
  return (timingMap.measures ?? []).map((measure) => ({
    number: measure.number,
    index: measure.index,
    startQuarters: measure.startQuarters,
    lengthQuarters: measure.lengthQuarters,
    endQuarters: measure.endQuarters,
  }))
}

function analyzePiece(pieceId) {
  const xmlPath = join(libraryDir, pieceId, `${pieceId}.musicxml`)
  const midiPath = join(libraryDir, pieceId, `${pieceId}.mid`)
  return Promise.all([readFile(xmlPath, 'utf8'), readFile(midiPath)]).then(
    ([xml, midiBuffer]) => ({ xmlPath, midiPath, xml, midi: parseMidiNotes(midiBuffer) }),
  )
}

/**
 * Match a part's written note stream against one MIDI track, per measure.
 * Both sides are grouped into ONSET CLUSTERS (the file's flat stream keeps its
 * document order; chords join their head's cluster; the MIDI clusters by tick),
 * then compared cluster-by-cluster as pitch multisets. Returns per-note MIDI
 * onsets (absolute quarters) for every non-grace, non-rest note.
 */
function matchPartToTrack(partRows, trackNotes, windows, division) {
  const reasons = []
  const midiByWindow = []
  for (const note of trackNotes) {
    const onsetQuarters = note.onsetTicks / division
    const window = windows.find(
      (candidate) => onsetQuarters >= candidate.startQuarters - 1e-6 && onsetQuarters < candidate.endQuarters - 1e-9,
    )
    if (!window) {
      reasons.push(
        `MIDI onset ${onsetQuarters.toFixed(4)}q (midi ${note.midi}) falls outside every written measure window`,
      )
      continue
    }
    midiByWindow.push({ note, onsetQuarters, windowIndex: window.index })
  }

  const assignments = []
  let midiCursor = 0
  for (const row of partRows) {
    const rowMidi = []
    while (midiCursor < midiByWindow.length && midiByWindow[midiCursor].windowIndex === row.index) {
      rowMidi.push(midiByWindow[midiCursor])
      midiCursor += 1
    }
    // MIDI clusters by identical onset tick.
    const midiClusters = []
    for (const entry of rowMidi) {
      const last = midiClusters[midiClusters.length - 1]
      if (last && Math.abs(last.onsetTicks - entry.note.onsetTicks) <= 0.5) {
        last.notes.push(entry)
      } else {
        midiClusters.push({ onsetTicks: entry.note.onsetTicks, notes: [entry] })
      }
    }
    // File clusters: a chord note joins the previous cluster.
    const xmlClusters = []
    for (const entry of row.stream) {
      if (entry.grace || entry.rest || entry.duration == null) continue
      if (entry.chord && xmlClusters.length > 0) {
        xmlClusters[xmlClusters.length - 1].notes.push(entry)
      } else {
        xmlClusters.push({ notes: [entry] })
      }
    }
    if (xmlClusters.length !== midiClusters.length) {
      reasons.push(
        `m${row.number}: file has ${xmlClusters.length} onset clusters but MIDI window has ${midiClusters.length}`,
      )
    }
    const perNote = new Map()
    const limit = Math.min(xmlClusters.length, midiClusters.length)
    for (let i = 0; i < limit; i += 1) {
      const xmlNotes = xmlClusters[i].notes
        .slice()
        .sort((left, right) => left.docIndex - right.docIndex)
      const midiNotes = midiClusters[i].notes
        .slice()
        .sort((left, right) => left.note.midi - right.note.midi)
      if (xmlNotes.length !== midiNotes.length) {
        reasons.push(`m${row.number} cluster ${i + 1}: ${xmlNotes.length} notes vs MIDI ${midiNotes.length}`)
        continue
      }
      const xmlByPitch = xmlNotes.slice().sort((left, right) => left.midi - right.midi)
      for (let j = 0; j < xmlByPitch.length; j += 1) {
        const xmlEntry = xmlByPitch[j]
        const midiEntry = midiNotes[j]
        if (midiEntry.note.midi !== xmlEntry.midi) {
          reasons.push(
            `m${row.number} cluster ${i + 1}: file midi ${xmlEntry.midi} ≠ MIDI midi ${midiEntry.note.midi}`,
          )
          continue
        }
        const midiQuarters = midiEntry.note.durationTicks / division
        if (Math.abs(midiQuarters - xmlEntry.duration / row.divisions) > DURATION_TOLERANCE_QUARTERS) {
          reasons.push(
            `m${row.number} m${row.number} midi ${xmlEntry.midi}: file duration ${xmlEntry.duration / row.divisions}q ≠ MIDI ${midiQuarters}q`,
          )
          continue
        }
        perNote.set(xmlEntry.docIndex, midiEntry.onsetQuarters)
      }
    }
    assignments.push({ row, perNote, rowMidi })
  }
  return { ok: reasons.length === 0, reasons, assignments }
}

// -------------------------------------------------------------------- rebuild

/**
 * Rebuild an overfull measure body from MIDI onsets.
 * Returns the new inner XML (preserved children + re-voiced note stream).
 */
function rebuildMeasure(row, assignment, windows, timingMap) {
  const window = windows[row.index]
  const measureStart = window?.startQuarters ?? 0
  const notes = row.stream.map((entry) => {
    const onsetQuarters = assignment.perNote.has(entry.docIndex)
      ? assignment.perNote.get(entry.docIndex)
      : null
    return { ...entry, midiOnsetQuarters: onsetQuarters }
  })
  const timed = notes.filter((entry) => entry.midiOnsetQuarters != null)
  if (timed.length !== notes.filter((entry) => !entry.grace && !entry.rest && entry.duration != null).length) {
    throw new Error(`m${row.number}: missing MIDI onsets for some notes`)
  }

  // Order: by (MIDI onset, then document order). Chords keep their head's
  // onset; grace notes ride along with the note that follows them.
  const ordered = []
  let pendingGrace = []
  for (const entry of notes) {
    if (entry.grace) {
      pendingGrace.push(entry)
      continue
    }
    ordered.push({ ...entry, gracePrefix: pendingGrace })
    pendingGrace = []
  }
  ordered.sort((left, right) => {
    const leftOnset = left.midiOnsetQuarters ?? 0
    const rightOnset = right.midiOnsetQuarters ?? 0
    if (Math.abs(leftOnset - rightOnset) > 1e-9) return leftOnset - rightOnset
    return left.docIndex - right.docIndex
  })
  // Measure-local onsets (MusicXML positions notes relative to the barline).
  for (const entry of ordered) {
    entry.localOnsetQuarters = (entry.midiOnsetQuarters ?? measureStart) - measureStart
  }

  // Voice assignment by non-overlap coloring (deterministic), local ends.
  const voices = [] // [{ endQuarters }]
  const voiceOf = new Map()
  for (const entry of ordered) {
    if (entry.chord) continue
    const onset = entry.localOnsetQuarters
    let voiceIndex = voices.findIndex((voice) => voice.endQuarters <= onset + 1e-9)
    if (voiceIndex < 0) {
      voices.push({ endQuarters: onset })
      voiceIndex = voices.length - 1
    }
    voiceOf.set(entry.docIndex, voiceIndex + 1)
    const end = onset + (entry.duration != null ? entry.duration / row.divisions : 0)
    voices[voiceIndex].endQuarters = Math.max(voices[voiceIndex].endQuarters, end)
  }
  // Chord notes follow their head's voice.
  const orderedIndex = new Map(ordered.map((entry, index) => [entry.docIndex, index]))
  for (const entry of ordered) {
    if (!entry.chord) continue
    let headDocIndex = entry.docIndex - 1
    while (headDocIndex >= 0 && !voiceOf.has(headDocIndex)) headDocIndex -= 1
    voiceOf.set(entry.docIndex, headDocIndex >= 0 ? voiceOf.get(headDocIndex) : 1)
  }
  if (voices.length === 0) voices.push({ endQuarters: 0 })

  // Emit voice by voice: rests pad gaps, backup returns to measure start.
  const emitted = []
  for (let voice = 1; voice <= voices.length; voice += 1) {
    if (voice > 1) {
      emitted.push(backupXml(Math.round(voices[voice - 2].endQuarters * row.divisions)))
    }
    let cursorQuarters = 0
    const voiceEntries = ordered.filter((entry) => voiceOf.get(entry.docIndex) === voice)
    for (const entry of voiceEntries) {
      const onset = entry.localOnsetQuarters
      const gap = onset - cursorQuarters
      if (gap > 1e-9) {
        emitted.push(restXml(Math.round(gap * row.divisions), voice))
        cursorQuarters = onset
      }
      for (const grace of entry.gracePrefix ?? []) {
        emitted.push(withVoiceTag(grace.xml, voice))
      }
      emitted.push(withVoiceTag(entry.xml, voice))
      cursorQuarters = onset + (entry.duration != null ? entry.duration / row.divisions : 0)
    }
  }

  // Preserve non-note children in their original order; the rebuilt note
  // stream takes the position of the first original note/backup/forward.
  const preserved = []
  let streamEmitted = false
  for (const child of splitMeasureBody(row.xml)) {
    const isStream = child.tag === 'note' || child.tag === 'backup' || child.tag === 'forward'
    if (isStream) {
      if (!streamEmitted) {
        preserved.push(...emitted)
        streamEmitted = true
      }
      continue
    }
    preserved.push(child.xml)
  }
  if (!streamEmitted) preserved.push(...emitted)
  return preserved.join('')
}

// ------------------------------------------------------------------ commands

function partXmlList(xml) {
  const parts = []
  const regex = /<part\b[^>]*>[\s\S]*?<\/part>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    parts.push(match[0])
  }
  return parts
}

async function checkPiece(pieceId) {
  const { xml, midi } = await analyzePiece(pieceId)
  const timingMap = parseMusicXml(xml, `${pieceId}.musicxml`)
  const windows = measureWindows(timingMap)
  const parts = partXmlList(xml)
  const report = {
    pieceId,
    measures: timingMap.measures?.length ?? 0,
    parts: parts.length,
    midiTracks: midi.tracks.length,
    validation: timingMap.timingValidation?.status ?? 'unknown',
    overfull: timingMap.timingValidation?.summary ?? null,
    partResults: [],
  }
  if (midi.tracks.length !== parts.length) {
    report.partResults.push({ error: `MIDI has ${midi.tracks.length} note tracks but file has ${parts.length} parts` })
    return report
  }
  parts.forEach((partXml, partIndex) => {
    const partId = timingMap.parts?.[partIndex]?.id ?? `P${partIndex + 1}`
    const rows = analyzePart(partXml, timingMap, partIndex)
    const overfullMeasures = rows.filter((row) => row.notatedNoteEndQuarters > row.nominalQuarters + 1e-6)
    const match = matchPartToTrack(rows, midi.tracks[partIndex], windows, midi.division)
    report.partResults.push({
      partId,
      measures: rows.length,
      overfullMeasures: overfullMeasures.length,
      overfullWorstExcessQuarters:
        Math.round(
          overfullMeasures.reduce(
            (max, row) => Math.max(max, row.notatedNoteEndQuarters - row.nominalQuarters),
            0,
          ) * 1000,
        ) / 1000,
      midiConsistent: match.ok,
      mismatchReasons: match.reasons.slice(0, 8),
    })
  })
  return report
}

async function repairPiece(pieceId) {
  const { xmlPath, midiPath, xml, midi } = await analyzePiece(pieceId)
  const timingMap = parseMusicXml(xml, `${pieceId}.musicxml`)
  const windows = measureWindows(timingMap)
  const parts = partXmlList(xml)
  if (midi.tracks.length !== parts.length) {
    throw new Error(`refusing to repair ${pieceId}: MIDI tracks (${midi.tracks.length}) ≠ parts (${parts.length})`)
  }

  const rebuiltParts = []
  const stats = []
  parts.forEach((partXml, partIndex) => {
    const partId = timingMap.parts?.[partIndex]?.id ?? `P${partIndex + 1}`
    const rows = analyzePart(partXml, timingMap, partIndex)
    const overfull = rows.filter((row) => row.notatedNoteEndQuarters > row.nominalQuarters + 1e-6)
    if (overfull.length === 0) {
      rebuiltParts.push(partXml)
      stats.push({ partId, repaired: 0 })
      return
    }
    const match = matchPartToTrack(rows, midi.tracks[partIndex], windows, midi.division)
    if (!match.ok) {
      throw new Error(
        `refusing to repair ${pieceId} part ${partId}: MIDI does not match the file note-for-note:\n  ${match.reasons.slice(0, 12).join('\n  ')}`,
      )
    }
    const rebuiltRows = new Map()
    for (const assignment of match.assignments) {
      if (assignment.row.notatedNoteEndQuarters > assignment.row.nominalQuarters + 1e-6) {
        rebuiltRows.set(assignment.row.index, rebuildMeasure(assignment.row, assignment, windows, timingMap))
      } else {
        rebuiltRows.set(assignment.row.index, null)
      }
    }
    let rebuiltXml = partXml
    // Replace overfull measures right-to-left so earlier offsets stay valid.
    for (const [rowIndex, inner] of [...rebuiltRows.entries()].sort((left, right) => right[0] - left[0])) {
      if (inner == null) continue
      const row = rows[rowIndex]
      const start = partXml.indexOf(row.xml)
      if (start < 0) throw new Error(`m${row.number}: cannot locate measure body for replacement`)
      const openTagMatch = /^<measure\b[^>]*>/.exec(row.xml)[0]
      rebuiltXml = `${rebuiltXml.slice(0, start)}${openTagMatch}${inner}</measure>${rebuiltXml.slice(start + row.xml.length)}`
    }
    rebuiltParts.push(rebuiltXml)
    stats.push({ partId, repaired: overfull.length })
  })

  let repairedXml = xml
  parts.forEach((partXml, partIndex) => {
    const start = repairedXml.indexOf(partXml)
    if (start < 0) throw new Error(`cannot locate part ${partIndex} for replacement`)
    repairedXml = `${repairedXml.slice(0, start)}${rebuiltParts[partIndex]}${repairedXml.slice(start + partXml.length)}`
  })

  const provenanceComment =
    `\n<!-- Repaired ${new Date().toISOString().slice(0, 10)} by scripts/repair-flattened-practice-musicxml.mjs\n` +
    `     from the bundled Mutopia MIDI (the authoritative source this file was\n` +
    `     derived from): music21 MIDI-to-MusicXML conversion had flattened the\n` +
    `     two-voice texture into one sequential stream (overfull measures).\n` +
    `     Pitches and written durations preserved 1:1; onsets restored from the\n` +
    `     MIDI; voice split derived by non-overlap coloring. Verified against\n` +
    `     the MIDI note-for-note. See docs/timing-integrity-investigation.md. -->`
  repairedXml = repairedXml.replace(
    /(<\?xml[^>]*\?>\s*(?:<!DOCTYPE[^>]*>\s*)?)/,
    `$1${provenanceComment}\n`,
  )

  // Verify BEFORE writing: the rebuilt file must parse, contain the same
  // measure count and note multiset (pitch + written duration), and time-line
  // up with the MIDI onsets note-for-note.
  const verification = verifyRepair(xml, repairedXml, midi, pieceId)
  if (!verification.ok) {
    throw new Error(
      `repair verification failed for ${pieceId}:\n  ${verification.reasons.slice(0, 20).join('\n  ')}`,
    )
  }

  await writeFile(xmlPath, repairedXml, 'utf8')
  return { pieceId, xmlPath, midiPath, stats, verification }
}

/**
 * Independent verification of a repaired file against its original and MIDI:
 *  1. parses with the shipped parser
 *  2. no overfull measures remain (validation valid)
 *  3. the (pitch, duration) multiset of non-rest notes is preserved per part
 *  4. every note's parsed onset equals its MIDI onset (per measure window)
 */
function verifyRepair(originalXml, repairedXml, midi, pieceId) {
  const reasons = []
  const before = parseMusicXml(originalXml, `${pieceId}.musicxml`)
  let after
  try {
    after = parseMusicXml(repairedXml, `${pieceId}.musicxml`)
  } catch (error) {
    return { ok: false, reasons: [`repaired file does not parse: ${error?.message ?? error}`] }
  }
  if (after.timingValidation?.status !== 'valid') {
    reasons.push(
      `validation still ${after.timingValidation?.status} (${after.timingValidation?.summary?.overfullMeasureCount ?? '?'} overfull)`,
    )
  }
  if ((after.measures?.length ?? 0) !== (before.measures?.length ?? 0)) {
    reasons.push(`measure count changed: ${before.measures?.length} → ${after.measures?.length}`)
  }
  const noteKey = (note) => `${note.midi}:${note.durationQuarters.toFixed(6)}`
  for (let partIndex = 0; partIndex < (before.parts?.length ?? 0); partIndex += 1) {
    const partId = before.parts[partIndex].id
    const beforeNotes = before.notes
      .filter((note) => note.partId === partId && !note.isRest && note.midi != null)
      .map(noteKey)
      .sort()
    const afterNotes = after.notes
      .filter((note) => note.partId === partId && !note.isRest && note.midi != null)
      .map(noteKey)
      .sort()
    if (beforeNotes.length !== afterNotes.length) {
      reasons.push(`part ${partId}: note count ${beforeNotes.length} → ${afterNotes.length}`)
      continue
    }
    for (let i = 0; i < beforeNotes.length; i += 1) {
      if (beforeNotes[i] !== afterNotes[i]) {
        reasons.push(`part ${partId}: note set differs (e.g. ${beforeNotes[i]} vs ${afterNotes[i]})`)
        break
      }
    }
  }
  // Onsets match the MIDI.
  const windows = measureWindows(after)
  for (let partIndex = 0; partIndex < midi.tracks.length; partIndex += 1) {
    const partId = after.parts?.[partIndex]?.id
    const partNotes = after.notes
      .filter((note) => note.partId === partId && !note.isRest && note.midi != null)
      .map((note) => ({ midi: note.midi, quarterTime: note.quarterTime, measureNumber: note.measureNumber }))
    const track = midi.tracks[partIndex]
    if (partNotes.length !== track.length) {
      reasons.push(`part ${partId}: note count ${partNotes.length} ≠ MIDI ${track.length}`)
      continue
    }
    const byMeasure = new Map()
    for (const note of partNotes) {
      const key = note.measureNumber
      if (!byMeasure.has(key)) byMeasure.set(key, [])
      byMeasure.get(key).push(note)
    }
    for (const note of track) {
      const onsetQuarters = note.onsetTicks / midi.division
      const window = windows.find(
        (candidate) =>
          onsetQuarters >= candidate.startQuarters - 1e-6 && onsetQuarters < candidate.endQuarters - 1e-9,
      )
      if (!window) {
        reasons.push(`MIDI onset ${onsetQuarters.toFixed(4)}q has no window`)
        continue
      }
      const candidates = (byMeasure.get(window.number) ?? []).filter(
        (candidate) => candidate.midi === note.midi,
      )
      const matched = candidates.some(
        (candidate) => Math.abs(candidate.quarterTime - onsetQuarters) < 1e-6,
      )
      if (!matched) {
        reasons.push(
          `MIDI onset ${onsetQuarters.toFixed(4)}q midi ${note.midi}: no parsed note at that position in m${window.number}`,
        )
      }
    }
  }
  return { ok: reasons.length === 0, reasons }
}

async function listLibraryPieces() {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(libraryDir, { withFileTypes: true })
  const pieces = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const midiPath = join(libraryDir, entry.name, `${entry.name}.mid`)
    const xmlPath = join(libraryDir, entry.name, `${entry.name}.musicxml`)
    try {
      await Promise.all([readFile(midiPath), readFile(xmlPath, 'utf8')])
      pieces.push(entry.name)
    } catch {
      // no MIDI+MusicXML pair
    }
  }
  return pieces
}

async function main() {
  const args = process.argv.slice(2)
  const readFlag = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : null
  }

  if (args.includes('--check-all')) {
    const pieces = await listLibraryPieces()
    const reports = []
    for (const pieceId of pieces) {
      try {
        reports.push(await checkPiece(pieceId))
      } catch (error) {
        reports.push({ pieceId, error: error?.message ?? String(error) })
      }
    }
    console.log(`${'piece'.padEnd(42)} ${'m'.padStart(4)} ${'valid'.padStart(7)} ${'overfull'.padStart(9)} ${'worst'.padStart(7)} ${'midi-consistent'.padStart(15)}`)
    for (const report of reports) {
      if (report.error) {
        console.log(`${report.pieceId.padEnd(42)} ERROR ${report.error}`)
        continue
      }
      console.log(
        `${report.pieceId.padEnd(42)} ${String(report.measures).padStart(4)} ${report.validation.padStart(7)} ` +
          `${String(report.overfull?.overfullMeasureCount ?? 0).padStart(9)} ` +
          `${String(report.overfull?.worstExcessQuarters ?? 0).padStart(7)} ` +
          `${report.partResults.every((part) => part.midiConsistent) ? 'yes' : 'NO'}`.padEnd(15) +
          `${report.partResults.filter((part) => !part.midiConsistent).map((part) => part.partId).join(',')}`,
      )
    }
    return
  }

  const pieceId = readFlag('--check') ?? readFlag('--repair')
  if (!pieceId) {
    console.error('usage: --check <pieceId> | --check-all | --repair <pieceId>')
    process.exit(2)
  }
  if (args.includes('--check')) {
    const report = await checkPiece(pieceId)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const result = await repairPiece(pieceId)
  console.log(`repaired ${result.pieceId}:`, JSON.stringify(result.stats))
  // Independent verification after writing.
  const { xml } = await analyzePiece(pieceId)
  const timingMap = parseMusicXml(xml, `${pieceId}.musicxml`)
  console.log(
    `post-repair validation=${timingMap.timingValidation?.status} ` +
      `overfull=${timingMap.timingValidation?.summary?.overfullMeasureCount ?? 0} ` +
      `measures=${timingMap.measures?.length} notes=${timingMap.notes?.length}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
