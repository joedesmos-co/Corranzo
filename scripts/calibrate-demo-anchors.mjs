/**
 * Reusable demo bundled-anchor calibration for Corranzo.
 *
 * Input: PDF + MusicXML metadata (or a hand-supplied system/barline table).
 * Output: anchors JSON compatible with public/fixtures/*.anchors.json.
 *
 * Usage:
 *   node scripts/calibrate-demo-anchors.mjs --validate-minuet
 *   node scripts/calibrate-demo-anchors.mjs --manual-systems systems.json --piece-id foo --out out.json
 *   node scripts/calibrate-demo-anchors.mjs --pdf score.pdf --musicxml score.musicxml \
 *     --piece-id foo --counts 5,5,6,5,5,6 --out out.json
 *   node scripts/calibrate-demo-anchors.mjs --pdf score.pdf --musicxml score.musicxml \
 *     --out out.json --validate public/fixtures/demo-minuet-in-g.anchors.json
 *
 * See docs/demo-anchor-calibration.md
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { loadMusicXmlFile } from '../src/features/musicxml/loadMusicXmlFile.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  buildBundledAnchorsFromAutoAnchors,
  buildBundledAnchorsFromManualSystems,
  calibrateAnchorsFromDetection,
  compareBundledAnchorsToReference,
  formatCalibrationSummary,
  manualSystemsFromBundledPayload,
  repairHungarianDancePage4SupplementalAnchors,
  validateBundledAnchorPayload,
  CALIBRATION_SOURCE,
  PROMOTION_STATUS,
  DEMO_CALIBRATION_VALIDATE_TOLERANCES,
} from '../src/features/score-follow/demoAnchorCalibration.js'
import {
  buildCalibrationDiagnostics,
  buildHybridBundledPayload,
  calibrateAnchorsHybrid,
  formatCalibrationDiagnosticsText,
  serializeCalibrationDiagnostics,
} from '../src/features/score-follow/calibrationWorkflow.js'
import { renderPdfToPages, makeRenderPageCallback } from './lib/renderPdfPages.mjs'
import { FIXTURE_FILENAMES } from '../src/dev/fixturePaths.js'

const VALIDATE_TOLERANCES = DEMO_CALIBRATION_VALIDATE_TOLERANCES

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MINUET_REFERENCE = join(root, 'public/fixtures/demo-minuet-in-g.anchors.json')

function usage() {
  console.log(`Usage: node scripts/calibrate-demo-anchors.mjs [options]

Options:
  --pdf <path>                 PDF score (required for auto calibration)
  --musicxml <path>            MusicXML timing (required for auto calibration)
  --piece-id <id>              Piece id stored in output JSON
  --pdf-file <name>            PDF filename stored in output (default: basename of --pdf)
  --timing-file <name>         MusicXML filename stored in output
  --out <path>                 Write bundled anchors JSON
  --counts <n,n,...>           Forced per-system measure counts
  --manual-systems <path>      JSON array of manual system tables (see docs)
  --manual-barlines <path>     JSON map of systemIndex → normalised barline x positions
  --system-counts <path>       JSON map of systemIndex → measure count override (hybrid)
  --diagnose                   Print calibration diagnostics (source + system analysis)
  --report <path>              Write diagnostics JSON report
  --strict                     Strict calibration (no count reconciliation; legacy behaviour)
  --export-preview             Export per-measure anchors from auto-setup preview (playable x)
  --no-refuse                  Allow hybrid reconcile even on severe source mismatch
  --auto                       Run PDF pixel pipeline (default when --pdf is set)
  --validate-minuet            Validate against bundled Minuet anchors (round-trip by default)
  --validate <path>            Compare generated output to a reference anchors JSON
  --round-trip                 With --validate-minuet: rebuild from reference manual table
  --help                       Show this help

Examples:
  node scripts/calibrate-demo-anchors.mjs --validate-minuet
  node scripts/calibrate-demo-anchors.mjs --pdf score.pdf --musicxml score.musicxml \\
    --piece-id turkish-march --counts 8,8,8 --out public/fixtures/demo-turkish-march.anchors.json
`)
}

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function parseCounts(raw) {
  if (!raw) return null
  return raw.split(',').map((part) => Number(part.trim()))
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function loadTimingMap(musicxmlPath) {
  const fileName = basename(musicxmlPath)
  if (musicxmlPath.toLowerCase().endsWith('.mxl')) {
    const file = new File([readFileSync(musicxmlPath)], fileName)
    const xml = await loadMusicXmlFile(file)
    return parseMusicXml(xml, fileName)
  }
  return parseMusicXml(readFileSync(musicxmlPath, 'utf8'), fileName)
}

function readReference(path) {
  return loadJson(path)
}

function buildFromManualSystems(systemsPath, meta) {
  const systems = loadJson(systemsPath)
  return buildBundledAnchorsFromManualSystems(systems, meta)
}

async function buildFromAutoPipeline({
  pdfPath,
  musicxmlPath,
  counts,
  manualBarlinesPath,
  manualCountOverridesPath,
  strict = false,
  refuseOnSourceMismatch = true,
  meta,
}) {
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`)
  }

  const timingMap = await loadTimingMap(musicxmlPath)
  const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir: root })
  const renderPage = makeRenderPageCallback(pages)

  const setup = await analyzeSemiAutoScoreSetup({
    pdfSource: pdfPath,
    numPages,
    timingMap,
    renderPage,
  })

  if (!setup.ok) {
    throw new Error(setup.message ?? 'Auto setup failed.')
  }

  const manualBarlinesBySystem = manualBarlinesPath ? loadJson(manualBarlinesPath) : null
  const manualCountOverrides = manualCountOverridesPath ? loadJson(manualCountOverridesPath) : null

  const calibration = strict
    ? calibrateAnchorsFromDetection({
        systemEntries: setup.preview.systemEntries,
        timingMap,
        forcedMeasureCounts: counts,
        manualBarlinesBySystem,
      })
    : calibrateAnchorsHybrid({
        systemEntries: setup.preview.systemEntries,
        timingMap,
        pdfPageCount: numPages,
        timingSource: musicxmlPath,
        forcedMeasureCounts: counts,
        manualCountOverrides,
        manualBarlinesBySystem,
        allowReconcile: !strict,
        refuseOnSourceMismatch,
      })

  const warnings = [...calibration.warnings]
  if (!calibration.ok) {
    if (calibration.refused) {
      warnings.push('Calibration refused due to source mismatch — see --diagnose output.')
    } else {
      warnings.push(
        calibration.allocationMode === 'unusable-auto-counts'
          ? 'Calibration incomplete — supply --counts, --system-counts, or --manual-barlines.'
          : `Expected ${timingMap.measures?.length ?? '?'} measure anchors, got ${calibration.supplemental?.length ?? 0}.`,
      )
    }
  }

  const calibrated =
    manualBarlinesBySystem != null || manualCountOverrides != null
      ? CALIBRATION_SOURCE.HYBRID
      : calibration.allocationMode?.includes('hybrid')
        ? CALIBRATION_SOURCE.HYBRID
        : CALIBRATION_SOURCE.AUTO

  const payload = strict
    ? buildBundledAnchorsFromAutoAnchors(calibration.supplemental, {
        ...meta,
        calibrated,
        warnings,
        alignmentNote:
          `Bundled demo anchors from PDF auto-setup (${calibration.allocationMode ?? 'unknown'}). ` +
            'Review warnings before shipping as a public demo.',
      })
    : buildHybridBundledPayload(calibration, {
        ...meta,
        calibrated,
        alignmentNote:
          `Bundled demo anchors from hybrid calibration (${calibration.allocationMode ?? 'unknown'}). ` +
            'Review diagnostics before shipping as a public demo.',
      })

  return { payload, calibration, setup }
}

/** Export supplemental per-measure anchors from analyzeSemiAutoScoreSetup (playable beat-1 x). */
async function buildFromAutoPreviewExport({ pdfPath, musicxmlPath, meta }) {
  const timingMap = await loadTimingMap(musicxmlPath)
  const { numPages, pages } = await renderPdfToPages(pdfPath, { rootDir: root })
  const renderPage = makeRenderPageCallback(pages)

  const setup = await analyzeSemiAutoScoreSetup({
    pdfSource: pdfPath,
    numPages,
    timingMap,
    renderPage,
  })

  if (!setup.ok) {
    throw new Error(setup.message ?? 'Auto setup failed.')
  }

  const supplemental = setup.preview.supplementalMeasureAnchors ?? []
  if (supplemental.length < 2) {
    throw new Error('Auto setup produced too few per-measure anchors for bundling.')
  }

  const warnings = []
  if (!setup.preview.plausible) {
    warnings.push(
      'Auto-setup page/system mapping marked implausible — preview anchors exported for demo cursor only.',
    )
  }

  let exportAnchors = supplemental
  if (meta.pieceId === 'hungarian-dance-no5') {
    exportAnchors = repairHungarianDancePage4SupplementalAnchors(
      supplemental,
      setup.preview.systemEntries,
      timingMap,
    )
    warnings.push(
      'Page 4 grand-staff pairing repaired (system 1 Y; systems 2–3 X/Y) for six single-stave detections.',
    )
  }

  const payload = buildBundledAnchorsFromAutoAnchors(exportAnchors, {
    ...meta,
    calibrated: CALIBRATION_SOURCE.AUTO,
    warnings,
    alignmentNote:
      'Bundled demo anchors from auto-setup per-measure preview (playable beat-1 x). ' +
        (meta.pieceId === 'hungarian-dance-no5'
          ? 'Page 4 measures 96–104 use repaired grand-staff geometry. '
          : '') +
        'Re-export with --export-preview after visual validation.',
  })

  return { payload, setup }
}

function runValidation(generated, referencePath, { label = 'validation' } = {}) {
  const reference = readReference(referencePath)
  const structural = validateBundledAnchorPayload(generated, { pieceId: reference.pieceId })
  if (!structural.ok) {
    console.error(`${label}: generated payload invalid (${structural.reason}).`)
    process.exit(1)
  }

  const { comparison, readiness, reportText } = compareBundledAnchorsToReference(generated, reference)
  console.log(formatCalibrationSummary(generated, {
    comparison,
    readiness,
    warnings: generated.calibration?.warnings ?? [],
  }))
  console.log('')
  console.log(reportText)

  if (readiness.status !== PROMOTION_STATUS.READY) {
    console.error(
      `\n${label}: FAILED — max err ${comparison.maxError.toFixed(4)} ` +
        `(tolerance ${VALIDATE_TOLERANCES.maxError}), status ${readiness.status}.`,
    )
    process.exit(1)
  }
  console.log(`\n${label}: passed (READY).`)
}

async function runValidateMinuet(args) {
  const reference = readReference(MINUET_REFERENCE)
  const useAuto = hasFlag(args, '--auto')
  const counts = parseCounts(argValue(args, '--counts')) ?? [5, 5, 6, 5, 5, 6]

  if (useAuto) {
    const pdfPath =
      argValue(args, '--pdf') ?? join(root, 'public/fixtures/demo-minuet-in-g.pdf')
    const musicxmlPath =
      argValue(args, '--musicxml') ?? join(root, 'public/fixtures/demo-minuet-in-g.musicxml')

    if (!existsSync(pdfPath)) {
      console.error(
        'Minuet PDF missing — run npm run fixtures first, or pass --pdf / --musicxml.',
      )
      process.exit(1)
    }

    const { payload, calibration } = await buildFromAutoPipeline({
      pdfPath,
      musicxmlPath,
      counts,
      manualBarlinesPath: argValue(args, '--manual-barlines'),
      meta: {
        pieceId: reference.pieceId,
        pdfFile: reference.pdfFile,
        timingFile: reference.timingFile,
      },
    })

    if (calibration.warnings.length) {
      console.warn('Auto calibration warnings:')
      calibration.warnings.forEach((w) => console.warn(`  - ${w}`))
      console.warn('')
    }

    runValidation(payload, MINUET_REFERENCE, { label: 'validate-minuet (auto)' })
    return
  }

  // Default: round-trip hand-calibrated reference through the shared builder (CI-safe).
  const systems = manualSystemsFromBundledPayload(reference)
  const rebuilt = buildBundledAnchorsFromManualSystems(systems, {
    pieceId: reference.pieceId,
    pdfFile: reference.pdfFile,
    timingFile: reference.timingFile,
    calibrated: reference.anchors?.[0]?.meta?.calibrated ?? CALIBRATION_SOURCE.MANUAL,
    alignmentNote: reference.alignmentNote,
  })

  runValidation(rebuilt, MINUET_REFERENCE, { label: 'validate-minuet (round-trip)' })
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    usage()
    return
  }

  if (hasFlag(args, '--validate-minuet')) {
    await runValidateMinuet(args)
    return
  }

  const manualSystemsPath = argValue(args, '--manual-systems')
  const pdfPath = argValue(args, '--pdf')
  const musicxmlPath = argValue(args, '--musicxml')
  const outPath = argValue(args, '--out')
  const validateRef = argValue(args, '--validate')
  const counts = parseCounts(argValue(args, '--counts'))
  const pieceId = argValue(args, '--piece-id') ?? 'demo-piece'
  const strict = hasFlag(args, '--strict')
  const exportPreview = hasFlag(args, '--export-preview')
  const diagnose = hasFlag(args, '--diagnose')
  const reportPath = argValue(args, '--report')
  const refuseOnSourceMismatch = !hasFlag(args, '--no-refuse')

  let payload
  let calibrationResult = null
  let setupResult = null

  if (manualSystemsPath) {
    payload = buildFromManualSystems(manualSystemsPath, {
      pieceId,
      pdfFile: argValue(args, '--pdf-file') ?? FIXTURE_FILENAMES.pdf,
      timingFile: argValue(args, '--timing-file') ?? FIXTURE_FILENAMES.musicXml,
      calibrated: CALIBRATION_SOURCE.MANUAL,
    })
  } else if (pdfPath && musicxmlPath) {
    if (exportPreview) {
      const result = await buildFromAutoPreviewExport({
        pdfPath,
        musicxmlPath,
        meta: {
          pieceId,
          pdfFile: argValue(args, '--pdf-file') ?? basename(pdfPath),
          timingFile: argValue(args, '--timing-file') ?? basename(musicxmlPath),
        },
      })
      payload = result.payload
      setupResult = result.setup
      if (result.payload.calibration?.warnings?.length) {
        console.warn('Export warnings:')
        result.payload.calibration.warnings.forEach((w) => console.warn(`  - ${w}`))
      }
    } else {
      const result = await buildFromAutoPipeline({
        pdfPath,
        musicxmlPath,
        counts,
        manualBarlinesPath: argValue(args, '--manual-barlines'),
        manualCountOverridesPath: argValue(args, '--system-counts'),
        strict,
        refuseOnSourceMismatch,
        meta: {
          pieceId,
          pdfFile: argValue(args, '--pdf-file') ?? basename(pdfPath),
          timingFile: argValue(args, '--timing-file') ?? basename(musicxmlPath),
        },
      })
      payload = result.payload
      calibrationResult = result.calibration
      setupResult = result.setup

      const referencePath = validateRef ?? null
      const diagnostics = buildCalibrationDiagnostics({
        calibrationResult,
        setup: setupResult,
        payload,
        referencePayload: referencePath ? readReference(referencePath) : null,
      })

      if (diagnose || reportPath) {
        console.log(formatCalibrationDiagnosticsText(diagnostics))
        console.log('')
      }
      if (reportPath) {
        writeFileSync(reportPath, `${serializeCalibrationDiagnostics(diagnostics)}\n`)
        console.log(`Wrote diagnostics → ${reportPath}`)
      }

      if (result.calibration.warnings.length) {
        console.warn('Calibration warnings:')
        result.calibration.warnings.forEach((w) => console.warn(`  - ${w}`))
      }
      if (result.calibration.refused) {
        console.error('\nCalibration refused — sources likely disagree. Fix sources or use hybrid overrides.')
        if (!outPath && !validateRef) {
          process.exit(1)
        }
      } else if (!result.calibration.ok) {
        console.warn(
          '\nCalibration weak or incomplete — do not ship as a public demo without manual review.',
        )
      }
    }
  } else {
    usage()
    process.exit(1)
  }

  const structural = validateBundledAnchorPayload(payload, { pieceId: pieceId === 'demo-piece' ? null : pieceId })
  if (!structural.ok) {
    console.error(`Generated payload failed validation: ${structural.reason}`)
    process.exit(1)
  }

  if (validateRef) {
    runValidation(payload, validateRef, { label: 'validate' })
  }

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`Wrote ${payload.anchors.length} anchors → ${outPath}`)
  } else if (!validateRef) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  }

  console.log('')
  console.log(formatCalibrationSummary(payload, { warnings: payload.calibration?.warnings ?? [] }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
