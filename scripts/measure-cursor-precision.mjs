/**
 * Measure score-follow cursor timing error at note onsets.
 *
 * Run: node scripts/measure-cursor-precision.mjs [path-to-mxl] [path-to-anchors.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import {
  measureCursorOnsetAlignment,
  measureLegacyCursorOnsetAlignment,
} from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(root, 'public')

function fixturePath(urlPath) {
  return path.join(publicRoot, urlPath.replace(/^\//, ''))
}

async function readScoreXml(filePath) {
  const buf = fs.readFileSync(filePath)
  if (filePath.toLowerCase().endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(buf)
    const container = zip.file('META-INF/container.xml')
    let rootPath = null
    if (container) {
      const xml = await container.async('string')
      const m = xml.match(/full-path="([^"]+)"/)
      if (m) rootPath = m[1]
    }
    if (!rootPath || !zip.file(rootPath)) {
      rootPath = Object.keys(zip.files).find(
        (p) => p.toLowerCase().endsWith('.xml') && !p.startsWith('__MACOSX'),
      )
    }
    return zip.file(rootPath).async('string')
  }
  return buf.toString('utf8')
}

async function main() {
  const mxlPath = process.argv[2] ?? fixturePath(FIXTURE_PATHS.musicXml)
  const anchorsPath = process.argv[3] ?? fixturePath(FIXTURE_PATHS.demoAnchors)

  if (!fs.existsSync(mxlPath)) {
    console.error(`Score not found: ${mxlPath}`)
    process.exit(1)
  }

  const xml = await readScoreXml(mxlPath)
  const timingMap = parseMusicXml(xml, path.basename(mxlPath))

  let trusted = []
  if (fs.existsSync(anchorsPath)) {
    const payload = JSON.parse(fs.readFileSync(anchorsPath, 'utf8'))
    trusted = filterTrustedAnchors(payload.anchors ?? payload)
  }

  if (!trusted.length) {
    console.error('No anchors — pass anchors JSON as second argument')
    process.exit(1)
  }

  const report = measureCursorOnsetAlignment({ timingMap, trustedAnchors: trusted })
  const legacy = measureLegacyCursorOnsetAlignment({ timingMap, trustedAnchors: trusted })
  const avgMs =
    report.samples.reduce((sum, sample) => sum + sample.errorMs, 0) /
    Math.max(1, report.samples.length)
  const maxMs = Math.max(0, ...report.samples.map((sample) => sample.errorMs))
  const legacyAvgMs =
    legacy.samples.reduce((sum, sample) => sum + sample.errorMs, 0) /
    Math.max(1, legacy.samples.length)
  const legacyMaxMs = Math.max(0, ...legacy.samples.map((sample) => sample.errorMs))

  console.log('Score Follow Precision Report')
  console.log('  score:', mxlPath)
  console.log('  anchors:', anchorsPath)
  console.log('  samples:', report.sampleCount)
  console.log('\n  v2 (note-onset locked):')
  console.log('    average error (normalized x):', report.averageErrorX.toFixed(5))
  console.log('    max error (normalized x):', report.maxErrorX.toFixed(5))
  console.log('    average error (approx ms):', avgMs.toFixed(1))
  console.log('    max error (approx ms):', maxMs.toFixed(1))
  console.log('\n  legacy (linear beat sweep):')
  console.log('    average error (normalized x):', legacy.averageErrorX.toFixed(5))
  console.log('    max error (normalized x):', legacy.maxErrorX.toFixed(5))
  console.log('    average error (approx ms):', legacyAvgMs.toFixed(1))
  console.log('    max error (approx ms):', legacyMaxMs.toFixed(1))
  console.log('\n  visible jumps (>0.12 x):', report.visibleJumps)

  const worst = [...report.samples].sort((a, b) => b.errorX - a.errorX).slice(0, 5)
  if (worst.length) {
    console.log('\nWorst onset samples:')
    for (const sample of worst) {
      console.log(
        `  t=${sample.timeSeconds.toFixed(3)}s m${sample.measureNumber} ` +
          `errX=${sample.errorX.toFixed(4)} ~${sample.errorMs.toFixed(0)}ms ` +
          `mode=${sample.progressMode ?? '-'}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
