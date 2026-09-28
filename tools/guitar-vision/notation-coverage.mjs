#!/usr/bin/env node
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
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import JSZip from 'jszip'

/**
 * The full notation surface Guitar Vision must cover. Every family is tracked
 * whether or not the corpus contains it, so absence is always visible.
 */
export const NOTATION_FAMILIES = [
  // Core music
  'note', 'rest', 'chord', 'stacked-notes', 'multi-voice', 'grace-note',
  'cue-note', 'ghost-note', 'dead-note', 'augmentation-dot', 'tuplet',
  'accidental', 'key-signature', 'time-signature', 'clef',
  'barline', 'repeat', 'first-ending', 'second-ending', 'segno', 'coda',
  'dc-ds', 'time-sig-change', 'key-change', 'clef-change', 'tempo-marking',
  'ritardando', 'accelerando', 'performance-text', 'lyrics',
  // Guitar-specific
  'tab-staff', 'fret-number', 'string-number', 'fret-position',
  'string-assignment', 'paired-staff-tab', 'capo', 'tuning-change',
  'alternate-tuning', 'scordatura', 'octave-shift',
  'bend', 'pre-bend', 'bend-release', 'bend-amount', 'bend-with-fret',
  'vibrato', 'hammer-on', 'pull-off', 'slide', 'glissando',
  'natural-harmonic', 'artificial-harmonic', 'pinch-harmonic',
  'tapping', 'palm-mute', 'let-ring', 'tremolo-picking', 'tremolo',
  'whammy-bar', 'arpeggio', 'ornament',
  // Articulations / expression
  'staccato', 'tenuto', 'marcato', 'accent', 'sforzando', 'fermata',
  'dynamic', 'hairpin', 'tie', 'slur', 'fingering', 'pick-direction',
  'barre', 'chord-symbol', 'chord-diagram', 'multi-staff',
]

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
    const files = walk(root).filter((file) => !file.includes(`${'tmp'}/gv-audit`))
    const totals = Object.fromEntries(NOTATION_FAMILIES.map((name) => [name, 0]))
    const perFile = []
    let guitarFiles = 0
    let tabFiles = 0
    let scanned = 0

    for (const file of files) {
      let xml = ''
      try {
        xml = await readXml(file)
      } catch {
        continue
      }
      if (!xml.includes('<score-partwise') && !xml.includes('<score-timewise')) continue
      scanned += 1
      const { part, hits } = classifyFile(xml)
      if (part.isGuitar) guitarFiles += 1
      if (part.hasTabClef) tabFiles += 1
      for (const [name, value] of Object.entries(hits)) {
        if (name in totals) totals[name] += value
      }
      perFile.push({
        file: relative(root, file),
        instrument: part.isGuitar ? 'guitar' : 'other',
        tab: part.hasTabClef,
        staffLines: part.staffLines,
        staves: part.staves,
        partName: part.partName,
        families: hits,
      })
    }

    const zeroFamilies = NOTATION_FAMILIES.filter((name) => (totals[name] ?? 0) === 0)
    const thinFamilies = NOTATION_FAMILIES.filter((name) => {
      const value = totals[name] ?? 0
      return value > 0 && value < 50
    })

    console.log('Guitar Vision — notation coverage inventory')
    console.log('='.repeat(64))
    console.log(`root:              ${root}`)
    console.log(`scores scanned:    ${scanned}`)
    console.log(`guitar scores:     ${guitarFiles}`)
    console.log(`scores with TAB:   ${tabFiles}`)
    console.log(`families tracked:  ${NOTATION_FAMILIES.length}`)
    console.log('')
    console.log('PER-FAMILY GROUND-TRUTH COUNTS')
    console.log('-'.repeat(64))
    for (const name of NOTATION_FAMILIES) {
      const value = totals[name] ?? 0
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
            version: 1,
            root,
            scoresScanned: scanned,
            guitarScores: guitarFiles,
            scoresWithTab: tabFiles,
            familiesTracked: NOTATION_FAMILIES.length,
            totals,
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
