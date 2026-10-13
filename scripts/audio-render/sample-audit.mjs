/**
 * Sample-set audit — measures what the bundled samples can actually
 * contribute to timbre, and how much loudness headroom the master chain
 * has. Feeds both the license audit (provenance) and the realism limits
 * (bandwidth caps any brightness work).
 *
 *   node scripts/audio-render/sample-audit.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SETS = {
  piano: ['A0', 'C4', 'A6', 'C8'],
  'guitar-acoustic': ['E2', 'A3', 'D5'],
  'guitar-electric': ['A3', 'C4', 'A5'],
}

const PROBE_FREQS = [100, 200, 400, 800, 1200, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 14000, 16000]

const server = await createServer({
  root: projectRoot,
  configFile: resolve(projectRoot, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })

const samplePage = await browser.newPage()
await samplePage.goto(`${baseUrl}/scripts/audio-render/sample-probe.html`, { waitUntil: 'load' })
const results = await samplePage.evaluate(async (job) => window.__sampleProbe(job.sets), { sets: SETS })

const renderPage = await browser.newPage()

for (const [set, rows] of Object.entries(results)) {
  const dir = set === 'piano' ? 'salamander' : set
  console.log(`=== ${set} (public/audio/${dir}) ===`)
  console.log('  note   sr     dur    peak   E<4k   E>8k   E>12k')
  for (const row of rows) {
    console.log(
      `  ${row.note.padEnd(6)} ${row.sampleRate} ${String(row.durationSeconds).padStart(5)} ` +
        `${String(row.peak).padStart(6)} ${String(row.energyBelow4k).padStart(6)} ` +
        `${String(row.energyAbove8k).padStart(6)} ${String(row.energyAbove12k).padStart(6)}`,
    )
  }
  console.log(
    `  limits: nothing above ${rows.every((r) => r.energyAbove12k < 0.01) ? '12 kHz' : '8 kHz'} carries energy in this set`,
  )
}

console.log('\n=== headroom vs the -3.5 dB limiter ceiling (0.67) ===')
const peakOf = async (spec) => {
  await renderPage.goto(`${baseUrl}/scripts/audio-render/render.html`, { waitUntil: 'load' })
  const r = await renderPage.evaluate(
    async (job) => window.__renderApi.renderNotes(job.voice, job.notes, 2.5, null),
    spec,
  )
  let peak = 0
  for (const s of r.samples) {
    const a = Math.abs(s)
    if (a > peak) peak = a
  }
  return peak
}
const cases = [
  ['piano single fff', { voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 0.5, velocity: 0.98 }] }],
  ['piano 4-note chord fff', {
    voice: 'piano',
    notes: ['C4', 'E4', 'G4', 'C5'].map((n) => ({ name: n, time: 0.2, duration: 1.0, velocity: 0.98 })),
  }],
  ['piano 8-note chord fff', {
    voice: 'piano',
    notes: ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6'].map((n) => ({ name: n, time: 0.2, duration: 1.0, velocity: 0.98 })),
  }],
  ['guitar 6-string fff', {
    voice: 'guitar',
    notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'].map((n, i) => ({ name: n, time: 0.2 + i * 0.009, duration: 1.8, velocity: 0.98 })),
  }],
]
for (const [label, spec] of cases) {
  const peak = await peakOf(spec)
  console.log(`  ${label.padEnd(28)} peak ${peak.toFixed(4)}  (headroom ${(20 * Math.log10(0.67 / Math.max(1e-9, peak))).toFixed(1)} dB)`)
}

await browser.close()
await server.close()
console.log('sample audit complete')
