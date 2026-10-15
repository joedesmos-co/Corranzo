/**
 * Can the top two notes be corrected, and what would it cost?
 *
 * Measured emitted-playback pitch across the compass:
 *   MIDI 21..100 (A0..E7)  within -14..+22 cents   -- in tune
 *   MIDI 101..106          +30..+39 cents         -- mildly sharp
 *   MIDI 107..108          +152 / +144 cents      -- B7 and C8, a semitone+ wrong
 *
 * Both bad notes derive from the defective C8 sample (B7 shifts down from
 * it, C8 is it). The only available mapping correction is to drop C8 and
 * let those two notes shift up from A7 - which fixes the pitch but costs a
 * 2-3 semitone pitch shift, and a pitch-shifted grand piano sample loses
 * high harmonics.
 *
 * This probe measures that cost objectively: the spectral balance of the
 * direct C8 recording against A7 pitch-shifted to C8. If the substitute
 * carries comparable high-frequency energy the correction is affordable;
 * if it collapses, the honest move is to document the range instead.
 *
 * Run: node scripts/audio-render/top-octave-cost.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

const out = await page.evaluate(async () => {
  const Tone = window.__Tone

  const load = (note) =>
    new Promise((resolve, reject) => {
      const holder = new Tone.ToneAudioBuffers({
        urls: { [note]: `${note}.mp3` },
        baseUrl: '/audio/salamander/',
        onload: () => resolve(holder),
        onerror: reject,
      })
      setTimeout(() => reject(new Error('timeout')), 20000)
    })

  // Render a note through ONE buffer at a given playback rate, so the
  // result is directly comparable with what Sampler.triggerAttack does.
  const renderBuffer = async (note, playbackRate, velocity = 0.8) => {
    const holder = await load(note)
    return Tone.Offline(
      () => {
        const destination = Tone.getDestination()
        destination.volume.value = 0
        const source = new Tone.ToneBufferSource()
        source.buffer.set(holder.get(note))
        source.playbackRate.value = playbackRate
        const gain = new Tone.Gain(velocity)
        source.connect(gain)
        gain.connect(destination)
        source.start(0.2, 0, 4)
      },
      3.0,
    )
  }

  const analyse = (rendered) => {
    const samples = rendered.getChannelData(0)
    const sr = rendered.sampleRate
    const from = Math.floor(0.25 * sr)
    const to = Math.floor(0.55 * sr)
    const n = to - from
    let size = 1
    while (size < n) size *= 2
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    for (let i = 0; i < n; i += 1) {
      const phase = i / (n - 1)
      re[i] = samples[from + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
    }
    let bits = 0
    for (let m = size; m > 1; m /= 2) bits += 1
    for (let i = 0; i < size; i += 1) {
      let rev = 0
      for (let b = 0; b < bits; b += 1) rev = (rev << 1) | ((i >>> b) & 1)
      if (rev > i) { const t = re[i]; re[i] = re[rev]; re[rev] = t }
    }
    for (let half = 1; half < size; half *= 2) {
      for (let base = 0; base < size; base += 2 * half) {
        for (let k = 0; k < half; k += 1) {
          const ang = (-Math.PI * k) / half
          const cos = Math.cos(ang), sin = Math.sin(ang)
          const e = base + k, o = e + half
          const tr = re[o] * cos - im[o] * sin
          const ti = re[o] * sin + im[o] * cos
          re[o] = re[e] - tr
          im[o] = im[e] - ti
          re[e] += tr
          im[e] += ti
        }
      }
    }
    const bandEnergy = (lo, hi) => {
      let total = 0
      let all = 0
      for (let bin = 1; bin < size / 2; bin += 1) {
        const f = (bin * sr) / size
        const m = Math.hypot(re[bin], im[bin])
        if (f < hi && f > lo) total += m
        if (f < 20000) all += m
      }
      return total / all
    }
    return {
      below1k: bandEnergy(0, 1000),
      oneTo4k: bandEnergy(1000, 4000),
      fourTo10k: bandEnergy(4000, 10000),
      above10k: bandEnergy(10000, 20000),
    }
  }

  const results = []
  // The direct C8 recording, and the same note approached by shifting A7.
  results.push({ label: 'C8 direct (rate 1.0)', ...analyse(await renderBuffer('C8', 1.0)) })
  results.push({ label: 'A7 -> C8 (+3 semitones)', ...analyse(await renderBuffer('A7', 2 ** (3 / 12))) })
  // A7 direct for reference.
  results.push({ label: 'A7 direct (rate 1.0)', ...analyse(await renderBuffer('A7', 1.0)) })
  // And a 1-semitone shift, which the set already does everywhere, as a sanity baseline.
  results.push({ label: 'A7 -> A#7 (+1 semitone)', ...analyse(await renderBuffer('A7', 2 ** (1 / 12))) })
  return results
})

console.log('Spectral balance of the top octave, direct vs pitch-shifted\n')
console.log('source                        <1 kHz  1-4 kHz  4-10 kHz  >10 kHz')
for (const row of out) {
  console.log(
    `${row.label.padEnd(30)} ${row.below1k.toFixed(3)}    ${row.oneTo4k.toFixed(3)}    ${row.fourTo10k.toFixed(3)}     ${row.above10k.toFixed(3)}`,
  )
}
const direct = out[0]
const shifted = out[1]
console.log(
  `\nhigh-frequency loss from shifting instead of a direct recording (4-10 kHz): ` +
    `${(((1 - shifted.fourTo10k / direct.fourTo10k) * 100).toFixed(0))}%`,
)

await browser.close()
await server.close()
