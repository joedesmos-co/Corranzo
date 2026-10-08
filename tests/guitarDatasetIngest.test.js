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
