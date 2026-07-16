#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outRoot = join(root, 'public', 'fixtures', 'practice-library')

const DIVISIONS = 4
const QUARTER_TICKS = 480
const PIANO_CHANNEL = 0
const GUITAR_CHANNEL = 0
const VELOCITY = 84
// Shared MusicXML ↔ PDF layout (tenths). Keeps auto-setup off the 30% first-measure fallback.
const MEASURE_WIDTH = 106
const FIRST_NOTE_OFFSET_X = 16
const NOTE_SPACING_X = 22
const PDF_START_X = 74
const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const TYPE_BY_BEATS = new Map([
  [0.5, 'eighth'],
  [1, 'quarter'],
  [2, 'half'],
  [4, 'whole'],
])

// Piano library cards use curated public-domain score fixtures instead of the
// generated single-staff sketches; the sketches looked like notation practice
// data, not music a pianist should be asked to read.
const PIANO_PIECES = []

const GUITAR_PIECES = [
  {
    id: 'guitar-amazing-grace',
    title: 'Amazing Grace',
    subtitle: 'Beginner open-position hymn',
    composer: 'Traditional',
    tempo: 78,
    notes: guitarNotes([
      ['G3', 1, 3, 0], ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['C4', 1, 2, 1],
      ['E4', 1, 1, 0], ['D4', 1, 2, 3], ['C4', 2, 2, 1],
      ['G3', 1, 3, 0], ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['C4', 1, 2, 1],
      ['E4', 1, 1, 0], ['D4', 1, 2, 3], ['C4', 2, 2, 1],
    ]),
  },
  {
    id: 'guitar-when-the-saints',
    title: 'When the Saints Go Marching In',
    subtitle: 'Beginner first-position rhythm',
    composer: 'Traditional',
    tempo: 96,
    notes: guitarNotes([
      ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['F4', 1, 1, 1], ['G4', 1, 1, 3],
      ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['F4', 1, 1, 1], ['G4', 1, 1, 3],
      ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['F4', 1, 1, 1], ['G4', 1, 1, 3],
      ['E4', 1, 1, 0], ['C4', 1, 2, 1], ['E4', 1, 1, 0], ['D4', 1, 2, 3],
      ['D4', 2, 2, 3], ['C4', 2, 2, 1],
    ]),
  },
  {
    id: 'guitar-aura-lee',
    title: 'Aura Lee',
    subtitle: 'Intermediate first-position melody',
    composer: 'Traditional',
    tempo: 88,
    notes: guitarNotes([
      ['G3', 1, 3, 0], ['A3', 1, 3, 2], ['B3', 1, 2, 0], ['C4', 1, 2, 1],
      ['D4', 1, 2, 3], ['E4', 1, 1, 0], ['C4', 2, 2, 1],
      ['E4', 1, 1, 0], ['F4', 1, 1, 1], ['G4', 1, 1, 3], ['E4', 1, 1, 0],
      ['D4', 1, 2, 3], ['C4', 1, 2, 1], ['B3', 2, 2, 0],
      ['G3', 1, 3, 0], ['A3', 1, 3, 2], ['B3', 1, 2, 0], ['C4', 1, 2, 1],
      ['D4', 1, 2, 3], ['E4', 1, 1, 0], ['G4', 2, 1, 3],
      ['E4', 1, 1, 0], ['D4', 1, 2, 3], ['C4', 1, 2, 1], ['B3', 1, 2, 0],
      ['A3', 1, 3, 2], ['G3', 1, 3, 0], ['C4', 2, 2, 1],
    ]),
  },
]

function n(pitch, beats = 1) {
  return { pitch, beats }
}

function r(beats = 1) {
  return { rest: true, beats }
}

function q(pitches) {
  return pitches.map((pitch) => (pitch ? n(pitch, 1) : r(1)))
}

function e(pitches) {
  return pitches.map((pitch) => n(pitch, 0.5))
}

function guitarNotes(rows) {
  return rows.map(([pitch, beats, string, fret]) => ({ pitch, beats, string, fret }))
}

function parsePitch(pitch) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch)
  if (!match) {
    throw new Error(`Invalid pitch: ${pitch}`)
  }
  const [, step, accidental, octaveText] = match
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return { step, alter, octave: Number(octaveText) }
}

function midiForPitch(pitch) {
  const parsed = parsePitch(pitch)
  return (parsed.octave + 1) * 12 + STEP_TO_SEMITONE[parsed.step] + parsed.alter
}

function durationDivisions(beats) {
  return Math.round(Number(beats) * DIVISIONS)
}

function typeForBeats(beats) {
  return TYPE_BY_BEATS.get(Number(beats)) ?? 'quarter'
}

function groupMeasures(notes) {
  const measures = []
  let current = []
  let total = 0
  for (const note of notes) {
    const beats = Number(note.beats)
    if (total + beats > 4) {
      if (total < 4) {
        current.push(r(4 - total))
      }
      measures.push(current)
      current = []
      total = 0
    }
    current.push(note)
    total += beats
    if (total === 4) {
      measures.push(current)
      current = []
      total = 0
    }
  }
  if (current.length > 0) {
    if (total < 4) {
      current.push(r(4 - total))
    }
    measures.push(current)
  }
  return measures
}

function pitchXml(pitch) {
  const parsed = parsePitch(pitch)
  const alter = parsed.alter ? `<alter>${parsed.alter}</alter>` : ''
  return `<pitch><step>${parsed.step}</step>${alter}<octave>${parsed.octave}</octave></pitch>`
}

function noteDefaultXForBeat(beatOffset) {
  return FIRST_NOTE_OFFSET_X + beatOffset * NOTE_SPACING_X
}

function noteXml(note, { staff = null, tabMirror = false, defaultX = null } = {}) {
  const staffTag = staff ? `<staff>${staff}</staff>` : ''
  const layoutAttr = Number.isFinite(defaultX) ? ` default-x="${defaultX}"` : ''
  if (note.rest) {
    return `<note${layoutAttr}><rest/><duration>${durationDivisions(note.beats)}</duration><voice>1</voice><type>${typeForBeats(note.beats)}</type>${staffTag}</note>`
  }
  const technical = tabMirror
    ? `<notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations>`
    : ''
  return [
    `<note${layoutAttr}>`,
    pitchXml(note.pitch),
    `<duration>${durationDivisions(note.beats)}</duration>`,
    '<voice>1</voice>',
    `<type>${typeForBeats(note.beats)}</type>`,
    staffTag,
    technical,
    '</note>',
  ].join('')
}

function measureNotesXml(measure, options = {}) {
  let beat = 0
  return measure
    .map((note) => {
      const defaultX = noteDefaultXForBeat(beat)
      const xml = noteXml(note, { ...options, defaultX })
      beat += note.beats
      return xml
    })
    .join('\n      ')
}

function buildPianoMusicXml(piece) {
  const measures = groupMeasures(piece.notes)
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escapeXml(piece.title)}</work-title></work>
  <movement-title>${escapeXml(piece.title)} - ${escapeXml(piece.subtitle)}</movement-title>
  <identification>
    <creator type="composer">${escapeXml(piece.composer)}</creator>
    <rights>Public domain source material; Corranzo beginner practice arrangement.</rights>
    <encoding><software>Corranzo Practice Library</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${measures.map((measure, index) => {
  const attrs = index === 0
    ? `
      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.tempo}</per-minute></metronome></direction-type>
        <sound tempo="${piece.tempo}"/>
      </direction>`
    : ''
  return `    <measure number="${index + 1}" width="${MEASURE_WIDTH}">${attrs}
      ${measureNotesXml(measure)}
      ${index === measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}
    </measure>`
}).join('\n')}
  </part>
</score-partwise>
`
}

function buildGuitarMusicXml(piece) {
  const measures = groupMeasures(piece.notes)
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escapeXml(piece.title)}</work-title></work>
  <movement-title>${escapeXml(piece.title)} - ${escapeXml(piece.subtitle)}</movement-title>
  <identification>
    <creator type="composer">${escapeXml(piece.composer)}</creator>
    <rights>Public domain source material; Corranzo beginner guitar practice arrangement.</rights>
    <encoding><software>Corranzo Practice Library</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Guitar</part-name>
      <score-instrument id="P1-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>25</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${measures.map((measure, index) => {
  const totalDuration = measure.reduce((sum, note) => sum + durationDivisions(note.beats), 0)
  const attrs = index === 0
    ? `
      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>TAB</sign><line>5</line></clef>
        <staff-details number="2">
          <staff-lines>6</staff-lines>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.tempo}</per-minute></metronome></direction-type>
        <sound tempo="${piece.tempo}"/>
      </direction>`
    : ''
  return `    <measure number="${index + 1}" width="${MEASURE_WIDTH}">${attrs}
      ${measureNotesXml(measure, { staff: 1 })}
      <backup><duration>${totalDuration}</duration></backup>
      ${(() => {
        let beat = 0
        return measure
          .map((note) => {
            const defaultX = noteDefaultXForBeat(beat)
            const xml = note.rest
              ? noteXml(note, { staff: 2, defaultX })
              : noteXml(note, { staff: 2, tabMirror: true, defaultX })
            beat += note.beats
            return xml
          })
          .join('\n      ')
      })()}
      ${index === measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}
    </measure>`
}).join('\n')}
  </part>
</score-partwise>
`
}

function buildMidi(piece, channel, program) {
  const events = []
  const push = (delta, ...bytes) => events.push(...varLen(delta), ...bytes)
  push(0, 0xff, 0x51, 0x03, ...intBytes(Math.round(60_000_000 / piece.tempo), 3))
  push(0, 0xc0 | channel, program)
  for (const note of piece.notes) {
    const ticks = Math.round(note.beats * QUARTER_TICKS)
    if (note.rest) {
      push(ticks, 0xff, 0x01, 0x00)
      continue
    }
    const midi = midiForPitch(note.pitch)
    push(0, 0x90 | channel, midi, VELOCITY)
    push(ticks, 0x80 | channel, midi, 0)
  }
  push(0, 0xff, 0x2f, 0x00)
  const header = [...ascii('MThd'), ...intBytes(6, 4), ...intBytes(0, 2), ...intBytes(1, 2), ...intBytes(QUARTER_TICKS, 2)]
  const track = [...ascii('MTrk'), ...intBytes(events.length, 4), ...events]
  return Buffer.from([...header, ...track])
}

function buildPdf(piece, instrument) {
  const width = 612
  const height = 792
  const ops = []
  const text = (x, y, size, value) => {
    ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`)
  }
  const line = (x1, y1, x2, y2, w = 0.8, gray = 0) => {
    if (gray > 0) {
      ops.push(`q ${gray} G ${w} w ${x1} ${y1} m ${x2} ${y2} l S Q`)
      return
    }
    ops.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`)
  }
  const circle = (x, y) => {
    ops.push(`q 1 0 0 1 ${x} ${y} cm 5 0 m 5 2.8 2.8 5 0 5 c -2.8 5 -5 2.8 -5 0 c -5 -2.8 -2.8 -5 0 -5 c 2.8 -5 5 -2.8 5 0 c f Q`)
  }

  text(54, 748, 20, piece.title)
  text(54, 726, 11, `${piece.composer} - public-domain practice score`)
  text(54, 710, 10, `${instrument} - ${piece.subtitle} - Tempo quarter = ${piece.tempo}`)

  if (instrument === 'Guitar') {
    drawGuitarSystems({ piece, text, line, circle })
  } else {
    drawPianoSystems({ piece, text, line, circle })
  }

  text(54, 96, 10, 'Corranzo Practice Library - public-domain melody with aligned MusicXML and MIDI.')
  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

function drawPianoSystems({ piece, text, line, circle }) {
  const measures = groupMeasures(piece.notes)
  const startX = PDF_START_X
  const measureWidth = MEASURE_WIDTH
  const systems = [620, 490, 360, 230]
  let measureIndex = 0
  for (const y of systems) {
    if (measureIndex >= measures.length) break
    const count = Math.min(4, measures.length - measureIndex)
    text(38, y + 18, 10, 'Staff')
    for (let i = 0; i < 5; i += 1) {
      line(startX, y - i * 8, startX + measureWidth * count, y - i * 8)
    }
    for (let measure = 0; measure <= count; measure += 1) {
      const x = startX + measure * measureWidth
      line(x, y + 2, x, y - 34)
    }
    for (let local = 0; local < count; local += 1) {
      const measure = measures[measureIndex + local]
      const mx = startX + local * measureWidth
      text(mx + 4, y + 10, 8, String(measureIndex + local + 1))
      let beat = 0
      for (const note of measure) {
        const x = mx + noteDefaultXForBeat(beat)
        if (note.rest) {
          text(x - 2, y - 18, 10, 'r')
        } else {
          circle(x, y - staffOffset(parsePitch(note.pitch).step))
          line(x + 5, y - staffOffset(parsePitch(note.pitch).step), x + 5, y - staffOffset(parsePitch(note.pitch).step) + 25, 0.35, 0.65)
        }
        beat += note.beats
      }
    }
    measureIndex += count
  }
}

function drawGuitarSystems({ piece, text, line, circle }) {
  const measures = groupMeasures(piece.notes)
  const startX = PDF_START_X
  const measureWidth = MEASURE_WIDTH
  const systems = [620, 450, 280]
  let measureIndex = 0
  for (const y of systems) {
    if (measureIndex >= measures.length) break
    const count = Math.min(4, measures.length - measureIndex)
    text(38, y + 18, 10, 'Staff')
    for (let i = 0; i < 5; i += 1) {
      line(startX, y - i * 8, startX + measureWidth * count, y - i * 8)
    }
    text(38, y - 74, 10, 'TAB')
    for (let i = 0; i < 6; i += 1) {
      line(startX, y - 84 - i * 8, startX + measureWidth * count, y - 84 - i * 8)
    }
    for (let measure = 0; measure <= count; measure += 1) {
      const x = startX + measure * measureWidth
      line(x, y + 2, x, y - 34)
      line(x, y - 82, x, y - 124)
    }
    for (let local = 0; local < count; local += 1) {
      const measure = measures[measureIndex + local]
      const mx = startX + local * measureWidth
      text(mx + 4, y + 10, 8, String(measureIndex + local + 1))
      let beat = 0
      for (const note of measure) {
        const x = mx + noteDefaultXForBeat(beat)
        if (!note.rest) {
          circle(x, y - staffOffset(parsePitch(note.pitch).step))
          line(x + 5, y - staffOffset(parsePitch(note.pitch).step), x + 5, y - staffOffset(parsePitch(note.pitch).step) + 25, 0.35, 0.65)
          const tabY = y - 84 - (note.string - 1) * 8
          text(x - 3, tabY - 3, 10, String(note.fret))
        }
        beat += note.beats
      }
    }
    measureIndex += count
  }
}

function staffOffset(step) {
  return { C: 32, D: 28, E: 24, F: 20, G: 16, A: 12, B: 8 }[step] ?? 24
}

function varLen(value) {
  let buffer = value & 0x7f
  const bytes = []
  while ((value >>= 7)) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }
  while (true) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) {
      buffer >>= 8
    } else {
      break
    }
  }
  return bytes
}

function intBytes(value, length) {
  return Array.from({ length }, (_, index) => (value >> ((length - index - 1) * 8)) & 0xff)
}

function ascii(value) {
  return [...value].map((char) => char.charCodeAt(0))
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pdfEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

async function writePiece(piece, instrument) {
  const dir = join(outRoot, piece.id)
  await mkdir(dir, { recursive: true })
  const musicXml = instrument === 'Guitar' ? buildGuitarMusicXml(piece) : buildPianoMusicXml(piece)
  const midi = buildMidi(piece, instrument === 'Guitar' ? GUITAR_CHANNEL : PIANO_CHANNEL, instrument === 'Guitar' ? 24 : 0)
  const pdf = buildPdf(piece, instrument)
  await Promise.all([
    writeFile(join(dir, `${piece.id}.musicxml`), musicXml),
    writeFile(join(dir, `${piece.id}.mid`), midi),
    writeFile(join(dir, `${piece.id}.pdf`), pdf),
  ])
}

await mkdir(outRoot, { recursive: true })
for (const piece of PIANO_PIECES) {
  await writePiece(piece, 'Piano')
}
for (const piece of GUITAR_PIECES) {
  await writePiece(piece, 'Guitar')
}

console.log(`Wrote ${PIANO_PIECES.length + GUITAR_PIECES.length} practice library fixtures to ${outRoot}`)
