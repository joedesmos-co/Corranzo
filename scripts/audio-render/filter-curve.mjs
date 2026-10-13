/**
 * Tone.Filter's gain response, measured with a MATCHED graph.
 *
 * A first version compared a filtered render against an unfiltered one,
 * which are different graph shapes; any systematic difference between two
 * renders shows up as "gain" and the result would be meaningless. Here
 * both cases run the identical graph (oscillator -> Filter -> Gain ->
 * destination) and differ only in the filter's cutoff, so the only
 * variable is the filter's frequency response.
 *
 * Run: node scripts/audio-render/filter-curve.mjs [cutoffHz] [Q]
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CUTOFF = Number(process.argv[2] || 1000)
const Q = Number(process.argv[3] || 1)
const FREQS = [100, 200, 261.6, 400, 600, 800, 1000, 1300, 1700, 2200, 3000, 5000, 9000]

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
await page.goto(`${baseUrl}/scripts/audio-render/sample-probe.html`, { waitUntil: 'load' })

// Each frequency gets its own render because the oscillator's frequency
// must be in scope when the graph is built.
async function gainAt(freq) {
  return page.evaluate(
    async (spec) => {
      const Tone = window.__Tone
      const rmsOf = (buffer) => {
        const data = buffer.getChannelData(0)
        const from = Math.floor(0.25 * buffer.sampleRate)
        const to = Math.floor(1.4 * buffer.sampleRate)
        let sum = 0
        for (let i = from; i < to; i += 1) sum += data[i] * data[i]
        return Math.sqrt(sum / (to - from))
      }
      const render = (cutoff, frequency) =>
        Tone.Offline(
          () => {
            const destination = Tone.getDestination()
            destination.volume.value = 0
            const osc = new Tone.Oscillator(frequency, 'sine')
            const filter = new Tone.Filter({
              type: 'lowpass',
              frequency: cutoff,
              rolloff: -12,
              Q: spec.q,
            })
            const trim = new Tone.Gain(0.3)
            osc.connect(filter)
            filter.connect(trim)
            trim.connect(destination)
            osc.start(0.05)
          },
          1.8,
        )
      const reference = rmsOf(await render(19000, spec.freq))
      const filtered = rmsOf(await render(spec.cutoff, spec.freq))
      return { freq: spec.freq, gainDb: 20 * Math.log10(filtered / reference) }
    },
    { freq, cutoff: CUTOFF, q: Q },
  )
}

console.log(`Tone.Filter response — lowpass ${CUTOFF} Hz, rolloff -12, Q=${Q} (matched-graph)\n`)
console.log('freq       gain(dB)')
const points = []
for (const freq of FREQS) {
  const point = await gainAt(freq)
  points.push(point)
  console.log(`${String(point.freq).padStart(6)} Hz  ${point.gainDb >= 0 ? '+' : ''}${point.gainDb.toFixed(2)}`)
}
const max = points.reduce((a, b) => (b.gainDb > a.gainDb ? b : a))
const aboveCutoff = points.filter((p) => p.freq > CUTOFF)
const monotonic = aboveCutoff.every(
  (p, i) => i === 0 || p.gainDb <= aboveCutoff[i - 1].gainDb + 1e-9,
)
console.log(`\nloudest point: ${max.freq} Hz at ${max.gainDb.toFixed(2)} dB`)
console.log(`boosts above unity: ${max.gainDb > -0.3 ? 'YES' : 'no'}`)
console.log(`attenuation monotonic above cutoff: ${monotonic}`)

await browser.close()
await server.close()
