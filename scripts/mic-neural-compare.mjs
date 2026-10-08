#!/usr/bin/env node
/**
 * Neural vs spectral comparison (Stage 5, N3) — identical audio, identical
 * truth, identical anchor-window pitch-set metrics.
 *
 * Basic Pitch emits note events {start, end, midi}; the anchor-window set
 * (notes overlapping [anchor-0.3, anchor+1.0]) is scored exactly like the
 * spectral grouped leg. Spectral legs are read from the committed Stage-4
 * full-run report (tmp/stage4-full.json regenerable via mic:realbench).
 *
 * Usage:
 *   node scripts/mic-neural-compare.mjs [--bp tmp/basicpitch/notes.json]
 *     [--report tmp/stage4-full.json] [--json tmp/neural-compare.json]
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function uniqueSorted(values) {
  return [...new Set(values.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b)
}

function main() {
  const args = process.argv.slice(2)
  const opt = (name, fallback) => {
    const index = args.indexOf(name)
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback
  }
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const bp = JSON.parse(readFileSync(join(ROOT, opt('--bp', 'tmp/basicpitch/notes.json')), 'utf8'))
  const stage4 = JSON.parse(readFileSync(join(ROOT, opt('--report', 'tmp/stage4-full.json')), 'utf8'))
  const stage4Rows = new Map(stage4.rows.map((row) => [row.id, row]))

  const rows = []
  for (const clip of manifest.clips) {
    const entry = bp[clip.id]
    if (!entry) {
      console.log(`WARN no Basic Pitch output for ${clip.id}`)
      continue
    }
    const truthMidis = uniqueSorted(clip.truth.notes.map((n) => n.midi))
    const anchor = clip.truth.anchorTones
    let detected
    let first = new Map()
    if (clip.truth.anchorOnset == null) {
      detected = uniqueSorted(entry.notes.map((n) => n.midi))
    } else {
      const lo = clip.truth.anchorOnset - 0.3
      const hi = clip.truth.anchorOnset + 1.0
      const inWindow = entry.notes.filter((n) => n.start < hi && n.end > lo)
      detected = uniqueSorted(inWindow.map((n) => n.midi))
      for (const note of inWindow) {
        if (!first.has(note.midi) || note.start < first.get(note.midi)) {
          first.set(note.midi, note.start)
        }
      }
    }
    const det = new Set(detected)
    const truth = new Set(truthMidis)
    const anchorHit = anchor.filter((m) => det.has(m)).length
    const truthHit = truthMidis.filter((m) => det.has(m)).length
    const fp = detected.filter((m) => !truth.has(m))
    // Attack-locked onsets only: repetitive music makes earliest-in-window
    // matching lock onto previous phrase repetitions (measured constant
    // -0.488 s artifacts). An onset counts when the matched note starts
    // within [anchor-0.1, anchor+0.25].
    const onsetErrors = []
    let attackLocked = 0
    for (const m of anchor) {
      if (!first.has(m)) {
        continue
      }
      const err = first.get(m) - clip.truth.anchorOnset
      if (err >= -0.1 && err <= 0.25) {
        attackLocked += 1
        onsetErrors.push(err)
      }
    }
    rows.push({
      id: clip.id,
      instrument: clip.instrument,
      category: clip.category,
      split: clip.split ?? 'dev',
      anchorTones: anchor,
      truthMidis,
      neural: {
        detected,
        noteCount: entry.notes.length,
        anchorRecall: anchor.length ? anchorHit / anchor.length : null,
        excerptRecall: truth.size ? truthHit / truth.size : (det.size === 0 ? 1 : null),
        excerptPrecision: det.size ? (det.size - fp.length) / det.size : 1,
        exact: det.size === truth.size && truthHit === truth.size,
        missed: truthMidis.filter((m) => !det.has(m)),
        fp,
        attackLockedOnsets: anchor.length ? `${attackLocked}/${anchor.length}` : 'n/a',
        meanOnsetError: onsetErrors.length
          ? onsetErrors.reduce((a, b) => a + b, 0) / onsetErrors.length
          : null,
        ms: entry.inferMs,
      },
    })
  }

  // Controls (no manifest truth): any note is a false positive.
  const controls = {}
  for (const [id, label] of [['control-silence', 'silence'], ['control-noise', 'noise'], ['control-speech', 'speech']]) {
    const entry = bp[id]
    if (entry) {
      controls[label] = { notes: entry.notes.length, midis: uniqueSorted(entry.notes.map((n) => n.midi)) }
    }
  }

  const summary = {}
  for (const row of rows) {
    for (const key of [`${row.split}:${row.instrument}`, `${row.split}:${row.instrument}:${row.category}`]) {
      const bucket = summary[key] ??= { clips: 0, anchorHits: 0, anchorTotal: 0, exact: 0, fp: 0, missed: 0, onsetErrs: [], lockedHits: 0, lockedTotal: 0, ms: 0 }
      bucket.clips += 1
      const data = row.neural
      if (data.anchorRecall != null) {
        bucket.anchorHits += data.anchorRecall * row.anchorTones.length
        bucket.anchorTotal += row.anchorTones.length
      }
      if (typeof data.attackLockedOnsets === 'string' && data.attackLockedOnsets.includes('/')) {
        const [hits, total] = data.attackLockedOnsets.split('/').map(Number)
        bucket.lockedHits += hits
        bucket.lockedTotal += total
      }
      if (data.exact) bucket.exact += 1
      bucket.fp += data.fp.length
      bucket.missed += data.missed.length
      if (data.meanOnsetError != null) bucket.onsetErrs.push(data.meanOnsetError)
      bucket.ms += data.ms ?? 0
    }
  }
  const compact = {}
  for (const [key, cell] of Object.entries(summary)) {
    compact[key] = {
      clips: cell.clips,
      anchorRecall: cell.anchorTotal ? Math.round((cell.anchorHits / cell.anchorTotal) * 100) / 100 : null,
      exactRate: `${cell.exact}/${cell.clips}`,
      totalFP: cell.fp,
      totalMissed: cell.missed,
      attackLockedOnsets: cell.lockedTotal ? `${cell.lockedHits}/${cell.lockedTotal}` : 'n/a',
      meanOnsetErrorS: cell.onsetErrs.length
        ? Math.round((cell.onsetErrs.reduce((a, b) => a + b, 0) / cell.onsetErrs.length) * 1000) / 1000
        : null,
      meanMs: Math.round(cell.ms / cell.clips),
    }
  }

  // Side-by-side with spectral legs from the Stage-4 report.
  console.log('# Neural (Basic Pitch) vs spectral — anchor recall / exact / FP / missed')
  for (const key of Object.keys(compact).filter((k) => k.split(':').length === 2).sort()) {
    const [split, instrument] = key.split(':')
    const spec = stage4.summary[`${split}:${instrument}`]?.engines ?? {}
    const line = (label, value) => `${label}=${value}`
    console.log(`== ${key} (n=${compact[key].clips})`)
    console.log(`  neural       aR=${compact[key].anchorRecall} exact=${compact[key].exactRate} FP=${compact[key].totalFP} miss=${compact[key].totalMissed} onset=${compact[key].meanOnsetErrorS} ms=${compact[key].meanMs}`)
    for (const leg of ['blind', 'grouped', 'hybrid', 'hybridGrouped', 'v3']) {
      const cell = spec[leg]
      if (cell) {
        console.log(`  ${leg.padEnd(13)} aR=${cell.anchorRecall} exact=${cell.exactRate} FP=${cell.totalFP} miss=${cell.totalMissed} awards=${cell.wrongAwards}`)
      }
    }
  }
  console.log('\n# Per-category neural recall')
  for (const key of Object.keys(compact).filter((k) => k.split(':').length === 3).sort()) {
    console.log(`  ${key} n=${compact[key].clips} aR=${compact[key].anchorRecall} FP=${compact[key].totalFP}`)
  }
  console.log('\n# Neural controls (any note = FP)')
  console.log(JSON.stringify(controls))

  const jsonIndex = args.indexOf('--json')
  if (jsonIndex !== -1 && args[jsonIndex + 1]) {
    const outPath = join(ROOT, args[jsonIndex + 1])
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify({ summary: compact, rows, controls }, null, 2))
    console.log(`\nWrote ${outPath}`)
  }
}

main()
