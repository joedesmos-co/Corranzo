/**
 * HIGH-REGISTER PITCH ACCURACY — actual emitted playback pitch.
 *
 * The previous audit measured the SOURCE SAMPLES directly. That answers
 * "is the file labelled correctly", but it does not answer the question
 * that matters for a player: "what pitch comes out of the speaker when
 * this note is played?" Tone's Sampler pitch-shifts every played note
 * from the NEAREST SAMPLE by an exact semitone count, so a sharp sample
 * drags every note that derives from it by the same amount.
 *
 * This probe renders each MIDI note through the real piano voice and
 * measures the emitted fundamental with the same autocorrelation the
 * rendered-audio test suite uses, so it hears exactly what playback
 * emits rather than what is stored.
 *
 * Run: node scripts/audio-render/pitch-compass.mjs [voice] [low] [high]
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const midiToName = (midi) =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

const voice = process.argv[2] || 'piano'
const low = Number(process.argv[3] || 21)
const high = Number(process.argv[4] || 108)

function centsError(measuredHz, expectedMidi) {
  return 1200 * Math.log2(measuredHz / (440 * 2 ** ((expectedMidi - 69) / 12)))
}

/**
 * Band-limited autocorrelation with parabolic interpolation.
 *
 * A fixed search band (e.g. 40..1200 Hz) cannot serve both A0 and C8:
 * everything above the band ceiling reads an octave or more low, which is
 * a measurement artifact rather than a playback defect. Searching around
 * each note's own written pitch - wide enough to catch a semitone or an
 * octave error - answers "did playback emit this note?" and parabolic
 * interpolation removes the integer-lag bias that would otherwise read
 * C8 ~150 cents sharp.
 */
function f0Near(samples, sampleRate, fromSeconds, windowSeconds, expectedMidi, spanCents = 1500) {
  const expectedHz = 440 * 2 ** ((expectedMidi - 69) / 12)
  const loHz = expectedHz * 2 ** (-spanCents / 1200)
  const hiHz = expectedHz * 2 ** (spanCents / 1200)
  const start = Math.floor(fromSeconds * sampleRate)
  const length = Math.min(Math.floor(windowSeconds * sampleRate), samples.length - start)
  if (length <= 64) {
    return 0
  }
  const seg = samples.subarray(start, start + length)
  const lagMin = Math.max(2, Math.floor(sampleRate / hiHz))
  const lagMax = Math.min(seg.length - 2, Math.floor(sampleRate / loHz))
  if (lagMax <= lagMin) {
    return 0
  }
  const correlation = (lag) => {
    let sum = 0
    for (let index = 0; index + lag < seg.length; index += 1) {
      sum += seg[index] * seg[index + lag]
    }
    return sum
  }
  let bestLag = lagMin
  let bestValue = -Infinity
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    const value = correlation(lag)
    if (value > bestValue) {
      bestValue = value
      bestLag = lag
    }
  }

  /**
   * A periodic signal correlates at every multiple of its period, so the
   * global maximum can sit an octave up - and on a band wide enough to
   * admit the sub-octave it can also sit an octave DOWN. The fundamental
   * is the first LOCAL MAXIMUM that reaches 85% of the global maximum:
   * taking any value above the threshold instead catches the rising edge
   * of the peak and reads sharp.
   */
  let chosen = bestLag
  for (let lag = lagMin + 1; lag < lagMax; lag += 1) {
    const value = correlation(lag)
    const isLocalMax = value >= correlation(lag - 1) && value >= correlation(lag + 1)
    if (isLocalMax && value >= bestValue * 0.85) {
      chosen = lag
      break
    }
  }

  if (chosen > lagMin && chosen < lagMax) {
    const y0 = correlation(chosen - 1)
    const y1 = correlation(chosen)
    const y2 = correlation(chosen + 1)
    const denom = y0 - 2 * y1 + y2
    if (denom !== 0) {
      const offset = 0.5 * (y0 - y2) / denom
      if (Math.abs(offset) <= 1) {
        return sampleRate / (chosen + offset)
      }
    }
  }
  return sampleRate / chosen
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

const rows = []
for (let midi = low; midi <= high; midi += 1) {
  const name = midiToName(midi)
  const result = await page.evaluate(
    async (job) =>
      window.__renderApi.renderNotes(
        job.voice,
        [{ name: job.name, time: 0.2, duration: 1.0, velocity: 0.8 }],
        2.5,
        null,
      ),
    { voice, name },
  )
  const samples = Float32Array.from(result.samples)
  const measured = f0Near(samples, result.sampleRate, 0.3, 0.3, midi)
  const expected = 440 * 2 ** ((midi - 69) / 12)
  rows.push({ midi, name, measured, expected, cents: measured > 0 ? centsError(measured, midi) : 0 })
}

console.log(`Emitted playback pitch — ${voice} voice, MIDI ${low}..${high}`)
console.log('midi  note  expected  emitted   cents   verdict')
let off = []
for (const row of rows) {
  const verdict = Math.abs(row.cents) <= 30 ? 'ok' : Math.abs(row.cents) <= 60 ? 'close' : 'OFF'
  if (verdict !== 'ok') off.push(row)
  console.log(
    `${String(row.midi).padStart(4)}  ${row.name.padEnd(5)} ${row.expected.toFixed(1).padStart(8)} ` +
      `${row.measured.toFixed(1).padStart(8)}  ${row.cents >= 0 ? '+' : ''}${row.cents.toFixed(0).padStart(5)}   ${verdict}`,
  )
}
console.log(`\n${rows.length} notes measured, ${off.length} outside +/-30 cents`)

// Group the offenders into contiguous runs so their cause is visible.
if (off.length > 0) {
  const runs = []
  let run = [off[0]]
  for (let index = 1; index < off.length; index += 1) {
    if (off[index].midi === off[index - 1].midi + 1) {
      run.push(off[index])
    } else {
      runs.push(run)
      run = [off[index]]
    }
  }
  runs.push(run)
  console.log('\noff-pitch runs:')
  for (const group of runs) {
    const mean = group.reduce((sum, r) => sum + r.cents, 0) / group.length
    console.log(
      `  MIDI ${group[0].midi}-${group[group.length - 1].midi} (${group[0].name}..${group[group.length - 1].name}): ` +
        `${group.length} notes, mean ${mean >= 0 ? '+' : ''}${mean.toFixed(0)} cents`,
    )
  }
}

await browser.close()
await server.close()
