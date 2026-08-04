#!/usr/bin/env node
/**
 * Baseline audit for OMR acceptance-gate sprint.
 * Captures full decision features for PASSING / FALSE REJECT / TRUE REJECT controls.
 * Does not modify recognition.
 */
import { access, readFile, writeFile, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { assessOmrDifficulty } from '../../src/features/omr/assessOmrDifficulty.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-acceptance-gate')
const DOWNLOADS = join(process.env.HOME, 'Downloads')

const CONTROLS = [
  {
    id: 'brahms-lullaby',
    role: 'PASSING',
    pdf: join(ROOT, 'public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf'),
  },
  {
    id: 'evangelion',
    role: 'PASSING',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    optional: true,
  },
  {
    id: 'guitar-paired-scan',
    role: 'PASSING',
    pdf: join(ROOT, 'benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.pdf'),
  },
  {
    id: 'guitar-techniques-tab',
    role: 'PASSING',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/guitar-techniques-paired-vector/guitar-techniques-paired-vector.pdf',
    ),
    instrument: 'guitar',
  },
  {
    id: 'iris-out',
    role: 'PASSING',
    pdf: join(DOWNLOADS, 'iris-out-piano-arragement.pdf'),
    optional: true,
    maxPages: 2,
  },
  {
    id: 'bach-chorale-bwv259',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-bach-chorale-bwv259/piano-bach-chorale-bwv259.pdf',
    ),
  },
  {
    id: 'turkish-march',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-mozart-turkish-march/piano-mozart-turkish-march.pdf',
    ),
    maxPages: 5,
  },
  {
    id: 'fur-elise',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.pdf',
    ),
  },
  {
    id: 'handel-gavotte',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-handel-gavotte/piano-handel-gavotte.pdf',
    ),
  },
  {
    id: 'demo-minuet',
    role: 'FALSE_REJECT',
    pdf: join(ROOT, 'public/fixtures/demo-minuet-in-g.pdf'),
  },
  {
    id: 'chopin-mazurka',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'public/fixtures/practice-library/piano-chopin-mazurka-op6-1/piano-chopin-mazurka-op6-1.pdf',
    ),
  },
  {
    id: 'pathetique',
    role: 'FALSE_REJECT',
    pdf: join(
      ROOT,
      'benchmarks/omr-stress/beethoven-pathetique-mutopia/beethoven-pathetique-mutopia.pdf',
    ),
    maxPages: 4,
  },
  {
    id: 'twinkle-1880-loc',
    role: 'TRUE_REJECT',
    pdf: join(ROOT, 'benchmarks/omr-stress/twinkle-1880-loc/twinkle-1880-loc-music-p2.pdf'),
  },
]

async function exists(path) {
  try {
    await access(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

function pickFeatures({ result, error, pageCount }) {
  const d = result?.diagnostics ?? error?.diagnostics ?? {}
  const difficulty = result?.diagnostics?.difficulty ?? error?.difficulty ?? d.difficulty
  const layout = d.layoutConsistency ?? null
  const noteCount = result?.noteCount ?? d.notes ?? 0
  const measureCount = result?.measureCount ?? d.measures ?? 0
  const pagesWithSystems = d.pagesWithSystems ?? 0
  const overallConfidence = result?.overallConfidence ?? d.overallConfidence ?? 0
  const uncertainMeasures = result?.uncertainMeasures ?? d.uncertainMeasures ?? 0
  const resolvedPageCount = pageCount || d.pageCount || d.pages?.length || 0
  const assessment = assessOmrDifficulty({
    overallConfidence,
    pagesWithSystems,
    pageCount: resolvedPageCount,
    noteCount,
    measureCount,
    uncertainMeasures,
    layoutConsistency: layout,
  })
  return {
    noteCount,
    measureCount,
    rests: d.rests ?? null,
    systems: d.systems ?? null,
    staves: d.staves ?? null,
    pageCount: resolvedPageCount,
    pagesWithSystems,
    overallConfidence,
    uncertainMeasures,
    notesPerMeasure: assessment.notesPerMeasure,
    systemCoverage: assessment.systemCoverage,
    uncertainRatio: assessment.uncertainRatio,
    layoutConsistency: layout
      ? {
          inconsistent: Boolean(layout.inconsistent),
          spread: layout.spread ?? null,
          warning: layout.warning ?? null,
        }
      : null,
    legacyOverallConfidence: d.legacyOverallConfidence ?? null,
    vectorPages: d.vectorPages ?? null,
    rasterPages: d.rasterPages ?? null,
    difficultyReasons: assessment.reasons,
    tooDifficult: assessment.tooDifficult,
    difficultyMessage: assessment.message,
    difficultyObject: difficulty ?? assessment,
  }
}

async function runOne(entry) {
  if (!(await exists(entry.pdf))) {
    return {
      id: entry.id,
      role: entry.role,
      skipped: Boolean(entry.optional),
      error: `missing pdf: ${entry.pdf}`,
    }
  }

  const t0 = Date.now()
  const rendered = await renderPdfToPages(entry.pdf, {
    rootDir: ROOT,
    maxPages: entry.maxPages ?? null,
  })
  const extractPageText = await makePdfTextExtractor(entry.pdf, { rootDir: ROOT })
  const pageCount = rendered.pages.length

  try {
    const result = await runPdfOmrPipeline(entry.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: pageCount,
      maxPages: entry.maxPages,
      instrumentId: entry.instrument ?? 'piano',
      title: entry.id,
    })
    const features = pickFeatures({ result, pageCount })
    return {
      id: entry.id,
      role: entry.role,
      pdf: entry.pdf,
      elapsedMs: Date.now() - t0,
      pageCount,
      outcome: 'ACCEPTED_BY_PIPELINE',
      features,
      overallConfidence: result.overallConfidence,
      noteCount: result.noteCount,
      measureCount: result.measureCount,
      uncertainMeasures: result.uncertainMeasures,
    }
  } catch (error) {
    const features = pickFeatures({ error, pageCount })
    return {
      id: entry.id,
      role: entry.role,
      pdf: entry.pdf,
      elapsedMs: Date.now() - t0,
      pageCount,
      outcome: 'REJECTED',
      failureMessage: error.message,
      failureCode: error.code ?? null,
      features,
      overallConfidence: features.overallConfidence,
      noteCount: features.noteCount,
      measureCount: features.measureCount,
      uncertainMeasures: features.uncertainMeasures,
    }
  }
}

await mkdir(OUT, { recursive: true })
const rows = []
for (const entry of CONTROLS) {
  process.stderr.write(`audit ${entry.id}...\n`)
  const row = await runOne(entry)
  rows.push(row)
  process.stderr.write(
    `  → ${row.outcome ?? (row.skipped ? 'SKIPPED' : 'ERROR')} notes=${row.noteCount} conf=${
      typeof row.overallConfidence === 'number' ? row.overallConfidence.toFixed(3) : row.overallConfidence
    } tooDifficult=${row.features?.tooDifficult} reasons=${row.features?.difficultyReasons?.join?.(
      '|',
    )}\n`,
  )
}

const summary = {
  generatedAt: new Date().toISOString(),
  firstFailingStage:
    'runPdfOmrPipelineBody → assessOmrDifficulty → hard reject after extraction',
  oldGateRules: {
    absoluteLowConfidence: 0.42,
    midConfidenceUncertain:
      'measureCount>=16 && uncertainRatio>0.6 && confidence<0.72 → LOW_CONFIDENCE → tooDifficult',
    midConfidenceDenseUncertain:
      'measureCount>=16 && notesPerMeasure>14 && uncertainRatio>0.5 → LOW_CONFIDENCE → tooDifficult',
    inconsistentLayout:
      'spread>4 && confidence<0.72 → INCONSISTENT_LAYOUT → tooDifficult when confidence<0.72',
    emptySparse: 'MANY_EMPTY_PAGES + SPARSE_NOTES → tooDifficult',
  },
  rows,
}
await writeFile(join(OUT, 'BASELINE_AUDIT.json'), JSON.stringify(summary, null, 2))
console.log(
  JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      role: r.role,
      outcome: r.outcome ?? (r.skipped ? 'SKIPPED' : 'ERROR'),
      notes: r.noteCount,
      measures: r.measureCount,
      conf: r.overallConfidence,
      npm: r.features?.notesPerMeasure,
      uncertainRatio: r.features?.uncertainRatio,
      systemCoverage: r.features?.systemCoverage,
      pagesWithSystems: r.features?.pagesWithSystems,
      tooDifficult: r.features?.tooDifficult,
      reasons: r.features?.difficultyReasons,
      layout: r.features?.layoutConsistency,
      failureCode: r.failureCode ?? null,
    })),
    null,
    2,
  ),
)
