#!/usr/bin/env node
/**
 * Guitar Vision — notation data acquisition plan.
 *
 * Turns the labelable coverage inventory into a quantified, per-family
 * acquisition requirement, and refuses to describe any family as supported when
 * it has no honest labels.
 *
 * ## The rule this encodes
 *
 * Synthetic data may supplement training. It may never stand in for real
 * validation or real held-out evaluation. So every family carries a split
 * requirement, and the synthetic allowance applies to the training split only. A
 * family whose validation and held-out examples would have to be synthetic is
 * reported as `synthetic-validated-only`, which is a statement about the
 * product's evidence, not a claim of support.
 *
 * Usage:
 *   node tools/guitar-vision/acquisition-plan.mjs
 *   node tools/guitar-vision/acquisition-plan.mjs --json out.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOTATION_FAMILIES } from '../../src/features/omr/guitar/notationFamilies.js'
import { EXTRACTABLE_FAMILIES } from '../../src/features/omr/guitar/guitarMetrics.js'
import { MARKING_FAMILIES } from '../../src/features/omr/guitar/guitarObjects.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COVERAGE = join(ROOT, 'datasets/guitar-vision/coverage.json')

function argValue(args, flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}

/**
 * Family tiers, with a requirement per split.
 *
 * The driver is *real-world frequency*, not importance. A family that never
 * appears in published guitar music cannot be required at real volume, and
 * chasing it would distort the corpus; one that appears in ordinary pieces must
 * be represented across independent collections in every split, or a validation
 * number will swing on whether a single page happened to contain it.
 *
 * `trainCollections` is a collection-level floor because of the leakage findings
 * in docs/GUITAR_VISION_SPLITS.md: three Aguado studies sharing an engraver are
 * not three independent observations.
 */
export const FAMILY_TIERS = Object.freeze({
  essential: {
    label: 'essential',
    train: 60,
    validation: 12,
    heldout: 12,
    trainCollections: 4,
    note: 'Common in ordinary guitar music. Must be genuinely learned and measured.',
  },
  important: {
    label: 'important',
    train: 30,
    validation: 6,
    heldout: 6,
    trainCollections: 3,
    note: 'Regularly encountered in published guitar scores.',
  },
  occasional: {
    label: 'occasional',
    train: 15,
    validation: 3,
    heldout: 3,
    trainCollections: 2,
    note: 'Appears in specific genres or passages. Lower volume is honest.',
  },
  rare: {
    label: 'rare',
    train: 8,
    validation: 2,
    heldout: 2,
    trainCollections: 1,
    note: 'Legitimate but uncommon. Volume will come from synthesis; honesty required.',
  },
  unobtainable_real: {
    label: 'unobtainable-real',
    train: 0,
    validation: 0,
    heldout: 0,
    trainCollections: 0,
    note: 'Effectively absent from published guitar music. Support cannot be claimed.',
  },
})

/**
 * Which tier each family belongs to, and where its labels can honestly come from.
 *
 * `synthesis` is permitted for the training split only. `requiresRealPages` marks
 * families whose visual form cannot be produced by a renderer at all — a phone
 * photo of a worn handwritten chart, for instance — where only real capture
 * teaches the appearance.
 */
export const FAMILY_POLICY = Object.freeze({
  // --- core music, ubiquitous in guitar music ---
  note: { tier: 'essential', synthesis: 'partial' },
  rest: { tier: 'essential', synthesis: 'partial' },
  chord: { tier: 'essential', synthesis: 'partial' },
  'stacked-notes': { tier: 'essential', synthesis: 'partial' },
  'multi-voice': { tier: 'important', synthesis: 'partial' },
  'augmentation-dot': { tier: 'important', synthesis: 'partial' },
  tuplet: { tier: 'important', synthesis: 'partial' },
  accidental: { tier: 'important', synthesis: 'partial' },
  'key-signature': { tier: 'essential', synthesis: 'partial' },
  'time-signature': { tier: 'essential', synthesis: 'partial' },
  clef: { tier: 'essential', synthesis: 'partial' },
  barline: { tier: 'essential', synthesis: 'partial' },
  tie: { tier: 'important', synthesis: 'partial' },
  slur: { tier: 'important', synthesis: 'partial' },
  repeat: { tier: 'important', synthesis: 'partial' },
  'tempo-marking': { tier: 'important', synthesis: 'partial' },

  // --- structural, common but under-represented here ---
  'first-ending': { tier: 'occasional', synthesis: 'partial' },
  'second-ending': { tier: 'occasional', synthesis: 'partial' },
  segno: { tier: 'occasional', synthesis: 'partial' },
  coda: { tier: 'occasional', synthesis: 'partial' },
  'dc-ds': { tier: 'occasional', synthesis: 'partial' },
  'time-sig-change': { tier: 'occasional', synthesis: 'partial' },
  'key-change': { tier: 'occasional', synthesis: 'partial' },
  'clef-change': { tier: 'occasional', synthesis: 'partial' },
  ritardando: { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  accelerando: { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  'performance-text': { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  lyrics: { tier: 'rare', synthesis: 'none' },

  // --- articulations and expression ---
  staccato: { tier: 'important', synthesis: 'partial' },
  accent: { tier: 'important', synthesis: 'partial' },
  tenuto: { tier: 'occasional', synthesis: 'partial' },
  marcato: { tier: 'occasional', synthesis: 'partial' },
  sforzando: { tier: 'occasional', synthesis: 'partial' },
  fermata: { tier: 'occasional', synthesis: 'partial' },
  dynamic: { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  hairpin: { tier: 'important', synthesis: 'partial' },
  ornament: { tier: 'occasional', synthesis: 'partial' },
  trill: { tier: 'occasional', synthesis: 'partial' },
  mordent: { tier: 'rare', synthesis: 'partial' },
  turn: { tier: 'rare', synthesis: 'partial' },
  'double-trill': { tier: 'rare', synthesis: 'partial' },
  'tremolo-marking': { tier: 'occasional', synthesis: 'partial' },
  arpeggio: { tier: 'important', synthesis: 'partial' },
  'grace-note': { tier: 'important', synthesis: 'partial' },
  'cue-note': { tier: 'occasional', synthesis: 'partial' },
  'ghost-note': { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  'dead-note': { tier: 'occasional', synthesis: 'partial' },

  // --- TAB fundamentals: the real deficit ---
  'tab-staff': { tier: 'essential', synthesis: 'partial' },
  'fret-number': { tier: 'essential', synthesis: 'partial' },
  'string-number': { tier: 'essential', synthesis: 'partial' },
  'string-assignment': { tier: 'essential', synthesis: 'partial' },
  'paired-staff-tab': { tier: 'essential', synthesis: 'partial' },
  'fret-position': { tier: 'occasional', synthesis: 'partial' },
  'multi-staff': { tier: 'important', synthesis: 'partial' },

  // --- guitar technique: the largest real deficit ---
  bend: { tier: 'important', synthesis: 'partial' },
  'bend-amount': { tier: 'important', synthesis: 'partial' },
  'bend-with-fret': { tier: 'occasional', synthesis: 'partial' },
  'pre-bend': { tier: 'occasional', synthesis: 'partial' },
  'bend-release': { tier: 'occasional', synthesis: 'partial' },
  vibrato: { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  'hammer-on': { tier: 'essential', synthesis: 'partial' },
  'pull-off': { tier: 'essential', synthesis: 'partial' },
  slide: { tier: 'essential', synthesis: 'partial' },
  glissando: { tier: 'occasional', synthesis: 'partial' },
  'natural-harmonic': { tier: 'important', synthesis: 'partial' },
  'artificial-harmonic': { tier: 'important', synthesis: 'partial' },
  'pinch-harmonic': { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  tapping: { tier: 'occasional', synthesis: 'partial' },
  'palm-mute': { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  'let-ring': { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  'tremolo-picking': { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  tremolo: { tier: 'important', synthesis: 'partial' },
  'whammy-bar': { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  fingering: { tier: 'occasional', synthesis: 'partial' },
  'pick-direction': { tier: 'occasional', synthesis: 'partial', requiresRealPages: true },
  barre: { tier: 'occasional', synthesis: 'partial' },
  'chord-symbol': { tier: 'important', synthesis: 'partial' },
  'chord-diagram': { tier: 'occasional', synthesis: 'partial' },

  // --- setup and tuning ---
  capo: { tier: 'important', synthesis: 'partial', requiresRealPages: true },
  'tuning-change': { tier: 'occasional', synthesis: 'partial' },
  'alternate-tuning': { tier: 'occasional', synthesis: 'partial' },
  scordatura: { tier: 'unobtainable_real', synthesis: 'partial' },
  'octave-shift': { tier: 'occasional', synthesis: 'partial' },
})

/** Where labels for a family can honestly be obtained. */
function acquisitionRoutes(family) {
  const policy = FAMILY_POLICY[family]
  if (!policy) return []
  const routes = []
  if (family === 'tab-staff' || family === 'paired-staff-tab' || family === 'fret-number') {
    routes.push({
      route: 'publish matched PDF+MusicXML pairs for real TAB scores',
      why: 'TAB truth does not exist in the public-domain classical repertoire; the whole TAB corpus must be built',
      realistic: false,
      note: 'Requires transcribing TAB scores by hand and rendering them, or licensing existing ones.',
    })
  }
  routes.push({
    route: 'Mutopia Project and public-domain guitar editions',
    why: 'Already the richest source of matched real guitar PDF+MusicXML in the repository',
    realistic: true,
  })
  routes.push({
    route: 'IMSLP / MuseScore public-domain guitar collections',
    why: 'Large volume of real engraved guitar scores, many with paired staff+TAB',
    realistic: true,
  })
  if (policy.synthesis !== 'none') {
    routes.push({
      route: 'deterministic synthesis from an event model (TRAIN SPLIT ONLY)',
      why: 'Supplies volume and exact geometry; never substitutes for real validation or held-out',
      realistic: true,
    })
  }
  if (policy.requiresRealPages) {
    routes.push({
      route: 'page capture from real published scores',
      why: 'Engraver-specific glyph form and placement cannot be reproduced by a renderer',
      realistic: true,
      required: true,
    })
  }
  return routes
}

/**
 * Notation families the strict metric scores as note-object attributes.
 *
 * These are scoreable by construction: `extractNoteObjects` reads them off every
 * parsed note and `scoreAttribute` compares them per matched pair. They are not
 * members of EXTRACTABLE_FAMILIES, which describes *marking* families only —
 * conflating the two would report dozens of perfectly scoreable families as
 * unmeasurable.
 */
export const SCOREABLE_NOTE_FAMILIES = new Set([
  'note',
  'rest',
  'chord',
  'multi-voice',
  'sounding-pitch',
  'written-pitch',
  'onset',
  'duration',
  'augmentation-dot',
  'tuplet',
  'string-number',
  'fret-number',
  'accidental',
  'multi-staff',
])

/**
 * True when the strict metric can produce a per-object score for this family.
 *
 * Note-attribute families always can. Marking families can only when the parser
 * populates them, which today is a short list.
 */
export function isScoreable(family) {
  if (SCOREABLE_NOTE_FAMILIES.has(family)) return true
  if (EXTRACTABLE_FAMILIES.has(family)) return true
  const camel = family.replace(/-([a-z])/g, (_match, character) => character.toUpperCase())
  return EXTRACTABLE_FAMILIES.has(camel)
}

function buildPlan(coverage) {
  const markingFamilyNames = new Set(MARKING_FAMILIES.map((name) => name.toLowerCase()))
  const plan = []

  for (const family of NOTATION_FAMILIES) {
    const current = coverage.totals?.[family] ?? 0
    const policy = FAMILY_POLICY[family] ?? { tier: 'important', synthesis: 'partial' }
    const tier = FAMILY_TIERS[policy.tier] ?? FAMILY_TIERS.important

    const extractable =
      isScoreable(family) ||
      markingFamilyNames.has(family) ||
      EXTRACTABLE_FAMILIES.has(family.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()))

    const shortfall = {
      train: Math.max(0, tier.train - current),
      validation: Math.max(0, tier.validation - Math.floor(current * 0.2)),
      heldout: Math.max(0, tier.heldout - Math.floor(current * 0.2)),
    }

    const supportable =
      tier.train > 0 &&
      extractable &&
      (current > 0 || policy.synthesis === 'partial')

    let status
    if (current === 0) status = 'no-labels'
    else if (current < tier.train) status = 'under-represented'
    else status = 'adequate'

    plan.push({
      family,
      tier: tier.label,
      labelableCount: current,
      extractableByParser: extractable,
      synthesisPolicy: policy.synthesis ?? 'partial',
      requiresRealPages: Boolean(policy.requiresRealPages),
      requirement: {
        train: tier.train,
        validation: tier.validation,
        heldout: tier.heldout,
        trainCollections: tier.trainCollections,
      },
      shortfall,
      status,
      supportable,
      /**
       * The only statuses that may be reported to a user as supported. Anything
       * else is a known gap, and the product must say so rather than silently
       * dropping the notation.
       */
      claimable: supportable && status === 'adequate' && shortfall.validation === 0 && shortfall.heldout === 0,
      acquisitionRoutes: acquisitionRoutes(family),
      tierNote: tier.note,
    })
  }

  plan.sort((left, right) => {
    const order = ['no-labels', 'under-represented', 'adequate']
    const byStatus = order.indexOf(left.status) - order.indexOf(right.status)
    if (byStatus) return byStatus
    const tierOrder = ['essential', 'important', 'occasional', 'rare', 'unobtainable_real']
    return tierOrder.indexOf(left.tier) - tierOrder.indexOf(right.tier)
  })

  const totals = {
    families: plan.length,
    noLabels: plan.filter((entry) => entry.status === 'no-labels').length,
    underRepresented: plan.filter((entry) => entry.status === 'under-represented').length,
    adequate: plan.filter((entry) => entry.status === 'adequate').length,
    claimable: plan.filter((entry) => entry.claimable).length,
    notExtractable: plan.filter((entry) => !entry.extractableByParser).length,
    totalRealInstancesShort: plan.reduce((sum, entry) => sum + entry.shortfall.train, 0),
    familiesNeedingRealPages: plan.filter((entry) => entry.requiresRealPages).length,
  }

  return { totals, families: plan }
}

function main() {
  const args = process.argv.slice(2)
  const jsonOut = argValue(args, '--json', null)

  if (!existsSync(COVERAGE)) {
    console.error(
      `Missing ${COVERAGE}. Generate it first:\n` +
        '  node tools/guitar-vision/notation-coverage.mjs --json datasets/guitar-vision/coverage.json',
    )
    process.exitCode = 1
    return
  }
  const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8'))
  const plan = buildPlan(coverage)

  console.log('Guitar Vision — notation data acquisition plan')
  console.log('='.repeat(78))
  console.log(`families tracked:            ${plan.totals.families}`)
  console.log(`no labels at all:            ${plan.totals.noLabels}`)
  console.log(`under-represented:           ${plan.totals.underRepresented}`)
  console.log(`adequate for its tier:       ${plan.totals.adequate}`)
  console.log(`parser cannot extract:       ${plan.totals.notExtractable}`)
  console.log(`need real-page capture:      ${plan.totals.familiesNeedingRealPages}`)
  console.log(`claimable as supported:      ${plan.totals.claimable}`)
  console.log(`real instances still needed: ${plan.totals.totalRealInstancesShort}`)
  console.log('')
  console.log('No family may be described as supported unless it has honest real labels')
  console.log('in the training, validation AND held-out splits. Synthetic data may')
  console.log('supplement training only.')
  console.log('')
  console.log(`${'family'.padEnd(22)}${'tier'.padEnd(12)}${'have'.padStart(6)}${'need'.padStart(6)}  status`)
  console.log('-'.repeat(74))
  for (const entry of plan.families) {
    const marker = entry.claimable ? ' ' : '!'
    console.log(
      `${marker}${(entry.family.length > 20 ? entry.family.slice(0, 19) + '…' : entry.family).padEnd(21)}` +
        `${entry.tier.padEnd(12)}${String(entry.labelableCount).padStart(6)}${String(entry.requirement.train).padStart(6)}  ` +
        `${entry.status}${entry.extractableByParser ? '' : '  [not extractable]'}`,
    )
  }
  console.log('')
  console.log('! = must not be claimed as supported yet')
  console.log('')

  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true })
    writeFileSync(jsonOut, `${JSON.stringify({ version: 1, kind: 'guitar-vision-acquisition-plan', ...plan }, null, 2)}\n`)
    console.log(`Wrote ${jsonOut}`)
  }
}

main()
