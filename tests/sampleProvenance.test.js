/**
 * Legal-provenance guards for the bundled instrument samples.
 *
 * These are cheap, permanent checks on the properties that made the sample
 * sets legally usable, so a future change cannot silently undo them. The
 * full byte-identity proof (re-encoding every upstream file and comparing
 * md5) lives in `scripts/audio-render/verify-provenance.py` because it
 * needs the network; this suite pins what does not need it.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ELECTRIC_GUITAR_SAMPLE_SOURCE_URL,
  ELECTRIC_GUITAR_SAMPLE_URLS,
  getElectricGuitarSampleFallbackBaseUrl,
} from '../src/features/playback/electricGuitarInstrument.js'
import { DEFAULT_PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from '../src/features/playback/pianoInstrument.js'
import { GUITAR_SAMPLE_URLS } from '../src/features/playback/guitarInstrument.js'
import { SOUND_CREDITS } from '../src/features/legal/legalInfo.js'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('instrument sample provenance guards', () => {
  it('pins the clean-electric samples to the CC0 owner repository', () => {
    // The previous set came from a wrapper repo whose licence claim could
    // not be traced to the originating owner. Pointing anywhere else is a
    // legal change, not a refactor.
    expect(ELECTRIC_GUITAR_SAMPLE_SOURCE_URL).toBe(
      'https://github.com/sfzinstruments/karoryfer.emilyguitar',
    )
  })

  it('restores no cross-origin fallback for the clean-electric set', () => {
    // The old fallback pointed at the unverified wrapper set, so a
    // same-origin load failure would have silently re-introduced it. With
    // no fallback the voice falls back to its synth and reports SYNTH.
    expect(getElectricGuitarSampleFallbackBaseUrl()).toBeNull()
  })

  it('keeps the piano on the same-origin mirror before the CDN fallback', () => {
    // The CDN fallback is a convenience for self-hosted deployments; the
    // primary path must stay same-origin, and the CDN must stay the
    // Salamander origin so provenance is not silently changed.
    expect(DEFAULT_PIANO_SAMPLE_BASE_URL).toMatch(/salamander/)
  })

  it('names an owner, a licence and a verification source for every credited asset', () => {
    for (const credit of SOUND_CREDITS) {
      expect(credit.author).toBeTruthy()
      expect(credit.license).toBeTruthy()
      expect(credit.verifiedFrom).toBeTruthy()
      expect(Array.isArray(credit.usedFor)).toBe(true)
      expect(credit.usedFor.length).toBeGreaterThan(0)
    }
  })

  it('does not credit the clean-electric samples to the wrapper repository', () => {
    const electric = SOUND_CREDITS.filter((credit) =>
      credit.usedFor.includes('electric-guitar'),
    )
    expect(electric).toHaveLength(1)
    expect(electric[0].license).toMatch(/CC0/)
    expect(electric[0].author.toLowerCase()).toContain('karoryfer')
  })

  it('only references bundled files that actually exist', () => {
    const dirs = {
      piano: 'salamander',
      guitar: 'guitar-acoustic',
      'electric-guitar': 'guitar-electric',
    }
    const maps = {
      piano: PIANO_SAMPLE_URLS,
      guitar: GUITAR_SAMPLE_URLS,
      'electric-guitar': ELECTRIC_GUITAR_SAMPLE_URLS,
    }
    const checked = new Set()
    for (const credit of SOUND_CREDITS) {
      for (const voice of credit.usedFor) {
        if (checked.has(voice)) {
          continue
        }
        checked.add(voice)
        const dir = dirs[voice]
        expect(dir, `no sample dir for voice ${voice}`).toBeTruthy()
        const absolute = join(projectRoot, 'public', 'audio', dir)
        expect(existsSync(absolute)).toBe(true)
        const files = new Set(readdirSync(absolute).filter((name) => name.endsWith('.mp3')))
        for (const file of Object.values(maps[voice])) {
          expect(files.has(file), `${voice}: ${file} missing`).toBe(true)
        }
      }
    }
    expect([...checked].sort()).toEqual(['electric-guitar', 'guitar', 'piano'])
  })
})
