/**
 * Deterministic audio examples for later human listening comparison.
 *
 * Renders a fixed set of short performances through the REAL voice modules
 * (Tone.Offline — no user gesture, identical PCM every run) and writes
 * 16-bit mono WAVs to scripts/audio-render/examples/.
 *
 * Not part of `npm test` (artifacts, not assertions) — run on demand:
 *   node scripts/audio-render/export-examples.mjs
 *
 * The files are small by design (short excerpts, single takes); the full
 * automated proof lives in tests/audioRender.test.js.
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = resolve(projectRoot, 'scripts', 'audio-render', 'examples')

function scoreXml(measuresInner) {
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">` +
    `<part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>` +
    `<part id="P1">${measuresInner}</part></score-partwise>`
}

function qNote(step, octave = 4, duration = 1, extra = '') {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>1</voice><type>quarter</type>${extra}</note>`
}

const ATTRS =
  `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction>`

const EXAMPLES = [
  {
    name: 'piano-dynamics-ladder',
    voice: 'piano',
    notes: [0.36, 0.46, 0.56, 0.7, 0.82, 0.91, 0.98].map((velocity, index) => ({
      name: 'C4', time: 0.2 + index * 0.7, duration: 0.6, velocity,
    })),
    tailSeconds: 1.5,
  },
  {
    name: 'piano-crescendo',
    voice: 'piano',
    musicXml: scoreXml(
      `<measure number="1">${ATTRS}` +
      `<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>` +
      `<direction><direction-type><wedge type="crescendo"/></direction-type></direction>` +
      `${['C', 'D', 'E', 'F'].map((s) => qNote(s)).join('')}` +
      `<direction><direction-type><wedge type="stop"/></direction-type></direction></measure>`,
    ),
    instrumentId: 'piano',
  },
  {
    name: 'piano-pedal-staccato',
    voice: 'piano',
    notes: [
      { name: 'C4', time: 0.2, duration: 2.2, velocity: 0.8 },
      { name: 'E4', time: 1.2, duration: 0.25, velocity: 0.8 },
      { name: 'G4', time: 1.7, duration: 0.25, velocity: 0.8 },
    ],
    tailSeconds: 2.0,
  },
  {
    name: 'guitar-strum-emajor',
    voice: 'guitar',
    notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'].map((name, index) => ({
      name, time: 0.5 + index * 0.009, duration: 1.8, velocity: 0.85 - index * 0.02,
    })),
    tailSeconds: 2.0,
  },
  {
    name: 'guitar-palm-mute-vs-ring',
    voice: 'guitar',
    notes: [
      { name: 'E3', time: 0.2, duration: 1.0, velocity: 0.8, muted: true },
      { name: 'E3', time: 1.5, duration: 1.0, velocity: 0.8 },
    ],
    tailSeconds: 2.0,
  },
  {
    name: 'acoustic-vs-electric-a3',
    voice: 'guitar',
    notes: [{ name: 'A3', time: 0.2, duration: 1.2, velocity: 0.8 }],
    tailSeconds: 1.5,
  },
  {
    name: 'electric-a3',
    voice: 'electric',
    notes: [{ name: 'A3', time: 0.2, duration: 1.2, velocity: 0.8 }],
    tailSeconds: 1.5,
  },
]

function writeWavMono16(filePath, samples, sampleRate) {
  const count = samples.length
  const buffer = Buffer.alloc(44 + count * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + count * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(count * 2, 40)
  for (let index = 0; index < count; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2)
  }
  writeFileSync(filePath, buffer)
}

const server = await createServer({
  root: projectRoot,
  configFile: resolve(projectRoot, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(`${baseUrl}/scripts/audio-render/render.html`, { waitUntil: 'load' })
mkdirSync(outDir, { recursive: true })

for (const example of EXAMPLES) {
  const result = await page.evaluate(async (job) => {
    if (job.musicXml) {
      return window.__renderApi.renderSchedule({
        musicXml: job.musicXml,
        voice: job.voice,
        instrumentId: job.instrumentId ?? null,
        tailSeconds: job.tailSeconds ?? 2.5,
      })
    }
    return window.__renderApi.render({
      voice: job.voice,
      notes: job.notes,
      tailSeconds: job.tailSeconds ?? 2.5,
    })
  }, example)
  const file = resolve(outDir, `${example.name}.wav`)
  writeWavMono16(file, result.samples, result.sampleRate)
  console.log(`${example.name}.wav  engine=${result.engineType} sr=${result.sampleRate} n=${result.samples.length}`)
}

await browser.close()
await server.close()
console.log(`wrote ${EXAMPLES.length} examples → ${outDir}`)
