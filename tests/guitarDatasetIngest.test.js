/**
 * Dataset v2 ingest gate tests (D2/D13).
 *
 * The licensing gate and quarantine taxonomy are load-bearing for the whole
 * collection campaign: verify them against real fixture files, not mocks.
 */
import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingestCandidate, stampSourceIds, LICENSE_ALLOWLIST } from '../tools/guitar-vision/dataset-ingest.mjs'
import { assignChord, assignPosition, etudeManifest, ETUDE_LICENSE } from '../tools/guitar-vision/build-original-etudes.mjs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(ROOT, 'datasets/guitar-vision/fixtures/notation-v1/tab-chord-verified.musicxml')
const work = join(tmpdir(), 'guitar-ingest-tests')
mkdirSync(work, { recursive: true })

describe('dataset ingest gate', () => {
  it('stamps stable IDs deterministically', () => {
    const xml = '<score><note/><note/></score>'
    const first = stampSourceIds(xml, 's')
    const second = stampSourceIds(xml, 's')
    expect(first.ids).toEqual(['s-n001', 's-n002'])
    expect(second.stamped).toBe(first.stamped)
  })

  it('passes a clean licensed file', async () => {
    const record = await ingestCandidate(
      { id: 'tab-chord-verified', path: 'datasets/guitar-vision/fixtures/notation-v1/tab-chord-verified.musicxml', collection: 'test', license: 'CC0-1.0', tier: 'real' },
      work,
    )
    expect(record.status).toBe('PASS')
    expect(record.eventCount).toBeGreaterThan(0)
  })

  it('quarantines unclear licensing instead of including', async () => {
    for (const license of [null, undefined, 'copyrighted', 'CC-BY-NC-4.0']) {
      const record = await ingestCandidate(
        { id: 'x', path: FIXTURE, collection: 'test', license, tier: 'real' },
        work,
      )
      expect(record.status).toBe('QUARANTINED:licensing')
    }
    expect(LICENSE_ALLOWLIST).toContain('CC0-1.0')
    expect(LICENSE_ALLOWLIST).toContain('CC-BY-SA-4.0')
    expect(LICENSE_ALLOWLIST).not.toContain('CC-BY-NC-4.0')
  })

  it('quarantines missing files with reasons, never silently', async () => {
    const record = await ingestCandidate(
      { id: 'ghost', path: 'datasets/does-not-exist.musicxml', collection: 'test', license: 'CC0-1.0', tier: 'real' },
      work,
    )
    expect(record.status).toBe('QUARANTINED:read-failure')
    expect(record.quarantineReason).toBeTruthy()
  })
})

describe('controlled original etudes', () => {
  it('assigns playable positions and voicings', () => {
    for (const midi of [40, 48, 55, 64, 72, 76]) {
      const pos = assignPosition(midi)
      expect(pos.fret).toBeGreaterThanOrEqual(0)
      expect(pos.string).toBeGreaterThanOrEqual(1)
    }
    const voicing = assignChord([62, 67, 71, 74])
    expect(voicing).not.toBeNull()
    expect(new Set(voicing.map((v) => v.string)).size).toBe(4)
    expect(assignChord([20, 30, 90, 100])).toBeNull()
  })

  it('declares CC0 original provenance for every etude', () => {
    const manifest = etudeManifest()
    expect(manifest.license).toBe(ETUDE_LICENSE)
    expect(manifest.count).toBeGreaterThan(25)
    const families = new Set(manifest.etudes.flatMap((e) => e.families))
    for (const required of ['bend-amount', 'slide', 'hammer-on', 'natural-harmonic', 'tapping', 'palm-mute', 'capo', 'chord-diagram', 'tuplet']) {
      expect(families.has(required), required).toBe(true)
    }
  })
})
