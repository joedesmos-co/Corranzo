/**
 * Guitar Vision — comprehensive notation foundation tests (G9/G10/G16).
 *
 * For every deterministic fixture: source -> parser -> canonical GuitarEvent
 * -> serialized truth, asserting exact semantic equality (event counts,
 * quarantine codes, timing preservation). Unknown notation must quarantine,
 * never vanish. This is schema/provenance verification, NOT model training.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  auditRawXmlGaps,
  canonicalEventsFromParsed,
  serializeCanonicalEvents,
} from '../src/features/omr/guitar/guitarCanonicalEvents.js'
import { validatePlayability } from '../src/features/omr/guitar/guitarPlayability.js'
import {
  SUPPORT,
  VOCABULARY,
  classifySourceElement,
  vocabularyByFamily,
  vocabularyFamilies,
  vocabularySummary,
} from '../src/features/omr/guitar/guitarVocabulary.js'
import { FIXTURES } from '../tools/guitar-vision/build-notation-fixtures.mjs'

function runFixture(fixture) {
  const xml = fixture.build()
  const parsed = parseMusicXml(xml, `${fixture.name}.musicxml`)
  const canonical = canonicalEventsFromParsed(parsed, {
    sourceId: fixture.name,
    rawXml: xml,
    ...(fixture.tuning ? { tuning: fixture.tuning } : {}),
  })
  const playability = validatePlayability(canonical)
  return { xml, parsed, canonical, playability }
}

describe('notation fixture round-trips (G9)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: source -> parser -> canonical -> truth`, () => {
      const { parsed, canonical, playability } = runFixture(fixture)
      const expectSpec = fixture.expect

      expect(canonical.events.length).toBe(expectSpec.events)
      expect(canonical.quarantined.length).toBe(expectSpec.quarantined ?? 0)
      for (const code of expectSpec.quarantineCodes ?? (expectSpec.quarantineCode ? [expectSpec.quarantineCode] : [])) {
        expect(canonical.quarantined.map((q) => q.code)).toContain(code)
      }
      if (expectSpec.timingPreserved !== false && (expectSpec.quarantined ?? 0) === 0) {
        expect(canonical.rhythm.timingPreserved).toBe(true)
      }
      if (expectSpec.tabVerified != null) {
        expect(canonical.events.filter((e) => e.tab.pairing === 'verified').length).toBe(expectSpec.tabVerified)
      }
      if (fixture.name === 'tab-staff-rests-digits') {
        // Circled string numbers stay distinct from TAB fretting positions.
        expect(canonical.events[0].tab.positionKind).toBe('string-indication')
        expect(canonical.events[1].tab.positionKind).toBe('tab-fret')
      }
      if (expectSpec.pairings != null) {
        expect(canonical.pairings.length).toBe(expectSpec.pairings)
        expect(canonical.pairings.every((p) => p.verified)).toBe(true)
      }
      if (expectSpec.dotsSeen) {
        expect(canonical.events.map((e) => e.time.dots)).toEqual(expect.arrayContaining(expectSpec.dotsSeen))
      }
      if (expectSpec.tupletSeen) {
        expect(canonical.events.map((e) => e.time.tuplet)).toContain(expectSpec.tupletSeen)
      }
      if (expectSpec.techniqueKind) {
        expect(canonical.events.flatMap((e) => e.techniques.map((t) => t.kind))).toContain(expectSpec.techniqueKind)
      }
      if (expectSpec.bendSemitonesNull) {
        const bend = canonical.events.flatMap((e) => e.techniques).find((t) => t.kind === 'bend')
        expect(bend).toBeDefined()
        expect(bend.semitones).toBeNull()
      }
      if (expectSpec.allRests) {
        expect(canonical.events.every((e) => e.time.isRest)).toBe(true)
      }
      if (expectSpec.harmonyEvents != null) {
        expect(parsed.harmonyEvents.length).toBe(expectSpec.harmonyEvents)
      }
      if (expectSpec.tieContinuations != null) {
        expect(canonical.events.filter((e) => e.time.isTieContinuation).length).toBe(expectSpec.tieContinuations)
        // The chain head is restored to its notated length; the continuation
        // carries its own measure's quarters. Total sounded time is exact.
        expect(canonical.rhythm.totalQuarters).toBe(8)
      }
      if (expectSpec.noteTypes) {
        expect(canonical.events.map((e) => e.time.noteType)).toEqual(expectSpec.noteTypes)
      }
      if (expectSpec.spellings) {
        expect(canonical.events.map((e) => [e.pitch.step, e.pitch.alter, e.pitch.octave])).toEqual(expectSpec.spellings)
      }
      if (expectSpec.accidentals) {
        expect(canonical.events.map((e) => e.pitch.accidental)).toEqual(expectSpec.accidentals)
      }
      if (expectSpec.pickupSeen) {
        expect(parsed.measures[0].implicit).toBe(true)
      }
      if (expectSpec.vocabularySupport) {
        if (typeof expectSpec.vocabularySupport === 'string') {
          for (const family of fixture.families) {
            expect(vocabularyByFamily(family)?.support).toBe(expectSpec.vocabularySupport)
          }
        } else {
          for (const [family, support] of Object.entries(expectSpec.vocabularySupport)) {
            expect(vocabularyByFamily(family)?.support).toBe(support)
          }
        }
      }
      if (expectSpec.playabilityCode) {
        expect(playability.issues.map((i) => i.code)).toContain(expectSpec.playabilityCode)
      }
      if (expectSpec.repeatsSeen) {
        const markings = parsed.measures.map((m) => m.marking)
        expect(markings.some((m) => m?.forwardRepeat)).toBe(true)
        expect(markings.some((m) => m?.backwardRepeat)).toBe(true)
        expect(markings.some((m) => m?.endingStartNumbers)).toBe(true)
      }

      // Serialized truth is deterministic: same source, same bytes.
      const once = serializeCanonicalEvents(canonical)
      const { canonical: again } = runFixture(fixture)
      expect(serializeCanonicalEvents(again)).toBe(once)
    })
  }
})

describe('G4 standard<->TAB pairing truth', () => {
  it('verified positions imply their notation pitch under standard tuning', () => {
    const fixture = FIXTURES.find((f) => f.name === 'tab-chord-verified')
    const { canonical } = runFixture(fixture)
    expect(canonical.quarantined).toEqual([])
    for (const event of canonical.events) {
      expect(event.tab.pairing).toBe('verified')
    }
  })

  it('verified positions hold under alternate tuning from staff-details', () => {
    const fixture = FIXTURES.find((f) => f.name === 'alternate-tuning-drop-d')
    const { parsed, canonical } = runFixture(fixture)
    expect(parsed.parts[0].tuning).toEqual([64, 59, 55, 50, 45, 38])
    expect(canonical.quarantined).toEqual([])
    expect(canonical.events.every((e) => e.tab.pairing === 'verified')).toBe(true)
  })

  it('mismatched string/fret is quarantined, never silently repaired', () => {
    const fixture = FIXTURES.find((f) => f.name === 'pairing-mismatch-quarantine')
    const { canonical, playability } = runFixture(fixture)
    expect(canonical.quarantined.some((q) => q.code === 'pairing-pitch-mismatch')).toBe(true)
    expect(canonical.events[0].tab.pairing).toBe('quarantined')
    expect(playability.ok).toBe(false)
  })
})

describe('G10 unknown notation (never silently dropped)', () => {
  it('unregistered elements classify AMBIGUOUS, never "none"', () => {
    expect(classifySourceElement('squiggle').support).toBe(SUPPORT.AMBIGUOUS)
    expect(classifySourceElement('').support).toBe(SUPPORT.INVALID_SOURCE)
    expect(classifySourceElement(null).support).toBe(SUPPORT.INVALID_SOURCE)
  })

  it('unknown technical content quarantines with provenance', () => {
    const fixture = FIXTURES.find((f) => f.name === 'unknown-notation-quarantine')
    const { canonical, playability } = runFixture(fixture)
    const codes = canonical.quarantined.map((q) => q.code)
    expect(codes).toContain('unmodelled-technique-flag')
    expect(codes).toContain('impossible-position')
    expect(playability.issues.map((i) => i.code)).toContain('string-out-of-range')
    // Nothing was repaired: the offending values survive verbatim in truth.
    expect(canonical.events[0].tab.string).toBe(9)
  })

  it('raw audit catches what the parser drops: frame, segno/coda, grace, words', () => {
    const byName = Object.fromEntries(FIXTURES.map((f) => [f.name, f.build()]))
    expect(auditRawXmlGaps(byName['chord-diagram-frame-gap']).map((g) => g.element)).toContain('frame')
    expect(auditRawXmlGaps(byName['ds-coda-unsupported']).map((g) => g.element)).toEqual(
      expect.arrayContaining(['segno', 'coda']),
    )
    expect(auditRawXmlGaps(byName['grace-note-gap']).map((g) => g.code)).toContain('grace-dropped')
    expect(auditRawXmlGaps(byName['capo-text-ambiguous']).map((g) => g.code)).toContain('ignored-text-direction')
    // Clean fixtures audit clean: no false quarantines.
    expect(auditRawXmlGaps(byName['simple-4-4-rhythm'])).toEqual([])
    expect(auditRawXmlGaps(byName['tab-chord-verified'])).toEqual([])
  })
})

describe('G0/G16 vocabulary gate', () => {
  it('family names are unique and every fixture family is registered', () => {
    const families = vocabularyFamilies()
    expect(new Set(families).size).toBe(families.length)
    for (const fixture of FIXTURES) {
      for (const family of fixture.families) {
        expect(vocabularyByFamily(family), `${fixture.name} references unregistered family ${family}`).not.toBeNull()
      }
    }
  })

  it('every vocabulary entry carries a support state and a source mapping', () => {
    const summary = vocabularySummary()
    expect(summary.families).toBeGreaterThan(80)
    for (const entry of VOCABULARY) {
      expect(Object.values(SUPPORT)).toContain(entry.support)
      expect(entry.musicXml?.elements?.length).toBeGreaterThan(0)
      if (entry.support === SUPPORT.SUPPORTED_BUT_NOT_YET_MODELED && entry.parser === 'absent') {
        expect(entry.reason, `${entry.family} needs a reason`).toBeTruthy()
      }
    }
    expect(summary.counts[SUPPORT.SUPPORTED_AND_LABELED]).toBeGreaterThan(0)
  })

  it('fixture builders are deterministic', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.build()).toBe(fixture.build())
    }
  })
})
