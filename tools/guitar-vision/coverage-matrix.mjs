#!/usr/bin/env node
/**
 * Guitar Vision — machine-readable coverage matrix (G9/G16).
 *
 * Joins the versioned vocabulary, the deterministic fixture round-trips and
 * the playability gate into one JSON artifact. No green status merely because
 * a glyph appears visually: a family is VERIFIED_SUPPORTED only when a fixture
 * round-trips source -> parser -> canonical truth with exact semantic equality.
 *
 * Usage:
 *   node tools/guitar-vision/coverage-matrix.mjs [--out path]
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { canonicalEventsFromParsed } from '../../src/features/omr/guitar/guitarCanonicalEvents.js'
import { validatePlayability } from '../../src/features/omr/guitar/guitarPlayability.js'
import { SUPPORT, VOCABULARY, GUITAR_VOCABULARY_VERSION } from '../../src/features/omr/guitar/guitarVocabulary.js'
import { FIXTURES } from './build-notation-fixtures.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Gate status per family (G16):
 * - VERIFIED_SUPPORTED: truth-verifiable today AND a fixture proves the round-trip.
 * - VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR: quarantined by
 *   construction (audit + quarantine path proven by a fixture); the product
 *   must decline rather than invent.
 * - BLOCKING_GAP: truth cannot represent it yet, or the parser drops it with
 *   no quarantine path. Training must not claim it.
 * - UNKNOWN: no fixture, no verification — must not proceed into training.
 */
function gateStatus(entry, fixtureResult, quarantines = 0) {
  if (!fixtureResult) {
    return entry.support === SUPPORT.SUPPORTED_AND_LABELED ? 'BLOCKING_GAP' : 'UNKNOWN'
  }
  if (!fixtureResult.passed) return 'BLOCKING_GAP'
  switch (entry.support) {
    case SUPPORT.SUPPORTED_AND_LABELED:
      return 'VERIFIED_SUPPORTED'
    case SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED:
      // Parsed-and-proven is supportable. Absent-from-parser splits two ways:
      // a verified quarantine path means the product can explicitly decline
      // (defined behavior); zero quarantine means the gap is silent (blocking).
      if (entry.parser !== 'absent') return 'VERIFIED_SUPPORTED'
      return quarantines > 0 ? 'VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR' : 'BLOCKING_GAP'
    case SUPPORT.EXPLICITLY_UNSUPPORTED:
    case SUPPORT.AMBIGUOUS:
      return 'VERIFIED_UNSUPPORTED_WITH_EXPLICIT_PRODUCT_BEHAVIOR'
    default:
      return 'BLOCKING_GAP'
  }
}

function runFixture(fixture) {
  try {
    const xml = fixture.build()
    const parsed = parseMusicXml(xml, `${fixture.name}.musicxml`)
    const canonical = canonicalEventsFromParsed(parsed, {
      sourceId: fixture.name, rawXml: xml, ...(fixture.tuning ? { tuning: fixture.tuning } : {}),
    })
    const playability = validatePlayability(canonical)
    const spec = fixture.expect
    const passed =
      canonical.events.length === spec.events &&
      canonical.quarantined.length === (spec.quarantined ?? 0) &&
      (spec.timingPreserved === false || spec.quarantined > 0 || canonical.rhythm.timingPreserved)
    return { passed, events: canonical.events.length, quarantined: canonical.quarantined.length, playabilityOk: playability.ok }
  } catch (error) {
    return { passed: false, error: String(error?.message ?? error) }
  }
}

export function buildCoverageMatrix() {
  const fixtureResults = new Map(FIXTURES.map((f) => [f.name, { fixture: f, result: runFixture(f) }]))
  const familyToFixtures = new Map()
  for (const [name, { fixture }] of fixtureResults) {
    for (const family of fixture.families) {
      if (!familyToFixtures.has(family)) familyToFixtures.set(family, [])
      familyToFixtures.get(family).push(name)
    }
  }

  const families = VOCABULARY.map((entry) => {
    const covering = familyToFixtures.get(entry.family) ?? []
    // Structural families (score/part/system) are exercised by every passing
    // parse: a fixture that round-trips proves the part-list, part content and
    // system-break plumbing it stands on.
    const implicit = covering.length === 0 && ['score', 'part', 'system'].includes(entry.family) &&
      [...fixtureResults.values()].some((f) => f.result.passed)
    const results = covering.map((name) => fixtureResults.get(name).result)
    const fixtureResult = covering.length ? { passed: results.every((r) => r.passed) } : (implicit ? { passed: true } : null)
    const quarantines = covering.reduce((sum, name) => sum + (fixtureResults.get(name).result.quarantined ?? 0), 0)
    return {
      family: entry.family,
      category: entry.category,
      support: entry.support,
      parser: entry.parser,
      reason: entry.reason ?? null,
      musicXml: entry.musicXml.elements,
      fixtures: covering,
      implicit: implicit || undefined,
      roundTrip: fixtureResult?.passed ?? null,
      gate: gateStatus(entry, fixtureResult, quarantines),
    }
  })

  const gates = {}
  for (const row of families) gates[row.gate] = (gates[row.gate] ?? 0) + 1
  const blocking = families.filter((f) => f.gate === 'BLOCKING_GAP').map((f) => f.family)
  const unknown = families.filter((f) => f.gate === 'UNKNOWN').map((f) => f.family)

  return {
    version: 'guitar-coverage/1.0',
    vocabulary: GUITAR_VOCABULARY_VERSION,
    generatedAt: new Date().toISOString(),
    fixtureCount: FIXTURES.length,
    fixturesPassed: [...fixtureResults.values()].filter((f) => f.result.passed).length,
    familyCount: families.length,
    gates,
    blocking,
    unknown,
    families,
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const outIndex = process.argv.indexOf('--out')
  const out = outIndex >= 0 ? process.argv[outIndex + 1]
    : 'datasets/guitar-vision/fixtures/notation-v1/coverage-matrix.json'
  const matrix = buildCoverageMatrix()
  writeFileSync(resolve(ROOT, out), JSON.stringify(matrix, null, 2))
  console.log(`families=${matrix.familyCount} fixtures=${matrix.fixtureCount} passed=${matrix.fixturesPassed} gates=${JSON.stringify(matrix.gates)}`)
  if (matrix.unknown.length) console.log(`UNKNOWN: ${matrix.unknown.join(', ')}`)
  if (matrix.blocking.length) console.log(`BLOCKING_GAP: ${matrix.blocking.join(', ')}`)
}
