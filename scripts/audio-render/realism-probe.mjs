/**
 * Realism probe — reports measurements, asserts nothing.
 *
 * Complements tests/playbackAcceptance.test.js: where the acceptance
 * suite FROZEN thresholds, this tool re-reports raw numbers so a future
 * change can be judged rather than guessed at. Run it whenever playback
 * tone, dynamics, or scheduling are touched:
 *
 *   node scripts/audio-render/realism-probe.mjs
 *
 * Deterministic: Tone.Offline + fixed notes means the same PCM every run.
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapPlaybackVelocity } from '../../src/features/playback/pianoVelocity.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---------- analysis ----------

function rms(samples, from, to, sampleRate) {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  if (end <= start) return 0
  let sum = 0
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (end - start))
}

function windowEnergy(samples, sampleRate, from, to) {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  let total = 0
  for (let i = start; i < end; i += 1) total += samples[i] * samples[i]
  return total
}

function peakAbsolute(samples, from, to, sampleRate) {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  let peak = 0
  for (let i = start; i < end; i += 1) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  return peak
}

function clippedCount(samples, from, to, sampleRate) {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  let clipped = 0
  for (let i = start; i < end; i += 1) if (Math.abs(samples[i]) >= 0.999) clipped += 1
  return clipped
}

/**
 * Detect attack times with a short-time energy envelope, clustered by a
 * minimum gap. A sample-to-sample delta count does NOT work here: the
 * bundled mp3 samples carry noise above any fixed threshold all the time,
 * so it counts thousands of "facets" instead of attacks. An envelope
 * crossing is what an audible onset actually looks like.
 */
function onsetCount(samples, from, to, sampleRate, minGapSeconds = 0.03) {
  const hop = Math.max(1, Math.floor(sampleRate * 0.005))
  const frame = Math.max(hop, Math.floor(sampleRate * 0.01))
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  const energies = []
  for (let cursor = start; cursor + frame <= end; cursor += hop) {
    let sum = 0
    for (let i = cursor; i < cursor + frame; i += 1) {
      sum += samples[i] * samples[i]
    }
    energies.push({ time: cursor / sampleRate, value: sum / frame })
  }
  if (energies.length === 0) {
    return 0
  }
  const peak = energies.reduce((max, entry) => Math.max(max, entry.value), 0)
  if (peak <= 0) {
    return 0
  }
  const threshold = peak * 0.12
  let clusters = 0
  let nextAllowed = -Infinity
  let hot = false
  for (const entry of energies) {
    const nowHot = entry.value > threshold
    if (nowHot && !hot && entry.time >= nextAllowed) {
      clusters += 1
      nextAllowed = entry.time + minGapSeconds
    }
    hot = nowHot
  }
  return clusters
}

function audibleLength(samples, sampleRate, dropDb = 60) {
  const hop = Math.floor(sampleRate * 0.01)
  const peak = peakAbsolute(samples, 0, Infinity, sampleRate)
  const threshold = peak * 10 ** (-Math.abs(dropDb) / 20)
  let last = 0
  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(start + hop, samples.length)
    let sum = 0
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
    if (Math.sqrt(sum / (end - start)) >= threshold) last = start / sampleRate
  }
  return last
}

// ---------- harness ----------

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

async function render(voice, notes, tailSeconds = 2.5) {
  const result = await page.evaluate(
    async (job) => window.__renderApi.renderNotes(job.voice, job.notes, job.tail, null),
    { voice, notes, tail: tailSeconds },
  )
  return {
    samples: Float32Array.from(result.samples),
    sampleRate: result.sampleRate,
    engineType: result.engineType,
    diagnostics: result.voiceDiagnostics,
    coverage: result.sampleCoverage,
  }
}

function report(label, value, unit = '') {
  console.log(`  ${label.padEnd(44)} ${typeof value === 'number' ? value.toFixed(4) : value}${unit}`)
}

console.log('=== realism probe (reports only, no assertions) ===')

// ── Dynamic range, as the ENGINE hears it ────────────────────────────────────
// The engines apply mapPlaybackVelocity before a voice is ever triggered,
// so the loudness ladder must be measured through that curve.
{
  const marks = [
    ['pp', 0.36], ['p', 0.5], ['mp', 0.62], ['mf', 0.72], ['f', 0.82], ['ff', 0.92],
  ]
  const levels = []
  const gains = []
  for (const [mark, raw] of marks) {
    const velocity = mapPlaybackVelocity(raw)
    gains.push(velocity)
    const rendered = await render('piano', [{ name: 'C4', time: 0.2, duration: 0.5, velocity }])
    levels.push(rms(rendered.samples, 0.25, 0.75, rendered.sampleRate))
  }
  console.log('  dynamics ladder (engine velocity curve):')
  marks.forEach(([mark], index) => {
    report(`    ${mark} gain=${gains[index].toFixed(3)}`, levels[index])
  })
  const span = 20 * Math.log10(levels.at(-1) / levels[0])
  const rising = levels.every((v, i) => i === 0 || v > levels[i - 1])
  report('pp→ff span (dB)', span)
  report('monotonic', rising)
  report('pause: ~12 dB is narrow, ~20 dB is a real piano', '')
}

// ── Piano: sustained note, repeated notes, chords ────────────────────────────
{
  const held = await render('piano', [{ name: 'C4', time: 0.2, duration: 1.0, velocity: 0.85 }], 3.5)
  report('piano: engine', held.engineType)
  report('piano: samples loaded', `${held.coverage.loadedSampleCount} (${held.coverage.missingSampleCount} missing)`)
  report('piano: audible length (s)', audibleLength(held.samples, held.sampleRate))

  const repeated = await render('piano', [
    { name: 'A4', time: 0.2, duration: 0.25, velocity: 0.8 },
    { name: 'A4', time: 0.5, duration: 0.25, velocity: 0.8 },
    { name: 'A4', time: 0.8, duration: 0.25, velocity: 0.8 },
    { name: 'A4', time: 1.1, duration: 0.9, velocity: 0.85 },
  ], 3.5)
  report('piano: repeated-note attacks detected (expect 4)', onsetCount(repeated.samples, 0.2, 1.2, repeated.sampleRate))
  report('piano: repeated-note duplicates skipped', repeated.diagnostics.duplicatesSkipped)
  const tail = windowEnergy(repeated.samples, repeated.sampleRate, 3.3, 3.45)
  const head = windowEnergy(repeated.samples, repeated.sampleRate, 1.15, 1.3)
  report('piano: tail energy', tail)
  report('piano: start energy', head)
  report('piano: tail / start (must be small)', head > 0 ? tail / head : 0)

  const chord = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5'].map((name, index) => ({
    name, time: 0.2 + index * 0.001, duration: 1.0, velocity: 0.98,
  }))
  const dense = await render('piano', chord, 3.5)
  report('piano: 9-note fff peak (limiter 0.67)', peakAbsolute(dense.samples, 0.2, 2.0, dense.sampleRate))
  report('piano: 9-note fff clipped samples', clippedCount(dense.samples, 0.2, 2.0, dense.sampleRate))
  report('piano: 9-note fff voices stolen', dense.diagnostics.voicesStolen)
}

// ── Guitar: plucked decay, strum ─────────────────────────────────────────────
{
  const note = await render('guitar', [{ name: 'A3', time: 0.2, duration: 1.0, velocity: 0.8 }], 3.5)
  report('guitar: engine', note.engineType)
  report('guitar: samples loaded', `${note.coverage.loadedSampleCount} (${note.coverage.missingSampleCount} missing)`)
  report('guitar: audible length (s)', audibleLength(note.samples, note.sampleRate))
  report('guitar: plucked decay early/late ratio',
    windowEnergy(note.samples, note.sampleRate, 0.24, 0.44) /
    Math.max(1e-9, windowEnergy(note.samples, note.sampleRate, 0.5, 0.7)))

  const strum = ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'].map((name, index) => ({
    name, time: 0.2 + index * 0.009, duration: 1.8, velocity: 0.9,
  }))
  const strummed = await render('guitar', strum, 3.5)
  report('guitar: 6-string strum peak (limiter 0.67)', peakAbsolute(strummed.samples, 0.2, 2.4, strummed.sampleRate))
  report('guitar: 6-string strum clipped samples', clippedCount(strummed.samples, 0.2, 2.4, strummed.sampleRate))
  report('guitar: strum attack events (1 = one strum)', onsetCount(strummed.samples, 0.2, 0.4, strummed.sampleRate))
}

await browser.close()
await server.close()
console.log('probe complete')
