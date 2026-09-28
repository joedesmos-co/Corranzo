#!/usr/bin/env node

import { NOTATION_FAMILIES } from '../../src/features/omr/guitar/notationFamilies.js'
/**
 * Guitar Vision — Phase 0/1 notation coverage inventory.
 *
 * Walks every MusicXML/MXL in the repository, determines the true staff
 * structure (5-line notation / 6-line TAB / paired), classifies each note
 * object into a notation family, and reports per-family counts plus the
 * families with ZERO ground truth.
 *
 * The point is to make coverage gaps impossible to overlook: a family with no
 * labels cannot be trained, and must not be claimed as supported.
 *
 * Usage:
 *   node tools/guitar-vision/notation-coverage.mjs
 *   node tools/guitar-vision/notation-coverage.mjs --json out.json --root .
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { classifyProvenance } from '../../src/features/omr/guitar/provenance.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FROZEN_MANIFEST = join(ROOT, 'datasets/guitar-vision/splits/frozen.json')

/**
 * Authoritative provenance for known sources, taken from the frozen split
 * manifest rather than re-derived from the path.
 *
 * The manifest carries human-declared provenance for the practice library and
 * the CC0 fixtures, which path-based classification cannot recover: those files
 * sit outside any scratch directory and carry no generated-output marker, so
 * they would fall through to `unlabelled` and the coverage report would show
 * zero labels for a corpus that has them. One source of truth for provenance
 * also means a reclassified file cannot disagree between tools.
 */
function loadDeclaredProvenance() {
  if (!existsSync(FROZEN_MANIFEST)) {
    console.error(
      `WARN: ${FROZEN_MANIFEST} not found; declared provenance is unavailable and ` +
        'every score will be judged by path and content alone.',
    )
    return new Map()
  }
  const manifest = JSON.parse(readFileSync(FROZEN_MANIFEST, 'utf8'))
  const declared = new Map()
  for (const record of manifest.samples ?? []) {
    for (const path of [record.truthPath, record.pdfPath]) {
      if (path) declared.set(path, { provenance: record.provenance, pieceId: record.pieceId })
    }
  }
  return declared
}


const noteTag = (xml, tag) => (xml.match(new RegExp(`<${tag}[^>]*>`, 'g')) ?? []).length

function classifyPart(xml) {
  const staffLines = [...new Set([...xml.matchAll(/<staff-lines>(\d+)<\/staff-lines>/g)].map((m) => Number(m[1])))]
  const hasTabClef = /<sign>TAB<\/sign>/.test(xml)
  const hasStandardClef = /<sign>[GF]<\/sign>/.test(xml)
  const staves = noteTag(xml, 'staff')
  const partName = xml.match(/<part-name>([^<]*)<\/part-name>/)?.[1]?.trim() ?? null
  return {
    staffLines: staffLines.sort((a, b) => a - b),
    hasTabClef,
    hasStandardClef,
    staves: Math.max(staves, 1),
    partName,
    isGuitar: /guitar|guitar|tab|lute|viol|banjo/i.test(partName ?? '') || hasTabClef,
  }
}

function countFamily(hits, name, value = 1) {
  if (value > 0) hits[name] = (hits[name] ?? 0) + value
}

function classifyFile(xml) {
  const hits = {}
  const part = classifyPart(xml)
  if (part.staffLines.includes(6) || part.hasTabClef) countFamily(hits, 'tab-staff')
  if (part.hasStandardClef) countFamily(hits, 'note')
  if (part.staves >= 2) countFamily(hits, 'multi-staff')
  if (part.hasStandardClef && part.hasTabClef) countFamily(hits, 'paired-staff-tab')

  countFamily(hits, 'note', noteTag(xml, 'note') - noteTag(xml, 'rest'))
  countFamily(hits, 'rest', noteTag(xml, 'rest'))
  countFamily(hits, 'chord', noteTag(xml, 'chord'))
  countFamily(hits, 'multi-voice', new Set([...xml.matchAll(/<voice>(\w+)<\/voice>/g)].map((m) => m[1])).size - 1)
  countFamily(hits, 'grace-note', noteTag(xml, 'grace'))
  countFamily(hits, 'cue-note', noteTag(xml, 'cue'))
  countFamily(hits, 'augmentation-dot', noteTag(xml, 'dot'))
  countFamily(hits, 'tuplet', noteTag(xml, 'time-modification'))
  countFamily(hits, 'accidental', noteTag(xml, 'accidental'))
  countFamily(hits, 'key-signature', noteTag(xml, 'fifths'))
  countFamily(hits, 'time-signature', noteTag(xml, 'beat-type'))
  countFamily(hits, 'clef', noteTag(xml, 'sign'))
  countFamily(hits, 'repeat', noteTag(xml, 'repeat'))
  countFamily(hits, 'first-ending', noteTag(xml, 'ending') === 1 ? 1 : 0)
  countFamily(hits, 'second-ending', noteTag(xml, 'ending') === 2 ? 1 : 0)
  countFamily(hits, 'segno', /<segno\b|<words>[^<]*\bSegno\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'coda', /<coda\b|<words>[^<]*\bCoda\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'dc-ds', /<words>[^<]*\bD\.?\s*C\b|<words>[^<]*\bD\.?\s*S\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tempo-marking', /<sound[^>]*tempo=/.test(xml) ? 1 : 0)
  countFamily(hits, 'ritardando', /<words>[^<]*\b(?:rit\.?|ritardando|rall\.?|rallentando)\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'accelerando', /<words>[^<]*\b(?:accel\.?|accelerando)\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'lyrics', noteTag(xml, 'lyric'))
  countFamily(hits, 'performance-text', noteTag(xml, 'words'))

  // Guitar technique families
  countFamily(hits, 'fret-number', noteTag(xml, 'fret'))
  countFamily(hits, 'string-number', noteTag(xml, 'string'))
  countFamily(hits, 'fret-position', noteTag(xml, 'fret-position'))
  countFamily(hits, 'bend', noteTag(xml, 'bend'))
  countFamily(hits, 'bend-amount', /<bend-alter>/.test(xml) ? 1 : 0)
  countFamily(hits, 'bend-with-fret', /<bend[^>]*>[\s\S]*?<fret>/.test(xml) ? 1 : 0)
  countFamily(hits, 'pre-bend', /<bend[^>]*type="pre-bend"/.test(xml) ? 1 : 0)
  countFamily(hits, 'bend-release', /<bend[^>]*type="release"/.test(xml) ? 1 : 0)
  countFamily(hits, 'vibrato', /<wavy-line\b/.test(xml) || /vibrato/i.test(xml) ? 1 : 0)
  countFamily(hits, 'hammer-on', noteTag(xml, 'hammer-on'))
  countFamily(hits, 'pull-off', noteTag(xml, 'pull-off'))
  countFamily(hits, 'slide', noteTag(xml, 'slide'))
  countFamily(hits, 'glissando', noteTag(xml, 'glissando'))
  countFamily(hits, 'natural-harmonic', /<harmonic\b/.test(xml) ? 1 : 0)
  countFamily(hits, 'artificial-harmonic', /type="artificial"/.test(xml) ? 1 : 0)
  countFamily(hits, 'pinch-harmonic', /<pinch-harmonic|pinch/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tapping', /<tapping|\btap\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'palm-mute', /palm-?mute|\bp\.?m\.?/i.test(xml) ? 1 : 0)
  countFamily(hits, 'let-ring', /let-?ring|\bl\.?r\.?\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tremolo-picking', /tremolo-?pick/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tremolo', /<tremolo\b/.test(xml) ? 1 : 0)
  countFamily(hits, 'whammy-bar', /whammy|dip-?piano|tremolo-?bar/i.test(xml) ? 1 : 0)
  countFamily(hits, 'arpeggio', /<arpeggiate\b|\barpeggio\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'capo', /\bcapo\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tuning-change', /<tuning\b/.test(xml) ? 1 : 0)
  // scordatura has no MusicXML element; it stays listed at zero so the gap is visible.

  // Articulations / expression
  countFamily(hits, 'staccato', /<staccato\b|\bstacc\.\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'tenuto', /<tenuto\b|\bten\.\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'marcato', /<strong-accent|\bmarc\.\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'accent', noteTag(xml, 'accent'))
  countFamily(hits, 'sforzando', /\bsf[zpf]\b|\bsforzando\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'fermata', noteTag(xml, 'fermata'))
  countFamily(hits, 'dynamic', /<dynamics\b/.test(xml) ? 1 : 0)
  countFamily(hits, 'hairpin', noteTag(xml, 'wedge'))
  countFamily(hits, 'tie', noteTag(xml, 'tied'))
  countFamily(hits, 'slur', noteTag(xml, 'slur'))
  countFamily(hits, 'fingering', noteTag(xml, 'fingering'))
  countFamily(hits, 'pick-direction', /pick-?direction|pluck/i.test(xml) ? 1 : 0)
  countFamily(hits, 'barre', /\bbarre\b|\bcapobarre\b/i.test(xml) ? 1 : 0)
  countFamily(hits, 'chord-symbol', noteTag(xml, 'root'))
  countFamily(hits, 'chord-diagram', /<frame\b/.test(xml) ? 1 : 0)
  countFamily(hits, 'octave-shift', /<octave-shift\b/.test(xml) ? 1 : 0)
  countFamily(hits, 'ornament', /<ornaments\b/.test(xml) ? 1 : 0)
  return { part, hits }
}

function walk(root, out = [], depth = 0) {
  if (depth > 8) return out
  let entries = []
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(root, name)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out, depth + 1)
    else if (/\.(musicxml|xml|mxl)$/i.test(name)) out.push(full)
  }
  return out
}

async function readXml(path) {
  if (!path.toLowerCase().endsWith('.mxl')) return readFileSync(path, 'utf8')
  const zip = await JSZip.loadAsync(readFileSync(path))
  let rootPath = null
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  const entry =
    (rootPath && zip.file(rootPath)) ??
    Object.values(zip.files).find(
      (item) => !item.dir && item.name.toLowerCase().endsWith('.xml') && !item.name.startsWith('META-INF/'),
    )
  return entry ? entry.async('string') : ''
}

function main() {
  const args = process.argv.slice(2)
  const argValue = (flag, fallback) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : fallback
  }
  const root = argValue('--root', process.cwd())
  const jsonOut = argValue('--json', null)

  return (async () => {
    const declaredProvenance = loadDeclaredProvenance()
    const files = walk(root).filter((file) => !file.includes(`${'tmp'}/gv-audit`))
    const totals = Object.fromEntries(NOTATION_FAMILIES.map((name) => [name, 0]))
    const labelableTotals = Object.fromEntries(NOTATION_FAMILIES.map((name) => [name, 0]))
    const perFile = []
    let guitarFiles = 0
    let tabFiles = 0
    let scanned = 0
    let excludedGenerated = 0
    let excludedUnlabelled = 0
    const excludedExamples = []

    for (const file of files) {
      let xml = ''
      try {
        xml = await readXml(file)
      } catch {
        continue
      }
      if (!xml.includes('<score-partwise') && !xml.includes('<score-timewise')) continue
      scanned += 1

      /**
       * Provenance is resolved before anything is counted. The repository
       * tracks ~670 MusicXML files under tmp/ that are OMR engine output, and
       * counting them as ground truth would report 6077 fret labels for a corpus
       * that has none. Coverage must describe the labelable corpus only.
       */
      const relativePath = relative(root, file)
      const declaration = declaredProvenance.get(relativePath)
      const verdict = declaration
        ? { provenance: declaration.provenance, rule: 'frozen-manifest', labelable: declaration.provenance === 'real-printed' || declaration.provenance === 'synthetic-cc0', requiresHumanReview: false }
        : classifyProvenance({ path: relativePath, text: xml })
      if (verdict.provenance === 'generated') {
        excludedGenerated += 1
        if (excludedExamples.length < 5) excludedExamples.push(relativePath)
        continue
      }
      if (verdict.provenance === 'unlabelled') {
        excludedUnlabelled += 1
        continue
      }

      const { part, hits } = classifyFile(xml)
      if (part.isGuitar) guitarFiles += 1
      if (part.hasTabClef) tabFiles += 1
      for (const [name, value] of Object.entries(hits)) {
        if (name in totals) totals[name] += value
        if (name in labelableTotals) labelableTotals[name] += value
      }
      perFile.push({
        file: relativePath,
        instrument: part.isGuitar ? 'guitar' : 'other',
        provenance: verdict.provenance,
        provenanceRule: verdict.rule,
        tab: part.hasTabClef,
        staffLines: part.staffLines,
        staves: part.staves,
        partName: part.partName,
        families: hits,
      })
    }

    const zeroFamilies = NOTATION_FAMILIES.filter((name) => (labelableTotals[name] ?? 0) === 0)
    const thinFamilies = NOTATION_FAMILIES.filter((name) => {
      const value = labelableTotals[name] ?? 0
      return value > 0 && value < 50
    })

    console.log('Guitar Vision — notation coverage inventory (labelable corpus only)')
    console.log('='.repeat(64))
    console.log(`root:                     ${root}`)
    console.log(`scores scanned:           ${scanned}`)
    console.log(`excluded, OMR-generated:  ${excludedGenerated}  (engine output, never a label)`)
    console.log(`excluded, no truth:       ${excludedUnlabelled}`)
    console.log(`guitar scores:            ${guitarFiles}`)
    console.log(`scores with a real TAB:   ${tabFiles}`)
    console.log(`families tracked:         ${NOTATION_FAMILIES.length}`)
    console.log('')
    console.log('PER-FAMILY LABEL COUNTS (authoritative sources only)')
    console.log('-'.repeat(64))
    for (const name of NOTATION_FAMILIES) {
      const value = labelableTotals[name] ?? 0
      const bar = value === 0 ? '' : '#'.repeat(Math.min(40, Math.max(1, Math.round(Math.log10(value + 1) * 8))))
      const flag = value === 0 ? 'ZERO ' : value < 50 ? 'THIN ' : '     '
      console.log(`  ${flag}${name.padEnd(22)} ${String(value).padStart(7)}  ${bar}`)
    }
    console.log('')
    console.log(`ZERO-COVERAGE FAMILIES (${zeroFamilies.length}/${NOTATION_FAMILIES.length}):`)
    console.log(`  ${zeroFamilies.join(', ')}`)
    console.log('')
    console.log(`THIN FAMILIES (<50 labels, ${thinFamilies.length}):`)
    console.log(`  ${thinFamilies.join(', ')}`)

    if (jsonOut) {
      writeFileSync(
        jsonOut,
        `${JSON.stringify(
          {
            version: 2,
            root,
            scoresScanned: scanned,
            excludedGenerated,
            excludedUnlabelled,
            guitarScores: guitarFiles,
            scoresWithTab: tabFiles,
            familiesTracked: NOTATION_FAMILIES.length,
            totals: labelableTotals,
            zeroCoverageFamilies: zeroFamilies,
            thinFamilies,
            files: perFile,
          },
          null,
          2,
        )}\n`,
      )
      console.log('')
      console.log(`Wrote ${jsonOut}`)
    }
  })()
}

main()
