#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'public', 'fixtures', 'guitar-ode-to-joy')

const TEMPO = 84
const DIVISIONS = 4
const QUARTER_TICKS = 480
const CHANNEL = 0
const VELOCITY = 84

const NOTES = [
  ['E', 4, 1, 0],
  ['F', 4, 1, 1],
  ['G', 4, 1, 3],
  ['G', 4, 1, 3],
  ['F', 4, 1, 1],
  ['E', 4, 1, 0],
  ['D', 4, 2, 3],
  ['C', 4, 2, 1],
  ['C', 4, 2, 1],
  ['D', 4, 2, 3],
  ['E', 4, 1, 0],
  ['E', 4, 1, 0],
  ['D', 4, 2, 3],
  ['D', 4, 2, 3],
  ['E', 4, 1, 0],
  ['F', 4, 1, 1],
  ['G', 4, 1, 3],
  ['G', 4, 1, 3],
  ['F', 4, 1, 1],
  ['E', 4, 1, 0],
  ['D', 4, 2, 3],
  ['C', 4, 2, 1],
  ['C', 4, 2, 1],
  ['D', 4, 2, 3],
  ['E', 4, 1, 0],
  ['D', 4, 2, 3],
  ['C', 4, 2, 1],
  ['C', 4, 2, 1],
]

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function midiFor(step, octave) {
  return (octave + 1) * 12 + STEP_TO_SEMITONE[step]
}

function noteXml([step, octave, stringNumber, fret], { staff, tabMirror = false }) {
  const staffTag = `<staff>${staff}</staff>`
  const technical = tabMirror
    ? `<notations><technical><string>${stringNumber}</string><fret>${fret}</fret></technical></notations>`
    : ''
  return [
    '<note>',
    `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`,
    `<duration>${DIVISIONS}</duration>`,
    '<voice>1</voice>',
    '<type>quarter</type>',
    staffTag,
    technical,
    '</note>',
  ].join('')
}

function buildMusicXml() {
  const measures = []
  for (let measureIndex = 0; measureIndex < Math.ceil(NOTES.length / 4); measureIndex += 1) {
    const measureNotes = NOTES.slice(measureIndex * 4, measureIndex * 4 + 4)
    const attrs =
      measureIndex === 0
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
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${TEMPO}</per-minute></metronome></direction-type>
        <sound tempo="${TEMPO}"/>
      </direction>`
        : ''
    measures.push(`
    <measure number="${measureIndex + 1}">
      ${attrs}
      ${measureNotes.map((note) => noteXml(note, { staff: 1 })).join('\n      ')}
      <backup><duration>${DIVISIONS * measureNotes.length}</duration></backup>
      ${measureNotes.map((note) => noteXml(note, { staff: 2, tabMirror: true })).join('\n      ')}
      ${measureIndex === Math.ceil(NOTES.length / 4) - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}
    </measure>`)
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Ode to Joy</work-title></work>
  <movement-title>Ode to Joy — Beginner Guitar Demo</movement-title>
  <identification>
    <creator type="composer">Ludwig van Beethoven</creator>
    <rights>Public domain source melody; beginner guitar arrangement for Corranzo demo.</rights>
    <encoding><software>Corranzo fixture generator</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Guitar</part-name>
      <score-instrument id="P1-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>25</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    ${measures.join('\n')}
  </part>
</score-partwise>
`
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

function buildMidi() {
  const events = []
  const push = (delta, ...bytes) => {
    events.push(...varLen(delta), ...bytes)
  }
  push(0, 0xff, 0x51, 0x03, ...intBytes(Math.round(60_000_000 / TEMPO), 3))
  push(0, 0xc0 | CHANNEL, 24)
  for (const note of NOTES) {
    const midi = midiFor(note[0], note[1])
    push(0, 0x90 | CHANNEL, midi, VELOCITY)
    push(QUARTER_TICKS, 0x80 | CHANNEL, midi, 0)
  }
  push(0, 0xff, 0x2f, 0x00)
  const header = [...ascii('MThd'), ...intBytes(6, 4), ...intBytes(0, 2), ...intBytes(1, 2), ...intBytes(QUARTER_TICKS, 2)]
  const track = [...ascii('MTrk'), ...intBytes(events.length, 4), ...events]
  return Buffer.from([...header, ...track])
}

function intBytes(value, length) {
  return Array.from({ length }, (_, index) => (value >> ((length - index - 1) * 8)) & 0xff)
}

function ascii(value) {
  return [...value].map((char) => char.charCodeAt(0))
}

function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdf() {
  const width = 612
  const height = 792
  const ops = []
  const text = (x, y, size, value) => {
    ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`)
  }
  const line = (x1, y1, x2, y2, w = 0.8) => {
    ops.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`)
  }
  const circle = (x, y) => {
    ops.push(`q 1 0 0 1 ${x} ${y} cm 6 0 m 6 3.3 3.3 6 0 6 c -3.3 6 -6 3.3 -6 0 c -6 -3.3 -3.3 -6 0 -6 c 3.3 -6 6 -3.3 6 0 c f Q`)
  }

  text(54, 748, 20, 'Ode to Joy')
  text(54, 726, 11, 'Ludwig van Beethoven — public domain beginner guitar arrangement')
  text(54, 710, 10, 'Standard notation with tablature · Tempo quarter = 84 · Duration about 20 seconds')

  const systems = [620, 470]
  const measureWidth = 126
  const startX = 74
  let noteIndex = 0
  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const y = systems[systemIndex]
    text(38, y + 18, 10, systemIndex === 0 ? 'Staff' : 'Staff')
    for (let i = 0; i < 5; i += 1) line(startX, y - i * 8, startX + measureWidth * 4, y - i * 8)
    text(38, y - 74, 10, 'TAB')
    for (let i = 0; i < 6; i += 1) line(startX, y - 84 - i * 8, startX + measureWidth * 4, y - 84 - i * 8)
    for (let measure = 0; measure <= 4; measure += 1) {
      const x = startX + measure * measureWidth
      line(x, y + 2, x, y - 34)
      line(x, y - 82, x, y - 124)
    }
    for (let measure = 0; measure < 4; measure += 1) {
      const mx = startX + measure * measureWidth
      text(mx + 4, y + 10, 8, String(systemIndex * 4 + measure + 1))
      for (let beat = 0; beat < 4; beat += 1) {
        const note = NOTES[noteIndex]
        if (!note) break
        const x = mx + 20 + beat * 27
        const staffY = y - staffOffset(note[0])
        circle(x, staffY)
        line(x + 6, staffY, x + 6, staffY + 32, 0.7)
        const tabY = y - 84 - (note[2] - 1) * 8
        text(x - 3, tabY - 3, 10, String(note[3]))
        noteIndex += 1
      }
    }
  }

  text(54, 300, 11, 'Practice goals: play the melody, use Wait For You, and watch Visual Practice show fret targets.')
  text(54, 282, 10, 'TAB strings are numbered MusicXML-style: string 1 is high E; string 2 is B.')

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

function staffOffset(step) {
  return { C: 32, D: 28, E: 24, F: 20, G: 16 }[step] ?? 24
}

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'guitar-ode-to-joy.musicxml'), buildMusicXml())
await writeFile(join(outDir, 'guitar-ode-to-joy.mid'), buildMidi())
await writeFile(join(outDir, 'guitar-ode-to-joy.pdf'), buildPdf())
console.log(`Wrote guitar demo fixture to ${outDir}`)
