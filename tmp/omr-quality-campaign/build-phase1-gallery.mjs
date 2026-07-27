import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import JSZip from 'jszip'
import { parseMusicXml } from '/Users/ryland/Documents/scoreflow/src/features/musicxml/parseMusicXml.js'

const ROOT = '/Users/ryland/Documents/scoreflow'
const ATTEMPT = join(ROOT, 'tmp/omr-quality-campaign/attempts/phase1-primary-beam')
const EVIDENCE = join(ATTEMPT, 'evidence')

// Draw a schematic of staff-1 measure content: noteheads, stems, beams or flags.
function drawMeasureSchematic(context, notes, x0, y0, width, label, sublabel) {
  context.fillStyle = '#111'
  context.font = 'bold 15px sans-serif'
  context.fillText(label, x0, y0 - 38)
  context.font = '12px sans-serif'
  context.fillText(sublabel, x0, y0 - 22)
  // staff lines
  context.strokeStyle = '#999'
  context.lineWidth = 1
  for (let line = 0; line < 5; line += 1) {
    context.beginPath()
    context.moveTo(x0, y0 + line * 10)
    context.lineTo(x0 + width, y0 + line * 10)
    context.stroke()
  }
  const events = notes
  const spacing = width / (events.length + 1)
  const stemTops = []
  context.strokeStyle = '#111'
  context.fillStyle = '#111'
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const x = x0 + spacing * (index + 1)
    const midiTop = Math.max(...event.midis)
    // vertical placement: map midi 60..86 into staff area loosely
    const y = y0 + 40 - ((midiTop - 60) / 26) * 50
    for (let noteIdx = 0; noteIdx < event.midis.length; noteIdx += 1) {
      const noteY = y + noteIdx * 7
      context.beginPath()
      context.ellipse(x, noteY, 5.5, 4, -0.3, 0, Math.PI * 2)
      if (event.type === 'quarter' || event.type === 'eighth' || event.type === 'sixteenth') {
        context.fill()
      } else {
        context.stroke()
      }
    }
    const stemTopY = y - 32
    context.lineWidth = 1.6
    context.beginPath()
    context.moveTo(x + 5.5, y)
    context.lineTo(x + 5.5, stemTopY)
    context.stroke()
    stemTops.push({ x: x + 5.5, y: stemTopY, event })
    if (event.dotted) {
      context.beginPath()
      context.arc(x + 12, y, 2, 0, Math.PI * 2)
      context.fill()
    }
    context.font = '10px sans-serif'
    context.fillText(event.type + (event.dotted ? '.' : ''), x - 12, y0 + 62)
  }
  // beams / flags
  for (let index = 0; index < stemTops.length; index += 1) {
    const { x, y, event } = stemTops[index]
    const beamValues = event.beams ?? []
    if (beamValues.some((beam) => beam.value === 'begin' || beam.value === 'continue')) {
      const next = stemTops[index + 1]
      if (next) {
        context.lineWidth = 4.5
        context.beginPath()
        context.moveTo(x - 1, y + 2)
        context.lineTo(next.x + 1, next.y + 2)
        context.stroke()
        context.lineWidth = 1.6
      }
    } else if (!beamValues.length && (event.type === 'eighth' || event.type === 'sixteenth')) {
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x, y)
      context.quadraticCurveTo(x + 9, y + 4, x + 6, y + 15)
      context.stroke()
      context.lineWidth = 1.6
    }
  }
}

function staffOneEvents(score, measureNumber) {
  const rows = []
  const notes = score.notes.filter(
    (note) => note.measureNumber === measureNumber && !note.isRest && note.midi != null && note.staff === 1,
  )
  for (const note of notes) {
    const last = rows[rows.length - 1]
    if (note.isChord && last) {
      last.midis.push(note.midi)
      continue
    }
    rows.push({
      midis: [note.midi],
      type: note.noteType,
      dotted: (note.dots ?? 0) > 0,
      beams: note.beams ?? [],
    })
  }
  return rows
}

const baselineXml = await readFile(join(ROOT, 'tmp/omr-quality-campaign/baseline/generated/carol-of-the-bells.musicxml'), 'utf8')
const candidateXml = await readFile(join(ATTEMPT, 'generated/carol-of-the-bells.musicxml'), 'utf8')
const baseline = parseMusicXml(baselineXml, 'baseline')
const candidate = parseMusicXml(candidateXml, 'candidate')

const canvas = createCanvas(1540, 420)
const context = canvas.getContext('2d')
context.fillStyle = '#f7f8fa'
context.fillRect(0, 0, canvas.width, canvas.height)
context.fillStyle = '#111'
context.font = 'bold 17px sans-serif'
context.fillText('Carol of the Bells m14 (treble) — primary beam topology promotion', 20, 30)

// Panel 1: PDF crop (m14 is last measure of system 2)
const systemImage = await loadImage(join(EVIDENCE, 'carol-p1-system2-m8-14.png'))
// m14 spans roughly x 862..1000 of the 1000px system crop
context.drawImage(systemImage, 850, 0, 150, 200, 20, 60, 255, 340)
context.font = 'bold 15px sans-serif'
context.fillText('Original PDF m14', 20, 52)

drawMeasureSchematic(context, staffOneEvents(baseline, 14), 340, 170, 420,
  'Baseline Corranzo m14', 'A5+F5 emitted as quarter; no beam; sixteenth tail')
drawMeasureSchematic(context, staffOneEvents(candidate, 14), 960, 170, 420,
  'Phase-1 candidate m14', 'G5 begin -> A5+F5 end recovered as beamed eighths')

await writeFile(join(EVIDENCE, 'carol-m14-gallery.png'), canvas.toBuffer('image/png'))
console.log('wrote', join(EVIDENCE, 'carol-m14-gallery.png'))
