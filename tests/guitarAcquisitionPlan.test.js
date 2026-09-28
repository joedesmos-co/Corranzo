import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FAMILY_POLICY,
  FAMILY_TIERS,
  SCOREABLE_NOTE_FAMILIES,
  isScoreable,
} from '../tools/guitar-vision/acquisition-plan.mjs'
import { NOTATION_FAMILIES } from '../src/features/omr/guitar/notationFamilies.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coverage = JSON.parse(
  readFileSync(join(ROOT, 'datasets/guitar-vision/coverage.json'), 'utf8'),
)
const plan = JSON.parse(
  readFileSync(join(ROOT, 'datasets/guitar-vision/acquisition-plan.json'), 'utf8'),
)

describe('notation family registry', () => {
  it('tracks the full family surface, with no duplicates', () => {
    // 78 core families plus the individually-tracked ornaments. The count is
    // asserted rather than hard-coded everywhere so a deliberate addition is a
    // one-line change here and visible in review.
    expect(NOTATION_FAMILIES.length).toBeGreaterThanOrEqual(78)
    expect(new Set(NOTATION_FAMILIES).size).toBe(NOTATION_FAMILIES.length)
  })

  it('tracks ornaments individually rather than only as a group', () => {
    // A single `ornament` family would hide which ornament is unlabelled.
    for (const family of ['ornament', 'trill', 'mordent', 'turn']) {
      expect(NOTATION_FAMILIES, family).toContain(family)
    }
  })

  it('covers every guitar technique the mission requires', () => {
    // A silently dropped family is exactly the failure this registry prevents.
    for (const required of [
      'bend',
      'bend-amount',
      'pre-bend',
      'bend-release',
      'vibrato',
      'hammer-on',
      'pull-off',
      'slide',
      'glissando',
      'natural-harmonic',
      'artificial-harmonic',
      'pinch-harmonic',
      'tapping',
      'palm-mute',
      'let-ring',
      'tremolo-picking',
      'tremolo',
      'whammy-bar',
      'capo',
      'alternate-tuning',
      'scordatura',
      'octave-shift',
      'chord-symbol',
      'chord-diagram',
      'barre',
      'pick-direction',
      'fingering',
      'fret-position',
      'string-assignment',
      'arpeggio',
    ]) {
      expect(NOTATION_FAMILIES, `missing family ${required}`).toContain(required)
    }
  })
})

describe('scoreability', () => {
  it('treats note-attribute families as scoreable', () => {
    for (const family of ['note', 'rest', 'sounding-pitch', 'augmentation-dot', 'fret-number']) {
      expect(isScoreable(family), family).toBe(true)
    }
  })

  it('treats unparsed marking families as not scoreable', () => {
    for (const family of ['palm-mute', 'let-ring', 'tremolo-picking', 'natural-harmonic']) {
      expect(isScoreable(family), family).toBe(false)
    }
  })

  it('agrees with the scoreable note set it is built on', () => {
    for (const family of SCOREABLE_NOTE_FAMILIES) {
      expect(isScoreable(family)).toBe(true)
    }
  })
})

describe('acquisition plan', () => {
  it('covers every tracked family', () => {
    expect(plan.families.length).toBe(NOTATION_FAMILIES.length)
    for (const family of NOTATION_FAMILIES) {
      expect(plan.families.map((entry) => entry.family)).toContain(family)
    }
  })

  it('assigns every family a real tier', () => {
    const tierLabels = Object.values(FAMILY_TIERS).map((tier) => tier.label)
    for (const entry of plan.families) {
      expect(tierLabels, entry.family).toContain(entry.tier)
    }
  })

  it('claims nothing that has no labels', () => {
    for (const entry of plan.families) {
      if (entry.labelableCount === 0) {
        expect(entry.claimable, `${entry.family} claimed with zero labels`).toBe(false)
      }
    }
  })

  it('claims nothing that lacks validation or held-out coverage', () => {
    for (const entry of plan.families) {
      if (entry.claimable) {
        expect(entry.shortfall.validation, `${entry.family}`).toBe(0)
        expect(entry.shortfall.heldout, `${entry.family}`).toBe(0)
      }
    }
  })

  it('claims nothing the parser cannot score', () => {
    for (const entry of plan.families) {
      if (entry.claimable) {
        expect(entry.extractableByParser, `${entry.family}`).toBe(true)
      }
    }
  })

  it('claims no guitar technique family, which is the honest current state', () => {
    const claimed = plan.families.filter((entry) => entry.claimable).map((entry) => entry.family)
    for (const technique of [
      'bend',
      'bend-amount',
      'vibrato',
      'hammer-on',
      'pull-off',
      'slide',
      'natural-harmonic',
      'artificial-harmonic',
      'pinch-harmonic',
      'tapping',
      'palm-mute',
      'let-ring',
      'tremolo-picking',
      'whammy-bar',
      'capo',
    ]) {
      expect(claimed, `${technique} must not be claimed`).not.toContain(technique)
    }
  })

  it('counts labelable sources only, never OMR output', () => {
    expect(coverage.excludedGenerated).toBeGreaterThan(500)
    // The inflated pre-provenance figure counted the engine's own output.
    expect(coverage.totals['accent']).toBe(0)
    expect(coverage.totals['hairpin']).toBe(0)
    expect(coverage.totals['slur']).toBe(0)
  })

  it('reports a real acquisition shortfall rather than implying readiness', () => {
    expect(plan.totals.totalRealInstancesShort).toBeGreaterThan(1000)
    expect(plan.totals.noLabels).toBeGreaterThan(40)
  })

  it('gives every family at least one acquisition route', () => {
    for (const entry of plan.families) {
      expect(entry.acquisitionRoutes.length, entry.family).toBeGreaterThan(0)
    }
  })

  it('flags TAB and paired-staff/TAB as requiring a corpus that does not exist', () => {
    for (const family of ['tab-staff', 'paired-staff-tab']) {
      const entry = plan.families.find((item) => item.family === family)
      expect(entry).toBeTruthy()
      const text = entry.acquisitionRoutes.map((route) => `${route.route} ${route.why}`).join(' ')
      expect(text).toMatch(/TAB|tab/)
      // TAB truth is not obtainable from the classical repertoire in use, so
      // that route must be marked as not realistic rather than merely listed.
      const tabRoute = entry.acquisitionRoutes.find((route) => route.realistic === false)
      expect(tabRoute, `${family} must flag the real corpus route as unrealistic`).toBeTruthy()
    }
  })

  it('permits synthesis only for training', () => {
    // The tier requirement for validation and held-out is never met by
    // synthesis, so the policy is enforced by construction in the plan.
    for (const entry of plan.families) {
      expect(entry.synthesisPolicy).toMatch(/^(partial|none)$/)
    }
    expect(FAMILY_POLICY.lyrics.synthesis).toBe('none')
  })
})
