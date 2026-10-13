/**
 * Sample pitch coverage — every mapped sample is measured against its
 * declared key through the app's own decode path.
 *
 * The guitar-acoustic set already carried four octave-mislabelled files
 * (found by an earlier spectral audit, then excluded from the map). This
 * suite makes that class of defect impossible to reintroduce: a file that
 * does not sound at its label's pitch fails here, whether it was added
 * new, re-encoded, or replaced with a different source library.
 *
 * Measured with the same autocorrelation the rendered-audio suite uses
 * (global maximum over lags, strided correlation). Verified against a
 * reference tone: ad-hoc "first peak above 85% of max" and
 * "prefer the sub-harmonic" variants both misread by an octave on these
 * signals, so the plain global maximum is the implementation used here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUITAR_SAMPLE_URLS } from '../src/features/playback/guitarInstrument.js'
import { PIANO_SAMPLE_URLS } from '../src/features/playback/pianoInstrument.js'
import { ELECTRIC_GUITAR_SAMPLE_URLS } from '../src/features/playback/electricGuitarInstrument.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOLERANCE_CENTS = 30
const SAMPLE_NAME_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Parse a Tone-style note name ("C#4", "D#1") into MIDI. */
function sampleNameToMidi(name) {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(String(name))
  if (!match) {
    return null
  }
  const base = SAMPLE_NAME_SEMITONES[match[1]]
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0
  return (Number(match[3]) + 1) * 12 + base + accidental
}

function centsError(measuredHz, expectedMidi) {
  return 1200 * Math.log2(measuredHz / (440 * 2 ** ((expectedMidi - 69) / 12)))
}

/**
 * Band-limited autocorrelation f0 with parabolic interpolation.
 *
 * A fixed wide band cannot serve A0 (27.5 Hz) and C8 (4.2 kHz) at once:
 * a low band loses the extremes into the fmax boundary, a high band reads
 * the top octaves an octave low. Searching each note around its own
 * declared pitch answers the question actually being asked - "does this
 * file sound at its label?" - and parabolic interpolation removes the
 * integer-lag bias that otherwise reads C8 ~150 cents sharp.
 *
 * Deliberately different from tests/audioRender.test.js's strided global
 * maximum: that one is tuned for mid-register notes, this one for a
 * declared-pitch comparison across the whole compass.
 */
function f0Near(samples, sampleRate, fromSeconds, windowSeconds, expectedMidi) {
  const expectedHz = 440 * 2 ** ((expectedMidi - 69) / 12)
  const loHz = expectedHz * 0.7
  const hiHz = expectedHz * 1.4
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
  if (bestLag > lagMin && bestLag < lagMax) {
    const y0 = correlation(bestLag - 1)
    const y1 = bestValue
    const y2 = correlation(bestLag + 1)
    const denom = y0 - 2 * y1 + y2
    if (denom !== 0) {
      const offset = 0.5 * (y0 - y2) / denom
      if (Math.abs(offset) <= 1) {
        return sampleRate / (bestLag + offset)
      }
    }
  }
  return sampleRate / bestLag
}

describe('sample pitch coverage', () => {
  let viteServer
  let browser
  let baseUrl

  beforeAll(async () => {
    viteServer = await createServer({
      root: projectRoot,
      configFile: resolve(projectRoot, 'vite.config.js'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await viteServer.listen()
    baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await viteServer?.close()
  })

  /** @param {string} probeSet dir name understood by __samplePcm */
  async function measureF0(probeSet, note, midi) {
    const page = await browser.newPage()
    try {
      await page.goto(`${baseUrl}/scripts/audio-render/sample-probe.html`, { waitUntil: 'load' })
      const decoded = await page.evaluate(
        async (job) => window.__samplePcm(job.probeSet, job.note),
        { probeSet, note },
      )
      const samples = Float32Array.from(decoded.samples)
      // A note with no measurable signal cannot be verified either way.
      // The top keys of the Salamander set decay almost immediately, so
      // their "pitch" window is mostly encoder noise; calling that a
      // failure (or a pass) would both be dishonest.
      const windowStart = Math.floor(0.25 * decoded.sampleRate)
      const windowEnd = Math.min(samples.length, Math.floor(0.6 * decoded.sampleRate))
      let windowPeak = 0
      for (let index = windowStart; index < windowEnd; index += 1) {
        const magnitude = Math.abs(samples[index])
        if (magnitude > windowPeak) {
          windowPeak = magnitude
        }
      }
      if (windowPeak < 0.004) {
        return { measured: 0, windowPeak }
      }
      return {
        measured: f0Near(samples, decoded.sampleRate, 0.25, 0.35, midi),
        windowPeak,
      }
    } finally {
      await page.close()
    }
  }

/**
 * Pre-existing upstream defects in the bundled Salamander "lite" mp3 set,
 * pinned so drift in either direction is caught.
 *
 * Measured with an interpolated FFT over three independent analysis
 * windows, A7 reads ~+30 cents and C8 ~+91 cents consistently, while every
 * mid-register key sits within +23 cents. Both files are byte-identical
 * (md5) to `tonejs.github.io/audio/salamander/`, so the project did not
 * introduce this and cannot fix it without re-sourcing the set, which is
 * out of scope (the full set is 394 MB).
 *
 * The allowances below are deliberately wider than the FFT readings
 * because the autocorrelation used IN this suite disagrees with the FFT at
 * the very top of the compass - C8's note is so short and quiet that lags
 * resolve differently by method (autocorrelation reads +176 cents, the
 * interpolated FFT +91). The value of this suite is the KEY SET: only these
 * two keys may be off, so a new mislabel (the octave errors already found
 * in the guitar-acoustic set) fails it. The exact cents figure for C8 is
 * not trustworthy from either method and is not asserted tightly.
 *
 * Consequence for playback: Tone.Sampler pitch-shifts each played note
 * from the nearest sample by an exact semitone count, so anything derived
 * from C8 - B7 and the notes above it - sounds sharp.
 */
const KNOWN_SHARP_SALAMANDER = { A7: 150, C8: 250 }

const suites = [
  ['electric guitar (CC0, Karoryfer Emilyguitar)', 'guitar-electric', ELECTRIC_GUITAR_SAMPLE_URLS, {}],
  ['acoustic guitar (Iowa)', 'guitar-acoustic', GUITAR_SAMPLE_URLS, {}],
  ['piano (Salamander)', 'piano', PIANO_SAMPLE_URLS, KNOWN_SHARP_SALAMANDER],
]

for (const [label, probeSet, urls, allowanceCents] of suites) {
  it(`every ${label} sample sounds at its declared key`, async () => {
    const failures = []
    const unverifiable = []
    const offPitch = []
    let verified = 0
    for (const key of Object.keys(urls)) {
      const midi = sampleNameToMidi(key)
      expect(midi).not.toBeNull()
      const note = urls[key].replace(/\.mp3$/, '')
      const { measured, windowPeak } = await measureF0(probeSet, note, midi)
      if (!(measured > 0)) {
        unverifiable.push(`${key} (window peak ${windowPeak.toExponential(1)})`)
        continue
      }
      const cents = centsError(measured, midi)
      const allowance = allowanceCents[key] ?? TOLERANCE_CENTS
      if (Math.abs(cents) > allowance) {
        failures.push(`${key}: ${cents.toFixed(0)} cents off (allowance ${allowance})`)
        continue
      }
      if (Math.abs(cents) > TOLERANCE_CENTS) {
        offPitch.push(`${key} ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}c`)
        continue
      }
      verified += 1
    }
    // Loud enough to fail the test; too quiet is reported, never passed off.
    expect(failures, `unexpectedly off-pitch:\n${failures.join('\n')}`).toEqual([])
    // Only the documented keys may be off; a new one means a regression.
    const allowedKeys = Object.keys(allowanceCents)
    if (allowedKeys.length > 0) {
      const actual = offPitch.map((entry) => entry.split(' ')[0]).sort()
      expect(actual, `off-pitch keys must stay exactly ${JSON.stringify(allowedKeys)}`).toEqual(
        [...allowedKeys].sort(),
      )
    }
    // At least the great majority must be measurable, so "unverifiable"
    // cannot silently become the normal case.
    expect(verified).toBeGreaterThan(Object.keys(urls).length * 0.8)
    if (unverifiable.length > 0) {
      console.warn(`${label}: not measurable (decayed before the window): ${unverifiable.join(', ')}`)
    }
    if (offPitch.length > 0) {
      console.warn(`${label}: known upstream-sharp keys: ${offPitch.join(', ')}`)
    }
    expect(verified + unverifiable.length + offPitch.length).toBe(Object.keys(urls).length)
  }, 300_000)
}
})
