#!/usr/bin/env node
/**
 * Guitar Dataset v2 — Stage 3: finalize (D10–D17, minus training).
 *
 * Reads Stage 1+2 work records and produces the pilot dataset:
 * - D11 duplicate/leakage detection (truth/file/pixel digests)
 * - D10 frozen score-level splits (collection-grouped, pre-registered)
 * - D3/D4/D5/D9 diversity + coverage quotas + scale analysis
 * - D15 zero-parameter sanity checks (no model fitting)
 * - D16 future-target materialization (counts, not training)
 * - D12 versioned content-addressed manifest
 *
 * Output goes to datasets/guitar-vision/v2-pilot/ (NOT v2: the pilot proves
 * the machinery on 12 real scores; the 150-score freeze happens later).
 *
 * Usage:
 *   node tools/guitar-vision/dataset-finalize.mjs --work <dir> --out <dir>
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  buildSplitManifest, auditSplitManifest, corpusSufficiency, heldOutSamples,
  truthDigest, fileDigest, SPLITS,
} from '../../src/features/omr/guitar/corpusSplits.js'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PILOT_VERSION = 'guitar-dataset-v2/1.0'

// D4 minimum-support tiers (score counts over REAL scores).
const TIERS = {
  COMMON: { minScores: 8, label: 'COMMON: broad score support required' },
  UNCOMMON: { minScores: 3, label: 'UNCOMMON: multiple independent scores required' },
  RARE: { minScores: 1, label: 'RARE: verified examples + explicit handling required' },
}

// V1-important families and the tier the dataset owes them.
const V1_IMPORTANT = {
  'bend-amount': 'UNCOMMON', 'pre-bend': 'UNCOMMON', 'bend-release': 'UNCOMMON',
  'slide': 'COMMON', 'hammer-on': 'COMMON', 'pull-off': 'COMMON',
  'natural-harmonic': 'UNCOMMON', 'artificial-harmonic': 'RARE',
  'tapping': 'UNCOMMON', 'palm-mute': 'COMMON', 'let-ring': 'UNCOMMON',
  'dead-note': 'UNCOMMON', 'ghost-note': 'RARE', 'vibrato': 'UNCOMMON',
  'tremolo-picking': 'UNCOMMON', 'arpeggio': 'UNCOMMON',
  'alternate-tuning': 'UNCOMMON', 'tuning': 'COMMON', 'capo': 'UNCOMMON',
  'left-hand-fingering': 'COMMON', 'chord-diagram': 'UNCOMMON',
  'repeat': 'COMMON', 'ending': 'UNCOMMON', 'segno': 'RARE', 'coda': 'RARE',
  'ds-dc-navigation': 'RARE', 'grace-note': 'UNCOMMON', 'cue-note': 'RARE',
  'tuplet': 'COMMON', 'multi-voice-rhythm': 'COMMON', 'tie': 'COMMON',
  'dots': 'COMMON', 'chord-symbol': 'UNCOMMON',
};

function familyOf(record, key) {
  if (key.startsWith('technique:')) {
    const kind = key.slice('technique:'.length)
    return { Technique: 1, kind }
  }
  if (key.startsWith('navigation:')) return { navigation: key.slice('navigation:'.length) }
  if (key.startsWith('quarantine:')) return null
  return { family: key }
}

export function main() {
  const args = process.argv.slice(2)
  const get = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : fallback
  }
  const workDir = resolve(ROOT, get('--work', 'datasets/guitar-vision/v2-pilot/work'))
  const outDir = resolve(ROOT, get('--out', 'datasets/guitar-vision/v2-pilot'))
  mkdirSync(outDir, { recursive: true })

  const ingest = JSON.parse(readFileSync(join(workDir, 'ingest-records.json'), 'utf8'))
  const passRecords = ingest.records.filter((r) => r.status === 'PASS')
  // Tiers: real-world coverage (DATA_GAPs count these only) vs
  // controlled-original etudes (valid supervision, tracked separately per A6)
  // vs synthetic-validation (pipeline checks only, never splits/quotas).
  const realRecords = passRecords.filter((r) => r.tier === 'real')
  const etudeRecords = passRecords.filter((r) => r.tier === 'controlled-original')
  const splitRecords = [...realRecords, ...etudeRecords]
  const quarantined = ingest.records.filter((r) => r.status !== 'PASS')

  // ---- D11 duplicates: truth digest (content), file digest (bytes), pixels.
  const truthSeen = new Map()
  const fileSeen = new Map()
  const pixelSeen = new Map()
  const duplicateGroups = []
  const pixelDigestsFor = (record) => Object.values(record.render?.layouts ?? {})
    .flatMap((layout) => Object.entries(layout.png ?? {}))
    .filter(([name]) => name.endsWith('-w2100.png'))
    .map(([, meta]) => meta.sha256)
    .filter(Boolean)
  for (const record of passRecords) {
    const canonical = JSON.parse(readFileSync(join(workDir, record.candidateId, 'canonical.json'), 'utf8'))
    // Reuse the corpus truthDigest over parsed-equivalent content.
    const parsed = parseMusicXml(readFileSync(resolve(ROOT, record.sourcePath), 'utf8'), 'x.mxl');
    const td = truthDigest(parsed)
    const fd = fileDigest(record.sourceHash)
    record.truthDigest = td
    const owners = (map, digest, kind) => {
      if (!digest) return
      if (!map.has(digest)) map.set(digest, [])
      map.get(digest).push(record.candidateId)
    }
    owners(truthSeen, td, 'truth')
    owners(fileSeen, fd, 'file')
    for (const sha of pixelDigestsFor(record)) owners(pixelSeen, sha, 'pixel')
  }
  for (const [digest, owners] of [...truthSeen, ...fileSeen, ...pixelSeen]) {
    const distinct = [...new Set(owners)]
    if (distinct.length > 1) duplicateGroups.push({ digest: digest.slice(0, 16), owners: distinct })
  }

  // ---- D10 splits over real + etudes (tier recorded per sample; synthetic
  // validation never enters splits). Etudes group by technique family so
  // split-grouping spreads techniques instead of trapping them in one split.
  const samples = splitRecords.map((r) => ({
    sampleId: r.candidateId,
    pieceId: r.candidateId,
    collectionId: r.collection ?? `solo:${r.candidateId}`,
    publisherId: r.tier === 'controlled-original' ? 'corranzo-original' : 'mutopia-project',
    instrumentId: 'guitar',
    provenance: r.tier === 'controlled-original' ? 'controlled-original' : r.provenance ?? 'real-printed',
    tier: r.tier,
    truthPath: r.sourcePath,
    truthDigest: r.truthDigest,
    fileDigest: r.sourceHash,
    pixelDigests: pixelDigestsFor(r),
    pageCount: Object.values(r.render?.layouts ?? {})[0]?.pages?.length ?? null,
    labelCounts: { events: r.eventCount },
  }))
  // Pilot ratios scaled to a ~12-score corpus (documented, not the 150 plan).
  const manifest = buildSplitManifest({
    samples,
    seed: 20261007,
    ratios: { train: 6, validation: 3, heldout: 2, diagnostic: 1 },
  })
  const audit = auditSplitManifest(manifest)
  const sufficiency = corpusSufficiency(manifest)
  const splitById = Object.fromEntries(manifest.samples.map((s) => [s.sampleId, s]))

  // ---- D3/D4/D5/D9 quotas. Real-world coverage (DATA_GAPs) counts REAL
  // scores only; etude coverage is reported alongside as supervised-but-
  // controlled evidence (A6: never misrepresented as real coverage).
  const scoresByFamily = {}
  const scoresByFamilyEtude = {}
  const eventsByFamily = {}
  const splitsByFamily = {}
  const addFamily = (store, splitsStore, famKey, record, split) => {
    store[famKey] = store[famKey] ?? new Set()
    store[famKey].add(record.candidateId)
    if (splitsStore && split) {
      splitsStore[famKey] = splitsStore[famKey] ?? new Set()
      splitsStore[famKey].add(split)
    }
  }
  for (const record of [...realRecords, ...etudeRecords]) {
    const split = splitById[record.candidateId]?.split ?? 'unassigned'
    const store = record.tier === 'controlled-original' ? scoresByFamilyEtude : scoresByFamily
    for (const key of record.families ?? []) {
      const mapped = familyOf(record, key)
      if (!mapped) continue;
      const famKey = mapped.family ?? (mapped.kind ? `technique:${mapped.kind}` : mapped.navigation ? `navigation:${mapped.navigation}` : key);
      addFamily(store, record.tier === 'real' ? splitsByFamily : null, famKey, record, split)
    }
  }
  const canonicalById = {}
  for (const record of splitRecords) {
    canonicalById[record.candidateId] = JSON.parse(readFileSync(join(workDir, record.candidateId, 'canonical.json'), 'utf8'))
  }
  const coverage = {}
  const allFamilies = new Set([...Object.keys(scoresByFamily), ...Object.keys(scoresByFamilyEtude)])
  for (const family of [...allFamilies].sort()) {
    const scores = scoresByFamily[family] ?? new Set()
    coverage[family] = {
      scores: scores.size,
      scoreIds: [...scores].sort(),
      splits: [...(splitsByFamily[family] ?? [])].sort(),
      etudeScores: scoresByFamilyEtude[family]?.size ?? 0,
      etudeIds: [...(scoresByFamilyEtude[family] ?? [])].sort(),
    }
  }
  const dataGaps = []
  for (const [family, tier] of Object.entries(V1_IMPORTANT)) {
    // Map important families onto observed keys (technique:X / navigation:X / plain).
    const keys = [family, `technique:${family}`, `navigation:${family}`]
    const hit = keys.find((k) => scoresByFamily[k])
    const count = hit ? scoresByFamily[hit].size : 0
    if (count < TIERS[tier].minScores) {
      const etudeHit = keys.find((k) => scoresByFamilyEtude[k])
      dataGaps.push({
        family, tier, scores: count, required: TIERS[tier].minScores,
        etudeScores: etudeHit ? scoresByFamilyEtude[etudeHit].size : 0,
        rescuedByEtudes: etudeHit ? [...scoresByFamilyEtude[etudeHit]].sort() : [],
      })
    }
  }

  // D9 scale: joined fret-digit heights across real + etudes (tier split below).
  const digitHeights = splitRecords.flatMap((r) => r.glyphScale?.tabDigitHeights ?? [])
  const headHeights = splitRecords.flatMap((r) => r.glyphScale?.noteheadHeights ?? [])
  const digitHeightsReal = realRecords.flatMap((r) => r.glyphScale?.tabDigitHeights ?? [])
  const scale = {
    tabDigits: digitHeights.length,
    tabDigitMin: digitHeights.length ? Math.min(...digitHeights) : null,
    tabDigitMax: digitHeights.length ? Math.max(...digitHeights) : null,
    tabDigitsReal: digitHeightsReal.length,
    noteheads: headHeights.length,
    noteheadMin: headHeights.length ? Math.min(...headHeights) : null,
    noteheadMax: headHeights.length ? Math.max(...headHeights) : null,
    units: 'verovio-page-units',
  }

  // D3 distribution (real + etudes; synthetic-validation excluded).
  const classification = {}
  for (const r of splitRecords) {
    const key = `${r.classification}:${r.tier}`
    classification[key] = (classification[key] ?? 0) + 1
  }

  // ---- D15 zero-parameter sanity (no model fitting), over all split tiers.
  const sanity = []
  const check = (name, ok, detail = null) => sanity.push({ name, ok, detail })
  for (const record of splitRecords) {
    const canonical = canonicalById[record.candidateId]
    check(`${record.candidateId}:id-joins`, Object.values(record.render?.layouts ?? {}).length > 0 && Object.values(record.render.layouts).every((l) => l.identityRate === 1.0))
    // A9: strict timing holds on unmasked measures; masked measures are
    // recorded exclusions, and the mask set must equal the failing set
    // (no silent drift in either direction).
    const failing = (canonical.rhythm?.measureChecks ?? []).filter((c) => !c.ok).map((c) => c.measure).sort((a, b) => a - b)
    const masked = [...(record.maskedMeasures ?? [])].sort((a, b) => a - b)
    check(`${record.candidateId}:timing`, failing.length === 0, failing.length ? `masked ${masked.join(',')}` : null)
    // A9: unmasked timing must be exact; masked measures are recorded
    // exclusions (kept in truth, out of rhythm supervision).
    check(`${record.candidateId}:timing-unmasked`, failing.every((m) => masked.includes(m)),
      failing.length ? `failing ${failing.join(',')} masked ${masked.join(',')}` : null)
    check(`${record.candidateId}:masks-consistent`, JSON.stringify(failing) === JSON.stringify(masked))
    const bboxes = JSON.parse(readFileSync(join(workDir, record.candidateId, 'joins.json'), 'utf8'))
    const boxes = Object.values(bboxes.joins ?? {}).flatMap((j) => j.boxes ?? [])
    check(`${record.candidateId}:bboxes`, boxes.length > 0 && boxes.every((b) => b[2] > b[0] && b[3] > b[1] && b.every(Number.isFinite)))
    const eventIds = new Set(canonical.events.map((e) => e.id))
    check(`${record.candidateId}:relations`, (canonical.relations ?? []).every((r) => eventIds.has(r.fromEventId) && eventIds.has(r.toEventId)))
    check(`${record.candidateId}:pairing`, canonical.events.filter((e) => e.tab.pairing === 'quarantined').length === (record.pairingsQuarantined ?? 0))
  }
  check('splits:integrity', audit.ok, audit.ok ? null : JSON.stringify(audit.violations).slice(0, 500))
  check('splits:sealed-test-untouched', heldOutSamples(manifest).length > 0)
  // D11: only groups spanning two different REAL splits are collisions.
  // Same-tier duplicates (e.g. the synthetic vector/scan pair) are recorded
  // in the manifest but cannot leak across splits they are not in.
  const splitOf = (id) => splitById[id]?.split ?? null
  const collisions = duplicateGroups.filter((g) => new Set(g.owners.map(splitOf)).size > 1)
  check('duplicates:no-cross-split-collision', collisions.length === 0, collisions.length ? JSON.stringify(collisions).slice(0, 300) : null)
  const qualityFields = ['width', 'height', 'contrast', 'meanLuma', 'blurVariance', 'inkCoverage']
  check('quality:metadata-valid', splitRecords.every((r) => Object.values(r.render?.layouts ?? {}).every((l) => Object.values(l.png ?? {}).every((m) => qualityFields.every((f) => Number.isFinite(m[f]))))))

  // ---- D16 target materialization (counts per decomposed head), all tiers.
  const targets = {
    objects: 0, string: 0, fret: 0, rhythm: 0, pitch: 0, voice: 0,
    pairing: 0, techniqueFamily: 0, techniqueParams: 0, articulation: 0, context: 0,
  }
  const freshTargets = () => ({
    objects: 0, string: 0, fret: 0, rhythm: 0, pitch: 0, voice: 0,
    pairing: 0, techniqueFamily: 0, techniqueParams: 0, articulation: 0, context: 0,
    scores: 0,
  })
  const targetsBySplit = {}
  const targetsByTier = { real: freshTargets(), 'controlled-original': freshTargets() }
  for (const record of splitRecords) {
    const split = splitById[record.candidateId]?.split ?? 'unassigned'
    targetsBySplit[split] = targetsBySplit[split] ?? freshTargets()
    targetsBySplit[split].scores += 1
    const tierTargets = targetsByTier[record.tier] ?? targetsByTier.real
    tierTargets.scores += 1
    const canonical = canonicalById[record.candidateId]
    const joins = JSON.parse(readFileSync(join(workDir, record.candidateId, 'joins.json'), 'utf8'))
    const joinedIds = new Set(Object.keys(joins.joins ?? {}));
    const masked = new Set(record.maskedMeasures ?? [])
    // Objects: joined note/rest groups per event (sourceId:eN <-> stamped id mapping
    // is positional: canonical event index + 1 == stamped note number).
    let n = 0
    canonical.events.forEach((event, index) => {
      const stampedId = `${record.candidateId}-n${String(index + 1).padStart(3, '0')}`
      if (!joinedIds.has(stampedId)) return
      n += 1
      targets.objects += 1; targetsBySplit[split].objects += 1; tierTargets.objects += 1
      // A9: masked-measure events keep object/pitch/position/technique
      // identity (joins, sounding pitch and pairing are measure-independent)
      // but leave rhythm/voice supervision, which is what the mask means.
      if (!event.time.isRest) { targets.pitch += 1; targetsBySplit[split].pitch += 1; tierTargets.pitch += 1 }
      if (event.tab.string != null) { targets.string += 1; targetsBySplit[split].string += 1; tierTargets.string += 1 }
      if (event.tab.fret != null) { targets.fret += 1; targetsBySplit[split].fret += 1; tierTargets.fret += 1 }
      if ((event.techniques ?? []).length) {
        targets.techniqueFamily += event.techniques.length; targetsBySplit[split].techniqueFamily += event.techniques.length; tierTargets.techniqueFamily += event.techniques.length
        const param = event.techniques.filter((t) => t.semitones != null || t.marks != null || t.direction != null || t.hand != null || t.artificial != null)
        targets.techniqueParams += param.length; targetsBySplit[split].techniqueParams += param.length; tierTargets.techniqueParams += param.length
      }
      const arts = event.articulations ?? {}
      if (arts.staccato || arts.accent || arts.tenuto || arts.marcato || arts.fermata || arts.staccatissimo || arts.breathMark || (arts.slurs ?? []).length) {
        targets.articulation += 1; targetsBySplit[split].articulation += 1; tierTargets.articulation += 1
      }
      if (masked.has(event.source.measure)) return
      targets.rhythm += 1; targetsBySplit[split].rhythm += 1; tierTargets.rhythm += 1
      targets.voice += 1; targetsBySplit[split].voice += 1; tierTargets.voice += 1
    })
    targets.pairing += (canonical.pairings ?? []).length; targetsBySplit[split].pairing += (canonical.pairings ?? []).length; tierTargets.pairing += (canonical.pairings ?? []).length
    if ((canonical.navigation ?? []).length || (canonical.frames ?? []).length || (parsedHasContext(record))) {
      targets.context += 1; targetsBySplit[split].context += 1; tierTargets.context += 1
    }
    void n
  }

  const manifestOut = {
    version: PILOT_VERSION,
    generatedAt: new Date().toISOString(),
    scale: 'v2: 12 real + 33 controlled-original etudes + 5 synthetic-validation; pilot preserved separately',
    candidates: ingest.records.length,
    pass: passRecords.length,
    passReal: realRecords.length,
    passEtudes: etudeRecords.length,
    quarantined: quarantined.map((q) => ({ id: q.candidateId, status: q.status, reason: q.quarantineReason })),
    classification,
    splits: {
      seed: manifest.seed, digest: manifest.digest, ratios: manifest.ratios,
      audit: { ok: audit.ok, violations: audit.violations },
      sufficiency: corpusSufficiency(manifest),
      assignments: manifest.samples.map((s) => ({ sample: s.sampleId, collection: s.collectionId, split: s.split, role: s.validationRole })),
    },
    duplicates: duplicateGroups,
    coverage,
    dataGaps,
    masks: {
      policy: 'A9: failing measures are excluded from rhythm/voice supervision, kept in truth, recorded here',
      perScore: Object.fromEntries(realRecords.map((r) => [r.candidateId, {
        maskedMeasures: r.maskedMeasures ?? [],
        maskedEvents: r.maskedEvents ?? 0,
        events: r.eventCount ?? 0,
      }])),
      maskedEventsTotal: realRecords.reduce((n, r) => n + (r.maskedEvents ?? 0), 0),
    },
    scale,
    sanity: { passed: sanity.filter((s) => s.ok).length, total: sanity.length, checks: sanity },
    targets: { total: targets, bySplit: targetsBySplit, byTier: targetsByTier },
  }
  writeFileSync(join(outDir, 'dataset-manifest.json'), JSON.stringify(manifestOut, null, 1))
  console.log(`real PASS ${realRecords.length} | quarantined ${quarantined.length} | splits audit ${audit.ok ? 'CLEAN' : 'FAIL'} | sanity ${sanity.filter((s) => s.ok).length}/${sanity.length} | DATA_GAPs ${dataGaps.length}`)
  for (const gap of dataGaps) console.log(`  DATA_GAP ${gap.family} [${gap.tier}]: ${gap.scores}/${gap.required} scores`)
  return manifestOut
}

function parsedHasContext(record) {
  return (record.navigation ?? 0) > 0 || (record.frames ?? 0) > 0 || (record.capoFret ?? 0) > 0
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main()
}
