/**
 * Attack evidence (M1): flux, snapshots, presence — pure + tested.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATTACK_EVIDENCE,
  attackCombPresence,
  captureAttackSnapshots,
  computeFluxEnvelope,
  fluxAtMs,
} from '../src/features/microphone-input/micAttackEvidence.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function toneBurst({ midi = 60, sampleRate = 44100, attackMs = 100, decaySeconds = 0.8, amplitude = 0.5 }) {
  const freq = 440 * 2 ** ((midi - 69) / 12)
  const total = Math.floor((attackMs / 1000 + decaySeconds) * sampleRate)
  const out = new Float32Array(total)
  const attackStart = Math.floor((attackMs / 1000) * sampleRate)
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate
    const env = i < attackStart ? 0 : Math.exp(-(t - attackMs / 1000) * 6)
    // Sharp pick click + harmonic tone (real attacks are broadband first).
    const click = i >= attackStart && i < attackStart + 40 ? (Math.random() - 0.5) * 2 : 0
    out[i] = amplitude * (env * Math.sin(2 * Math.PI * freq * t) * 0.7 + click * env)
  }
  return { samples: out, sampleRate, attackMs }
}

describe('micAttackEvidence', () => {
  it('reports full flux at a real attack and zero in silence', () => {
    const { samples, sampleRate, attackMs } = toneBurst({})
    const envelope = computeFluxEnvelope(samples, sampleRate)
    expect(fluxAtMs(envelope, attackMs, 0)).toBeGreaterThan(0.5)
    // Decay tail 500 ms later: no attack evidence.
    expect(fluxAtMs(envelope, attackMs + 500, 0)).toBeLessThan(0.2)
    const silence = computeFluxEnvelope(new Float32Array(44100), 44100)
    expect(fluxAtMs(silence, 500, 0)).toBe(0)
  })

  it('captures the struck pitch in the attack snapshot, not neighbors', () => {
    const { samples, sampleRate, attackMs } = toneBurst({ midi: 60 })
    const envelope = computeFluxEnvelope(samples, sampleRate)
    const snapshots = captureAttackSnapshots({ samples, sampleRate, envelope, bufferStartMs: 0 })
    expect(snapshots.length).toBeGreaterThan(0)
    const struck = attackCombPresence(snapshots, 60, attackMs + 1500)
    const neighbor = attackCombPresence(snapshots, 63, attackMs + 1500)
    expect(struck.presence).toBeGreaterThan(1.0)
    expect(neighbor.presence).toBeLessThan(struck.presence * 0.5)
  })

  it('finds E2 energy (not Eb4) at the E2 attack of the low-high clip', () => {
    const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-polyphony', 'clips', 'uiowa-guitar-mf-low-high-e2-e4.wav'))
    const samples = Float32Array.from(wav.samples)
    const envelope = computeFluxEnvelope(samples, wav.sampleRate)
    const snapshots = captureAttackSnapshots({ samples, sampleRate: wav.sampleRate, envelope, bufferStartMs: 0 })
    // E2 attack lands ~80 ms; query from the decay phase like the live veto would.
    const e2 = attackCombPresence(snapshots, 40, 1630)
    const eb = attackCombPresence(snapshots, 63, 1630)
    expect(e2.presence).toBeGreaterThan(1.0)
    expect(eb.presence).toBeLessThan(e2.presence)
  })

  it('documents the non-dominant-pitch limit (true E4 scores below ghosts)', () => {
    // Split C3+E4+G4: C3's own partials (261/392 Hz) dominate the attack
    // spectrum, so TRUE E4's comb (0.34) scores below the low-high ghost
    // Eb4 (0.76). Any threshold killing ghosts kills true E4 first —
    // the measured reason no comb-presence veto ships (see
    // harmonicGhostVetoes docstring, negative #5).
    const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-polyphony', 'clips', 'uiowa-piano-mf-split-c3-e4-g4.wav'))
    const samples = Float32Array.from(wav.samples)
    const envelope = computeFluxEnvelope(samples, wav.sampleRate)
    const snapshots = captureAttackSnapshots({ samples, sampleRate: wav.sampleRate, envelope, bufferStartMs: 0 })
    const e4 = attackCombPresence(snapshots, 64, 500)
    const ghostOctave = attackCombPresence(snapshots, 60, 500)
    expect(e4.presence).toBeLessThan(1.0)
    expect(ghostOctave.presence).toBeGreaterThan(e4.presence)
  })

  it('drops snapshots older than the retention window', () => {
    const { samples, sampleRate } = toneBurst({})
    const envelope = computeFluxEnvelope(samples, sampleRate)
    const snapshots = captureAttackSnapshots({ samples, sampleRate, envelope, bufferStartMs: 0 })
    expect(snapshots.length).toBeGreaterThan(0)
    const aged = captureAttackSnapshots({
      samples: new Float32Array(sampleRate),
      sampleRate,
      envelope: computeFluxEnvelope(new Float32Array(sampleRate), sampleRate),
      bufferStartMs: 0,
      nowMs: ATTACK_EVIDENCE.snapshotRetentionSeconds * 1000 + 5000,
      previous: snapshots,
    })
    expect(aged).toHaveLength(0)
  })
})
