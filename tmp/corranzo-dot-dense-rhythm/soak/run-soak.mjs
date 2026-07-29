#!/usr/bin/env node
/**
 * 10-piece real-world soak with DEV rhythm provenance enabled.
 * No production recognition changes — provenance only.
 *
 * Usage: node tmp/corranzo-dot-dense-rhythm/soak/run-soak.mjs [id]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { runPdfOmrPipeline } from '../../../src/features/omr/runPdfOmrPipeline.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../../../src/features/omr/omrDiagnosticFlags.js'
import { buildOmrProvenancePackage } from '../../../src/features/omr/omrDevTools.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../../scripts/lib/renderPdfPages.mjs'

const ROOT = process.cwd()
const DOWNLOADS = join(homedir(), 'Downloads')
const OUT = join(ROOT, 'tmp/corranzo-dot-dense-rhythm/soak')
const FIXTURES = join(ROOT, 'public/fixtures')

const SOURCES = [
  {
    id: 'minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    maxPages: 2,
    scoreClass: 'beginner-piano-arr',
  },
  {
    id: 'evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    maxPages: 2,
    scoreClass: 'anime-piano-arr',
  },
  {
    id: 'gymnopedie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    maxPages: 2,
    scoreClass: 'sparse-classical-piano',
  },
  {
    id: 'hungarian',
    pdf: join(DOWNLOADS, 'hungarian-dance-no5.pdf'),
    maxPages: 2,
    scoreClass: 'dense-classical-piano',
    fallback: join(FIXTURES, 'hungarian-dance-no5/hungarian-dance-no5.pdf'),
  },
  {
    id: 'fantaisie',
    pdf: join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.pdf'),
    maxPages: 2,
    scoreClass: 'virtuosic-classical-piano',
  },
  {
    id: 'campanella-etude',
    pdf: join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'),
    maxPages: 2,
    scoreClass: 'dense-virtuosic-piano',
  },
  {
    id: 'carol',
    pdf: join(DOWNLOADS, 'carol-of-the-bells.pdf'),
    maxPages: 2,
    scoreClass: 'holiday-piano-arr',
  },
  {
    id: 'moonlight-3',
    pdf: join(DOWNLOADS, 'sonate-no-14-moonlight-3rd-movement.pdf'),
    maxPages: 2,
    scoreClass: 'dense-classical-piano',
  },
  {
    id: 'wet-hands',
    pdf: join(DOWNLOADS, 'wet-hands-minecraft.pdf'),
    maxPages: 2,
    scoreClass: 'beginner-piano-arr',
  },
  {
    id: 'campanella-grandes',
    pdf: join(
      DOWNLOADS,
      'la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf',
    ),
    maxPages: 2,
    scoreClass: 'dense-virtuosic-piano',
    fallback: join(
      FIXTURES,
      'la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf',
    ),
  },
]

function resolvePdf(source) {
  if (existsSync(source.pdf)) {
    return source.pdf
  }
  if (source.fallback && existsSync(source.fallback)) {
    return source.fallback
  }
  return null
}

function countDurationTypes(musicXml = '') {
  const types = {}
  const re = /<type(?:\s[^>]*)?>([^<]+)<\/type>/g
  let match
  while ((match = re.exec(musicXml))) {
    const key = match[1].trim()
    types[key] = (types[key] ?? 0) + 1
  }
  const dots = (musicXml.match(/<dot\b/g) ?? []).length
  const beams = (musicXml.match(/<beam\b/g) ?? []).length
  const ties = (musicXml.match(/<tie\b/g) ?? []).length
  return { types, dots, beams, ties }
}

function pathDensityLabel(diagnostics, noteCount, measureCount) {
  const pages = diagnostics?.pagesWithSystems
    ?? (Array.isArray(diagnostics?.pages) ? diagnostics.pages.length : diagnostics?.pages)
    ?? null
  const systems = diagnostics?.systems ?? null
  const measures = measureCount ?? diagnostics?.measures ?? null
  const notes = noteCount
    ?? diagnostics?.noteMatching?.vectorNoteCount
    ?? diagnostics?.noteMatching?.totalNotes
    ?? null
  const difficulty =
    diagnostics?.difficulty?.level
    ?? (typeof diagnostics?.difficulty === 'string' ? diagnostics.difficulty : null)
  let density = 'unknown'
  if (Number.isFinite(notes) && Number.isFinite(measures) && measures > 0) {
    const perMeasure = notes / measures
    if (perMeasure >= 10) density = 'high'
    else if (perMeasure >= 5) density = 'medium'
    else density = 'low'
  }
  return {
    rendering: 'vector-preferred',
    pathDensity: density,
    pages,
    systems,
    measures,
    noteEstimate: notes,
    notesPerMeasure:
      Number.isFinite(notes) && Number.isFinite(measures) && measures > 0
        ? Number((notes / measures).toFixed(2))
        : null,
    difficulty,
  }
}

function classifyFailureFromProvenance(provenance, durationStats) {
  const notes = provenance?.noteDurations ?? []
  const dots = provenance?.dotCandidates ?? []
  const beams = provenance?.beamCandidates ?? []

  const rhythmDots = dots.filter((d) => {
    const text = d.glyph?.text ?? ''
    return text === '\ue1e7'
  })
  const dyFail = dots.filter((d) => d.rejectionReason === 'dyFail').length
  const unassignedRhythmDots = rhythmDots.filter((d) => !d.finalOwner).length
  const packing = notes.filter((n) => n.measurePackingOverride).length
  const coalesce = notes.filter((n) => n.chordCoalesceOverride).length
  const beamOverwrite = notes.filter((n) => n.beamDurationOverwrittenLater).length
  const beamRejectedHard = beams.filter(
    (b) =>
      b.rejectionReason === 'below-beam-confidence-gate' ||
      b.rejectionReason === 'no-attached-beams',
  ).length
  const beamDerivedLost = notes.filter((n) => {
    if (!n.beamDerivedType || !n.finalSelectedType) return false
    const finalBase = String(n.finalSelectedType).replace(/\.$/, '')
    return (
      finalBase !== n.beamDerivedType &&
      (n.beamDerivedType === 'eighth' || n.beamDerivedType === 'sixteenth') &&
      (finalBase === 'quarter' || finalBase === 'half' || finalBase === 'whole')
    )
  }).length

  const glyphOpenLost = notes.filter((n) => {
    const glyph = n.originalGlyphDerivedType
    if (glyph !== 'whole' && glyph !== 'half') return false
    const finalBase = String(n.finalSelectedType ?? '').replace(/\.$/, '')
    return finalBase !== glyph
  }).length

  // Prefer RCA-meaningful categories over raw probe floods for the headline.
  // Unassigned SMuFL dots are retained in counts but down-weighted — many PDFs
  // reuse U+E1E7 liberally and flood the collector.
  const ranked = [
    { id: 'dot-dy-near-miss', count: dyFail, weight: 5 },
    { id: 'open-glyph-packing-override', count: glyphOpenLost, weight: 5 },
    { id: 'beam-short-lost-to-longer', count: beamDerivedLost, weight: 4 },
    { id: 'beam-duration-overwritten', count: beamOverwrite, weight: 4 },
    { id: 'measure-packing-override', count: packing, weight: 2 },
    { id: 'chord-coalesce-override', count: coalesce, weight: 2 },
    { id: 'beam-confidence-rejected', count: beamRejectedHard, weight: 0.5 },
    { id: 'unassigned-rhythm-dots', count: unassignedRhythmDots, weight: 0.02 },
  ]
    .map((entry) => ({ ...entry, score: entry.count * entry.weight }))
    .sort((a, b) => b.score - a.score || b.count - a.count)

  const top = ranked[0]?.count > 0 ? ranked[0] : { id: 'none-dominant', count: 0 }

  // Minecraft RCA: dy near-miss cluster + open glyphs collapsed after extract.
  // Evangelion shares the dy bucket but not the open-glyph collapse — require both.
  const matchesMinecraftRootCause = dyFail >= 12 && glyphOpenLost >= 12

  // Hungarian RCA: beamed short evidence present, final duration longer (quarter+).
  const matchesHungarianRootCause = beamDerivedLost >= 50

  return {
    mostFrequentFailureCategory: top.id,
    categoryCounts: Object.fromEntries(ranked.map((c) => [c.id, c.count])),
    matchesMinecraftRootCause: Boolean(matchesMinecraftRootCause),
    matchesHungarianRootCause: Boolean(matchesHungarianRootCause),
  }
}

function estimateRecognitionQuality(result, durationStats, failure) {
  const noteCount = result.noteCount ?? 0
  const measures = result.diagnostics?.measures ?? 0
  const uncertain = result.uncertainMeasures ?? 0
  const confidence = result.overallConfidence ?? result.diagnostics?.overallConfidence ?? null
  let visible = 'fair'
  if (noteCount === 0) visible = 'poor'
  else if (failure.matchesMinecraftRootCause || failure.matchesHungarianRootCause) {
    visible = 'fair-with-known-rhythm-defects'
  } else if (
    (failure.categoryCounts?.['dot-dy-near-miss'] ?? 0) >= 8 ||
    (failure.categoryCounts?.['beam-short-lost-to-longer'] ?? 0) >= 15 ||
    (failure.categoryCounts?.['open-glyph-packing-override'] ?? 0) >= 8
  ) {
    visible = 'fair'
  } else if (confidence != null && confidence >= 0.75 && uncertain === 0) {
    visible = 'good'
  } else if (failure.mostFrequentFailureCategory === 'none-dominant') {
    visible = 'good'
  }

  let playback = 'unknown'
  if (noteCount === 0) playback = 'poor'
  else if (failure.matchesHungarianRootCause) playback = 'poor-short-notes-promoted'
  else if (failure.matchesMinecraftRootCause) playback = 'fair-missing-dots-opens'
  else if ((durationStats.beams ?? 0) > 20 || (durationStats.dots ?? 0) > 10) {
    playback = 'fair'
  } else {
    playback = 'acceptable-for-soak'
  }
  return {
    visibleRecognitionQuality: visible,
    playbackQuality: playback,
    confidence,
    uncertainMeasures: uncertain,
  }
}

async function runOne(source) {
  const pdfPath = resolvePdf(source)
  if (!pdfPath) {
    return {
      id: source.id,
      scoreClass: source.scoreClass,
      error: 'pdf-missing',
      pdf: source.pdf,
    }
  }

  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    maxPages: source.maxPages,
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const result = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: source.maxPages,
    instrumentId: 'piano',
    title: basename(pdfPath).replace(/\.pdf$/i, ''),
  })

  const provenance = result.diagnostics?.rhythmProvenance ?? null
  const durationStats = countDurationTypes(result.musicXml ?? '')
  const density = pathDensityLabel(
    result.diagnostics,
    result.noteCount,
    result.measureCount ?? result.diagnostics?.measures,
  )
  const failure = classifyFailureFromProvenance(provenance, durationStats)
  const quality = estimateRecognitionQuality(result, durationStats, failure)

  const packageBundle = buildOmrProvenancePackage({
    diagnostics: result.diagnostics,
    runMeta: {
      id: source.id,
      noteCount: result.noteCount,
      measureCount: result.measureCount ?? result.diagnostics?.measures,
      overallConfidence: result.overallConfidence,
      maxPages: source.maxPages,
      pdfFileName: basename(pdfPath),
    },
    activeScore: {
      scoreId: source.id,
      musicXml: { omrMeta: { pdfFileName: basename(pdfPath), noteCount: result.noteCount } },
    },
  })

  const provenancePath = join(OUT, `${source.id}-provenance.json`)
  await writeFile(provenancePath, JSON.stringify(packageBundle, null, 2))

  return {
    id: source.id,
    scoreClass: source.scoreClass,
    pdf: basename(pdfPath),
    maxPages: source.maxPages,
    noteCount: result.noteCount ?? 0,
    measureCount: result.measureCount ?? result.diagnostics?.measures ?? 0,
    ...density,
    ...quality,
    durationStats,
    provenanceSummary: provenance
      ? {
          noteDurationCount: provenance.noteDurationCount,
          dotCandidateCount: provenance.dotCandidateCount,
          beamCandidateCount: provenance.beamCandidateCount,
          unassignedDots: provenance.unassignedDots,
          beamDurationOverwrittenLater: provenance.beamDurationOverwrittenLater,
          chordCoalesceOverrides: provenance.chordCoalesceOverrides,
          rejectedBeams: provenance.rejectedBeams,
        }
      : null,
    ...failure,
    provenanceFile: provenancePath,
    reopenPolicy:
      'Do not reopen Minecraft/Hungarian recognition until ≥2 unrelated scores share the same mechanism.',
  }
}

await mkdir(OUT, { recursive: true })
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)

const only = process.argv[2]
const selected = only ? SOURCES.filter((s) => s.id === only) : SOURCES
const records = []
for (const source of selected) {
  console.error(`soak: ${source.id}…`)
  const started = Date.now()
  try {
    const record = await runOne(source)
    record.elapsedMs = Date.now() - started
    records.push(record)
    console.error(
      `  ok notes=${record.noteCount} fail=${record.mostFrequentFailureCategory} mc=${record.matchesMinecraftRootCause} hu=${record.matchesHungarianRootCause} (${record.elapsedMs}ms)`,
    )
  } catch (error) {
    records.push({
      id: source.id,
      scoreClass: source.scoreClass,
      error: String(error?.stack ?? error),
      elapsedMs: Date.now() - started,
    })
    console.error(`  FAIL ${error?.message ?? error}`)
  }
}

setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, false)

const report = {
  version: 1,
  kind: 'corranzo-dot-dense-rhythm-soak',
  baselineCommit: '541f607e230611e37f377f4a106f42ab57822c65',
  generatedAt: new Date().toISOString(),
  provenanceEnabled: true,
  productionRecognitionChanges: false,
  policy:
    'RCA accepted; phases reverted. No Minecraft/Hungarian fixes until ≥2 unrelated scores share a mechanism.',
  records,
  sharedMechanismWatch: {
    minecraftLikeIds: records.filter((r) => r.matchesMinecraftRootCause).map((r) => r.id),
    hungarianLikeIds: records.filter((r) => r.matchesHungarianRootCause).map((r) => r.id),
    minecraftLikeCount: records.filter((r) => r.matchesMinecraftRootCause).length,
    hungarianLikeCount: records.filter((r) => r.matchesHungarianRootCause).length,
    reopenMinecraft:
      records.filter((r) => r.matchesMinecraftRootCause && r.id !== 'minecraft').length >= 2,
    reopenHungarian:
      records.filter((r) => r.matchesHungarianRootCause && r.id !== 'hungarian').length >= 2,
    note: 'Reopen only when ≥2 unrelated scores share the same RCA mechanism (excluding the original piece).',
  },
}

await writeFile(join(OUT, 'SOAK_RECORDS.json'), JSON.stringify(report, null, 2))

const md = [
  '# Dot/Dense Rhythm — 10-piece soak',
  '',
  `Generated: ${report.generatedAt}`,
  `Baseline: \`${report.baselineCommit}\``,
  '',
  'Production recognition unchanged. DEV provenance on for diagnostics only.',
  '',
  '| Score | Class | Density | Recognition | Playback | Top failure | MC-like | HU-like |',
  '|---|---|---|---|---|---|---|---|',
  ...records.map((r) => {
    if (r.error) {
      return `| ${r.id} | ${r.scoreClass} | — | error | — | ${r.error.slice(0, 40)} | — | — |`
    }
    return `| ${r.id} | ${r.scoreClass} | ${r.pathDensity} | ${r.visibleRecognitionQuality} | ${r.playbackQuality} | ${r.mostFrequentFailureCategory} | ${r.matchesMinecraftRootCause} | ${r.matchesHungarianRootCause} |`
  }),
  '',
  '## Policy',
  '',
  report.policy,
  '',
  `Minecraft-like hits: **${report.sharedMechanismWatch.minecraftLikeCount}** (${report.sharedMechanismWatch.minecraftLikeIds.join(', ') || 'none'})`,
  `Hungarian-like hits: **${report.sharedMechanismWatch.hungarianLikeCount}** (${report.sharedMechanismWatch.hungarianLikeIds.join(', ') || 'none'})`,
  `Reopen Minecraft? **${report.sharedMechanismWatch.reopenMinecraft}**`,
  `Reopen Hungarian? **${report.sharedMechanismWatch.reopenHungarian}**`,
  '',
  'Per-score provenance JSON: `*-provenance.json`.',
].join('\n')

await writeFile(join(OUT, 'SOAK_REPORT.md'), md)
console.log(JSON.stringify({ wrote: OUT, count: records.length }, null, 2))
