#!/usr/bin/env node
/**
 * M1 false-award forensics: per-frame pitch-band trajectories from raw WAV.
 *
 * For a ghost candidate (upper pitch) vs its lower octave/parent:
 *  - transient proximity: spectral-flux peak height near ghost onset
 *  - rise time: 10%->90% rise of the ghost band around its onset
 *  - decay correlation: Pearson r of ghost vs lower band envelopes
 *  - early death: ghost ends while the lower band still rings
 *  - sustain ratio of model spans
 *
 * Dev analysis tool only (not product code, not in test:scripts).
 *
 * Usage:
 *   node scripts/analyze-pitch-trajectories.mjs --clip <wav> \
 *     --ghost 60@0.13+0.36 --lower 48@0.13+0.36 [--upper-true 64@0.13+0.33 ...]
 */
import { readFileSync } from 'node:fs'

function arg(name, fallback = null) {
  const prefix = `--${name}`
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === prefix) {
      return process.argv[i + 1] ?? fallback
    }
    if (process.argv[i].startsWith(`${prefix}=`)) {
      return process.argv[i].slice(prefix.length + 1)
    }
  }
  return fallback
}

function parseNote(spec) {
  // "60@0.13+0.36" -> { midi:60, start:0.13, span:0.36 }
  const match = /^(\d+)@([\d.]+)\+([\d.]+)$/.exec(spec)
  if (!match) {
    throw new Error(`bad note spec: ${spec}`)
  }
  return { midi: Number(match[1]), start: Number(match[2]), span: Number(match[3]) }
}

function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

// Minimal WAV reader (16-bit LE PCM, any channels -> mono mix).
function readMonoWav(path) {
  const buffer = readFileSync(path)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const ascii = (offset, length) => {
    let value = ''
    for (let i = 0; i < length; i += 1) {
      value += String.fromCharCode(view.getUint8(offset + i))
    }
    return value
  }
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error(`not a WAV: ${path}`)
  }
  let offset = 12
  let channels = 1
  let sampleRate = 44100
  let bits = 16
  let dataOffset = -1
  let dataSize = 0
  while (offset + 8 <= view.byteLength) {
    const id = ascii(offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      const format = view.getUint16(offset + 8, true)
      channels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bits = view.getUint16(offset + 22, true)
      if (format !== 1 && format !== 3) {
        throw new Error(`unsupported WAV format ${format}`)
      }
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataSize = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (dataOffset < 0) {
    throw new Error('no data chunk')
  }
  const bytesPerSample = bits / 8
  const frames = Math.floor(dataSize / (bytesPerSample * channels))
  const mono = new Float32Array(frames)
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    for (let c = 0; c < channels; c += 1) {
      const at = dataOffset + (f * channels + c) * bytesPerSample
      let v = 0
      if (bits === 16) {
        v = view.getInt16(at, true) / 32768
      } else if (bits === 32) {
        v = view.getFloat32(at, true)
      } else if (bits === 24) {
        const b0 = view.getUint8(at)
        const b1 = view.getUint8(at + 1)
        const b2 = view.getInt8(at + 2)
        v = (b2 * 65536 + b1 * 256 + b0) / 8388608
      }
      sum += v
    }
    mono[f] = sum / channels
  }
  return { samples: mono, sampleRate }
}

function goertzelMagnitude(samples, start, length, sampleRate, freq) {
  const end = Math.min(start + length, samples.length)
  const n = end - start
  if (n <= 0) {
    return 0
  }
  const omega = (2 * Math.PI * freq) / sampleRate
  const cosine = Math.cos(omega)
  const coeff = 2 * cosine
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = start; i < end; i += 1) {
    s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return Math.sqrt(Math.max(power, 0)) / n
}

function hann(n, length) {
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (length - 1)))
}

function analyze({ clip, ghost, lower, upperTrue = [] }) {
  const { samples, sampleRate } = readMonoWav(clip)
  const frameHop = Math.floor(sampleRate * 0.01) // 10 ms
  const windowLen = Math.min(8192, Math.floor(sampleRate * 0.186))
  const frameCount = Math.floor((samples.length - windowLen) / frameHop)
  const toFrame = (seconds) => Math.round((seconds * sampleRate) / frameHop)

  const bandEnv = new Map()
  const bandMidis = [ghost.midi, lower.midi, ...upperTrue.map((u) => u.midi)]
  for (const midi of bandMidis) {
    const freq = midiToFreq(midi)
    const env = new Float32Array(frameCount)
    for (let f = 0; f < frameCount; f += 1) {
      env[f] = goertzelMagnitude(samples, f * frameHop, windowLen, sampleRate, freq)
    }
    bandEnv.set(midi, env)
  }
  // Broadband RMS + HF-difference transient envelopes (5 ms frames).
  const tfHop = Math.floor(sampleRate * 0.005)
  const tfCount = Math.floor(samples.length / tfHop)
  const rms = new Float32Array(tfCount)
  const hf = new Float32Array(tfCount)
  for (let f = 0; f < tfCount; f += 1) {
    let sum = 0
    let hsum = 0
    let prev = 0
    const start = f * tfHop
    const end = Math.min(start + tfHop, samples.length)
    for (let i = start; i < end; i += 1) {
      const v = samples[i]
      sum += v * v
      const d = v - prev
      hsum += d * d
      prev = v
    }
    const n = Math.max(end - start, 1)
    rms[f] = Math.sqrt(sum / n)
    hf[f] = Math.sqrt(hsum / n)
  }
  // Spectral flux on HF envelope (attack bursts).
  const flux = new Float32Array(tfCount)
  for (let f = 1; f < tfCount; f += 1) {
    flux[f] = Math.max(0, Math.log1p(hf[f] * 50) - Math.log1p(hf[f - 1] * 50))
  }
  const maxFlux = Math.max(...flux, 1e-9)

  const frameToSec = (f) => (f * frameHop) / sampleRate
  const tfToSec = (f) => (f * tfHop) / sampleRate

  function transientNear(timeSec, windowMs = 60) {
    const center = Math.round((timeSec * sampleRate) / tfHop)
    const radius = Math.round(windowMs / 5)
    let peak = 0
    let peakAt = center
    for (let f = Math.max(1, center - radius); f <= Math.min(tfCount - 1, center + radius); f += 1) {
      if (flux[f] > peak) {
        peak = flux[f]
        peakAt = f
      }
    }
    return { height: peak / maxFlux, atSec: tfToSec(peakAt), deltaMs: (peakAt - center) * 5 }
  }

  function riseTime(note) {
    const env = bandEnv.get(note.midi)
    const onF = toFrame(note.start)
    const searchEnd = Math.min(frameCount - 1, onF + 30) // +300 ms
    let peak = 0
    for (let f = Math.max(0, onF - 5); f <= searchEnd; f += 1) {
      peak = Math.max(peak, env[f])
    }
    if (peak <= 1e-9) {
      return { ms: null, peak: 0 }
    }
    // Walk back from peak to 10%.
    let peakF = onF
    for (let f = onF; f <= searchEnd; f += 1) {
      if (env[f] >= peak) {
        peakF = f
      } else {
        break
      }
    }
    let f10 = peakF
    let f90 = peakF
    for (let f = peakF; f >= Math.max(0, onF - 10); f -= 1) {
      if (env[f] <= 0.1 * peak) {
        f10 = f
        break
      }
      f10 = f
    }
    for (let f = f10; f <= peakF; f += 1) {
      if (env[f] >= 0.9 * peak) {
        f90 = f
        break
      }
    }
    return { ms: (f90 - f10) * 10, peak }
  }

  function decayCorrelation(upper, low) {
    const envU = bandEnv.get(upper.midi)
    const envL = bandEnv.get(low.midi)
    const startF = toFrame(upper.start + upper.span * 0.25)
    const endF = Math.min(frameCount - 1, toFrame(upper.start + upper.span))
    const xs = []
    const ys = []
    for (let f = startF; f <= endF; f += 1) {
      xs.push(envU[f])
      ys.push(envL[f])
    }
    if (xs.length < 3) {
      return null
    }
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    const my = ys.reduce((a, b) => a + b, 0) / ys.length
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < xs.length; i += 1) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    if (dx <= 0 || dy <= 0) {
      return null
    }
    return num / Math.sqrt(dx * dy)
  }

  function bandLevelAt(note, timeSec) {
    const env = bandEnv.get(note.midi)
    const f = Math.max(0, Math.min(frameCount - 1, toFrame(timeSec)))
    return env[f]
  }

  const ghostRise = riseTime(ghost)
  const ghostFlux = transientNear(ghost.start)
  // Lower-band level at ghost end vs ghost peak: does the parent ring on?
  const lowerAtGhostEnd = bandLevelAt(lower, ghost.start + ghost.span)
  const lowerPeakNear = (() => {
    const env = bandEnv.get(lower.midi)
    let peak = 0
    const end = Math.min(frameCount - 1, toFrame(ghost.start + ghost.span))
    for (let f = Math.max(0, toFrame(ghost.start)); f <= end; f += 1) {
      peak = Math.max(peak, env[f])
    }
    return peak
  })()
  const result = {
    clip,
    ghost: {
      ...ghost,
      transientHeight: Number(ghostFlux.height.toFixed(3)),
      transientDeltaMs: ghostFlux.deltaMs,
      transientAtSec: Number(ghostFlux.atSec.toFixed(3)),
      riseMs: ghostRise.ms,
      decayCorrWithLower: decayCorrelation(ghost, lower) == null ? null : Number(decayCorrelation(ghost, lower).toFixed(3)),
      lowerRingsAtGhostEnd: lowerPeakNear > 0 ? Number((lowerAtGhostEnd / lowerPeakNear).toFixed(3)) : null,
      sustainRatio: Number((ghost.span / lower.span).toFixed(3)),
    },
    controls: upperTrue.map((u) => {
      const rise = riseTime(u)
      const flx = transientNear(u.start)
      return {
        ...u,
        transientHeight: Number(flx.height.toFixed(3)),
        transientDeltaMs: flx.deltaMs,
        riseMs: rise.ms,
        decayCorrWithLower: decayCorrelation(u, lower) == null ? null : Number(decayCorrelation(u, lower).toFixed(3)),
        sustainRatio: Number((u.span / lower.span).toFixed(3)),
      }
    }),
  }
  return result
}

const clip = arg('clip')
if (!clip) {
  console.error('usage: analyze-pitch-trajectories.mjs --clip <wav> --ghost 60@0.13+0.36 --lower 48@0.13+0.36 [--true 64@0.13+0.33 ...]')
  process.exit(1)
}
const ghost = parseNote(arg('ghost'))
const lower = parseNote(arg('lower'))
const upperTrue = []
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--true' && process.argv[i + 1]) {
    upperTrue.push(parseNote(process.argv[i + 1]))
  }
}
console.log(JSON.stringify(analyze({ clip, ghost, lower, upperTrue }), null, 1))
