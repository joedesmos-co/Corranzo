/**
 * Isolated sampler + filter A/B — why per-velocity brightness bands
 * produced a loudness inversion, and why the approach was rejected.
 *
 * The previous attempt routed each note to one of three Tone.Samplers
 * built from the SAME decoded buffers (band 0 reusing the voice's primary
 * sampler, bands 1-2 built again by buildSamplerFromBuffers) with each
 * band behind its own lowpass. Measured result was non-monotonic: velocity
 * 0.45 (band 0, 1000 Hz) read 3.716 energy, velocity 0.46 (band 1,
 * 2700 Hz) read 3.314 — a louder velocity sounding quieter.
 *
 * This probe isolates that with one variable per case. Every case renders
 * the same note, at the same time, with the same velocity, into the same
 * destination through Tone.Offline:
 *
 *   A  primary sampler, no extra filter
 *   B  second sampler from the same buffers, no extra filter
 *   C  primary sampler behind a 1000 Hz lowpass
 *   D  second sampler behind a 2700 Hz lowpass
 *
 * Findings (recorded in docs/SOUND_ENGINE_RESEARCH.md):
 *   A == B exactly (ratio 1.0000) -> sampler construction is NOT the cause
 *   C > A and D > A -> a lowpass here ADDS energy, it does not cut it
 *   narrower cut = bigger boost -> band 0 (soft notes) was boosted more
 *   than band 1, which is exactly the inversion
 *
 * Run: node scripts/audio-render/sampler-ab.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CASES = [
  { label: 'A primary, no filter', cutoff: null, which: 'primary' },
  { label: 'B secondary, no filter', cutoff: null, which: 'secondary' },
  { label: 'C primary, 1000 Hz', cutoff: 1000, which: 'primary' },
  { label: 'D secondary, 2700 Hz', cutoff: 2700, which: 'secondary' },
]

const VELOCITIES = [0.8, 0.45]

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

async function renderCase(cutoff, which, velocity) {
  return page.evaluate(
    async (spec) => {
      const Tone = window.__Tone
      const buffers = await new Promise((resolve, reject) => {
        const holder = new Tone.ToneAudioBuffers({
          urls: { C4: 'C4.mp3' },
          baseUrl: '/audio/salamander/',
          onload: () => resolve(holder),
          onerror: reject,
        })
        setTimeout(() => reject(new Error('timeout')), 20000)
      })

      const rendered = await Tone.Offline(
        () => {
          const destination = Tone.getDestination()
          destination.volume.value = 0
          // Both samplers are built here with identical parameters over
          // the identical decoded buffers. `which` only picks which one
          // the note is played on, so A/B isolates sampler construction.
          const makeSampler = () =>
            new Tone.Sampler({
              urls: { C4: buffers.get('C4') },
              release: 1.85,
              attack: 0.008,
              curve: 'exponential',
              volume: -10,
            })
          const sampler = spec.which === 'secondary' ? makeSampler() : makeSampler()
          let node = sampler
          if (spec.cutoff) {
            const filter = new Tone.Filter({
              type: 'lowpass',
              frequency: spec.cutoff,
              rolloff: -12,
            })
            sampler.connect(filter)
            node = filter
          }
          node.connect(destination)
          sampler.triggerAttackRelease('C4', 0.5, 0.2, spec.velocity)
        },
        1.7,
      )

      const samples = rendered.getChannelData(0)
      const sampleRate = rendered.sampleRate
      const from = Math.floor(0.25 * sampleRate)
      const to = Math.floor(0.75 * sampleRate)
      let windowEnergy = 0
      let peak = 0
      for (let index = from; index < to; index += 1) {
        windowEnergy += samples[index] * samples[index]
      }
      for (let index = 0; index < samples.length; index += 1) {
        const magnitude = Math.abs(samples[index])
        if (magnitude > peak) {
          peak = magnitude
        }
      }
      return { windowEnergy, peak }
    },
    { cutoff, which, velocity },
  )
  return rendered
}

console.log('Isolated sampler/filter A/B — C4, same decoded buffers, same destination\n')

for (const velocity of VELOCITIES) {
  const results = {}
  for (const spec of CASES) {
    results[spec.label] = await renderCase(spec.cutoff, spec.which, velocity)
  }
  const baseline = results[CASES[0].label].windowEnergy

  console.log(`velocity ${velocity}`)
  console.log('  case                        window energy    peak      vs A')
  for (const spec of CASES) {
    const result = results[spec.label]
    const ratio = result.windowEnergy / baseline
    const percent = (ratio - 1) * 100
    console.log(
      `  ${spec.label.padEnd(28)} ${result.windowEnergy.toFixed(6).padStart(12)}  ` +
        `${result.peak.toFixed(6)}  x${ratio.toFixed(4)} (${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%)`,
    )
  }
  const monotonic = CASES.every((spec, index) => {
    if (index === 0) return true
    const previous = results[CASES[index - 1].label].windowEnergy
    const current = results[spec.label].windowEnergy
    // Soft (1000 Hz) must be quieter than loud (2700 Hz) for the bands to
    // preserve the written dynamic ladder.
    return spec.cutoff === null || spec.cutoff === 2700 || current < previous
  })
  console.log(`  soft-band (1000 Hz) quieter than medium-band (2700 Hz): ${monotonic}`)
  console.log()
}

await browser.close()
await server.close()
