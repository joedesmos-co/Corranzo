#!/usr/bin/env node
/**
 * Diagnostic-only inventory of unpaired notation / unused TAB digits for
 * guitar-paired-chords-vector at HEAD (measure-gap ownership).
 * Writes under tmp/omr-zero-defect/experiments/ — no production edits.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getInstrument } from '../../../src/features/instruments/instruments.js'
import {
  extractTabDigitNotes,
  groupTabNotesByMeasure,
  pairNotationTabInMeasure,
} from '../../../src/features/omr/detectTabNotation.js'
import { textGlyphsToImage } from '../../../src/features/omr/processVectorOmrPage.js'
import { preprocessOmrPageImage } from '../../../src/features/omr/preprocessOmrPageImage.js'
import { processOmrPageAnalysis } from '../../../src/features/omr/processOmrPage.js'
import { runPdfOmrPipeline } from '../../../src/features/omr/runPdfOmrPipeline.js'
import { evaluateSemanticMusicXml } from '../../../src/features/omr/semanticMusicXmlEvaluator.js'
import { parseMusicXml } from '../../../src/features/musicxml/parseMusicXml.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../../scripts/lib/renderPdfPages.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const OUT = HERE
const ID = 'guitar-paired-chords-vector'
const PDF = join(ROOT, `benchmarks/omr-fixtures/${ID}/${ID}.pdf`)
const TRUTH = join(ROOT, `benchmarks/omr-fixtures/${ID}/${ID}.musicxml`)

function midiLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const n = Math.round(midi)
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

function boxForMeasure(boxesBySystem, measureNumber) {
  for (const boxes of boxesBySystem) {
    const hit = (boxes ?? []).find((b) => b.measureNumber === measureNumber)
    if (hit) return hit
  }
  return null
}

function boundaryDistance(xNorm, box) {
  if (!box || !Number.isFinite(xNorm)) return null
  const toLeft = xNorm - box.x0
  const toRight = box.x1 - xNorm
  const side = Math.abs(toLeft) <= Math.abs(toRight) ? 'left' : 'right'
  return {
    distance: Math.min(Math.abs(toLeft), Math.abs(toRight)),
    side,
    x0: box.x0,
    x1: box.x1,
  }
}

function nearestColumn(xNorm, columns) {
  if (!columns?.length || !Number.isFinite(xNorm)) return null
  let best = null
  for (const col of columns) {
    const d = Math.abs(col - xNorm)
    if (!best || d < best.distance) best = { xNorm: col, distance: d }
  }
  return best
}

function notationColumnsFromEvents(events, width) {
  const xs = []
  for (const event of events ?? []) {
    if (event.type !== 'note') continue
    for (const note of event.notes ?? []) {
      if (Number.isFinite(note.xNorm)) xs.push(note.xNorm)
      else if (Number.isFinite(note.cx) && width > 0) xs.push(note.cx / width)
      else if (Number.isFinite(note.cx) && note.cx <= 1.5) xs.push(note.cx)
    }
  }
  // unique-ish cluster
  const sorted = [...xs].sort((a, b) => a - b)
  const cols = []
  for (const x of sorted) {
    if (!cols.length || Math.abs(x - cols[cols.length - 1]) > 0.008) cols.push(x)
  }
  return cols
}

function stripTabFields(events) {
  return (events ?? []).map((event) => {
    if (event.type !== 'note') return { ...event }
    return {
      ...event,
      notes: (event.notes ?? []).map((note) => {
        const next = { ...note }
        delete next.string
        delete next.fret
        delete next.soundingPitch
        delete next.notationTabUnpaired
        delete next.tabMidi
        return next
      }),
      notationTabOnsetConfidence: undefined,
    }
  })
}

function chordRowsFromParsed(score) {
  const byMeasure = new Map()
  const notes = (score.notes ?? []).filter(
    (n) => !n.isRest && n.midi != null && !n.isTabMirror,
  )
  // Group by measure + onset into chords.
  const groups = new Map()
  for (const note of notes) {
    const num = note.measureNumber ?? note.measure
    const onset = Number(note.quarterTime ?? note.onsetQuarters ?? 0)
    const key = `${num}|${onset.toFixed(4)}`
    if (!groups.has(key)) groups.set(key, { measure: num, onset, notes: [] })
    groups.get(key).notes.push(note)
  }
  for (const group of groups.values()) {
    if (!byMeasure.has(group.measure)) byMeasure.set(group.measure, [])
    byMeasure.get(group.measure).push({
      onset: group.onset,
      midis: group.notes.map((n) => n.midi).filter(Number.isFinite).sort((a, b) => a - b),
      labels: group.notes.map((n) => n.label ?? midiLabel(n.midi)),
      strings: group.notes.map((n) => n.string ?? null),
      frets: group.notes.map((n) => n.fret ?? null),
    })
  }
  for (const [, rows] of byMeasure) rows.sort((a, b) => a.onset - b.onset)
  return byMeasure
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const instrument = getInstrument('guitar')
  const rendered = await renderPdfToPages(PDF, { rootDir: ROOT, maxPages: 4 })
  const extractPageText = await makePdfTextExtractor(PDF, { rootDir: ROOT })

  const omr = await runPdfOmrPipeline(PDF, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: 4,
    preprocessPages: true,
    instrumentId: 'guitar',
    title: ID,
  })

  const truthXml = readFileSync(TRUTH, 'utf8')
  const report = evaluateSemanticMusicXml({
    groundTruthMusicXml: truthXml,
    generatedMusicXml: omr.musicXml,
    groundTruthFileName: `${ID}.musicxml`,
    generatedFileName: `${ID}.omr.musicxml`,
    options: { mode: 'written' },
  })

  const truthScore = parseMusicXml(truthXml)
  const genScore = parseMusicXml(omr.musicXml)
  const truthChords = chordRowsFromParsed(truthScore)
  const genChords = chordRowsFromParsed(genScore)

  const measureCompare = []
  for (let m = 1; m <= 8; m += 1) {
    const t = truthChords.get(m) ?? []
    const g = genChords.get(m) ?? []
    const rows = []
    const n = Math.max(t.length, g.length)
    for (let i = 0; i < n; i += 1) {
      const tv = t[i]
      const gv = g[i]
      const same =
        tv && gv && tv.midis.join(',') === gv.midis.join(',')
      rows.push({
        chordIndex: i,
        truth: tv
          ? { midis: tv.midis, labels: tv.labels, strings: tv.strings, frets: tv.frets }
          : null,
        generated: gv
          ? { midis: gv.midis, labels: gv.labels, strings: gv.strings, frets: gv.frets }
          : null,
        pitchMatch: Boolean(same),
      })
    }
    measureCompare.push({
      measure: m,
      truthChordCount: t.length,
      generatedChordCount: g.length,
      matchedChords: rows.filter((r) => r.pitchMatch).length,
      rows,
    })
  }

  // Preprocessed page analysis + TAB re-extraction for unpaired inventory.
  const page = rendered.pages[0]
  const pageText = await extractPageText(null, 1)
  const rawImage = { width: page.width, height: page.height, data: page.data }
  const preprocessed = preprocessOmrPageImage(rawImage)
  const imageData = preprocessed.imageData ?? preprocessed
  const result = processOmrPageAnalysis(imageData, {
    page: 1,
    pageText: pageText.items || pageText,
    instrument,
    stavesPerSystem: instrument?.omr?.stavesPerSystem ?? 1,
    captureOmrV3Shadow: true,
  })
  const shadow = result.omrV3ShadowInput
  const roles = shadow?.systemRoles ?? []
  const boxesBySystem = shadow?.systemMeasureBoxes ?? []
  const positionedGlyphs = textGlyphsToImage(pageText.items || pageText, imageData)

  const allTabNotes = []
  const pairingReplay = []
  const unpairedNotation = []
  const unusedTabs = []
  const attached = []

  for (let systemIndex = 0; systemIndex < (shadow?.systems?.length ?? 0); systemIndex += 1) {
    const role = roles[systemIndex]
    if (!role?.tabStave) continue
    const targetIndex = role.kind === 'mixed' ? systemIndex : role.pairedWithIndex
    if (targetIndex == null) continue
    const targetBoxes = boxesBySystem[targetIndex] ?? []
    const tabNotes = extractTabDigitNotes(
      positionedGlyphs,
      role.tabStave,
      targetBoxes,
      imageData,
      {
        tuning: instrument.strings?.tuning ?? undefined,
        fretCount: instrument.strings?.fretCount ?? 24,
      },
    )
    for (const note of tabNotes) {
      allTabNotes.push({ ...note, systemIndex, targetIndex })
    }

    const byMeasure = groupTabNotesByMeasure(tabNotes)
    const measureRecords = (result.measureRhythms ?? []).filter((m) =>
      targetBoxes.some((b) => b.measureNumber === m.measureNumber),
    )

    for (const measureRecord of measureRecords) {
      const measureNotes = byMeasure.get(measureRecord.measureNumber) ?? []
      const box = boxForMeasure(boxesBySystem, measureRecord.measureNumber)
      // Strip already-attached TAB fields then re-pair for clean diagnostics.
      const cleanEvents = stripTabFields(measureRecord.events)
      const paired = pairNotationTabInMeasure(cleanEvents, measureNotes, {
        beats: 4,
        beatType: 4,
        writtenOctaveOffset: instrument?.notation?.writtenOctaveOffset ?? -1,
      })
      const notationCols = notationColumnsFromEvents(cleanEvents, imageData.width)
      const usedTabKeys = new Set()
      const notationNotes = []
      for (const event of paired.events) {
        if (event.type !== 'note') continue
        for (const note of event.notes ?? []) {
          const xNorm = Number.isFinite(note.xNorm)
            ? note.xNorm
            : Number.isFinite(note.cx)
              ? note.cx / imageData.width
              : null
          const entry = {
            measure: measureRecord.measureNumber,
            systemIndex: targetIndex,
            xNorm,
            midi: note.midi,
            label: midiLabel(note.midi),
            string: note.string ?? null,
            fret: note.fret ?? null,
            soundingPitch: Boolean(note.soundingPitch),
            unpaired: Boolean(note.notationTabUnpaired) || note.string == null,
            nearestNotationColumn: nearestColumn(xNorm, notationCols),
            boundary: boundaryDistance(xNorm, box),
          }
          notationNotes.push(entry)
          if (entry.unpaired) unpairedNotation.push(entry)
          else attached.push(entry)
          if (note.string != null && note.fret != null) {
            // mark nearest matching tab as used by string/fret/x
            let best = null
            for (const tab of measureNotes) {
              const key = `${tab.string}:${tab.fret}:${tab.xNorm.toFixed(5)}`
              if (usedTabKeys.has(key)) continue
              if (tab.string !== note.string || tab.fret !== note.fret) continue
              const d = Math.abs((tab.xNorm ?? 0) - (xNorm ?? 0))
              if (!best || d < best.d) best = { key, d }
            }
            if (best) usedTabKeys.add(best.key)
          }
        }
      }
      for (const tab of measureNotes) {
        const key = `${tab.string}:${tab.fret}:${tab.xNorm.toFixed(5)}`
        if (usedTabKeys.has(key)) continue
        unusedTabs.push({
          measure: measureRecord.measureNumber,
          systemIndex: targetIndex,
          xNorm: tab.xNorm,
          midi: tab.midi,
          label: midiLabel(tab.midi),
          string: tab.string,
          fret: tab.fret,
          nearestNotationColumn: nearestColumn(tab.xNorm, notationCols),
          boundary: boundaryDistance(tab.xNorm, box),
          positionInMeasure: tab.positionInMeasure,
        })
      }
      pairingReplay.push({
        measure: measureRecord.measureNumber,
        systemIndex: targetIndex,
        box: box
          ? { x0: box.x0, x1: box.x1, playableX0: box.playableX0, playableX1: box.playableX1 }
          : null,
        notationColumns: notationCols,
        tabCount: measureNotes.length,
        notationNoteCount: notationNotes.length,
        diagnostics: paired.diagnostics,
        tabXNorms: measureNotes.map((t) => ({
          xNorm: t.xNorm,
          string: t.string,
          fret: t.fret,
          midi: t.midi,
          positionInMeasure: t.positionInMeasure,
        })),
      })
    }
  }

  // Cross-measure orphan check: tabs whose nearest notation column lives in another measure.
  const allNotationColsByMeasure = new Map(
    pairingReplay.map((row) => [row.measure, row.notationColumns]),
  )
  const allBoxes = boxesBySystem.flat().filter(Boolean)
  for (const tab of unusedTabs) {
    let globalNearest = null
    for (const [measure, cols] of allNotationColsByMeasure) {
      const near = nearestColumn(tab.xNorm, cols)
      if (!near) continue
      if (!globalNearest || near.distance < globalNearest.distance) {
        globalNearest = { measure, ...near }
      }
    }
    tab.nearestGlobalNotationColumn = globalNearest
    tab.measureMismatch =
      globalNearest && globalNearest.measure !== tab.measure
        ? {
            tabMeasure: tab.measure,
            notationMeasure: globalNearest.measure,
            distance: globalNearest.distance,
          }
        : null
    // Also: would a different measure box contain this x?
    const containing = allBoxes.filter((b) => tab.xNorm >= b.x0 && tab.xNorm <= b.x1)
    tab.containingMeasureBoxes = containing.map((b) => b.measureNumber)
  }
  for (const note of unpairedNotation) {
    let globalNearestTab = null
    for (const tab of allTabNotes) {
      const d = Math.abs((tab.xNorm ?? 0) - (note.xNorm ?? 0))
      if (!globalNearestTab || d < globalNearestTab.distance) {
        globalNearestTab = {
          measure: tab.measureNumber,
          xNorm: tab.xNorm,
          string: tab.string,
          fret: tab.fret,
          midi: tab.midi,
          distance: d,
        }
      }
    }
    note.nearestGlobalTab = globalNearestTab
    note.measureMismatch =
      globalNearestTab && globalNearestTab.measure !== note.measure
        ? {
            notationMeasure: note.measure,
            tabMeasure: globalNearestTab.measure,
            distance: globalNearestTab.distance,
          }
        : null
  }

  const summary = {
    gitHint: 'c52a38a',
    pipelineTablature: omr.diagnostics?.tablature,
    pipelineNotes: omr.diagnostics?.notes,
    pipelineMeasures: omr.diagnostics?.measures,
    pageTabDiagnostics: result.tabDiagnostics,
    pageSystems: shadow?.systems?.length ?? null,
    pageRoles: roles.map((r, i) => ({
      i,
      kind: r?.kind,
      tabStave: Boolean(r?.tabStave),
      pairedWithIndex: r?.pairedWithIndex ?? null,
      source: r?.source ?? null,
    })),
    boxesPerSystem: boxesBySystem.map((b) =>
      (b ?? []).map((box) => ({
        measureNumber: box.measureNumber,
        x0: box.x0,
        x1: box.x1,
        playableX0: box.playableX0,
        playableX1: box.playableX1,
      })),
    ),
    totals: {
      tabDigitsExtracted: allTabNotes.length,
      attached: attached.length,
      unpairedNotation: unpairedNotation.length,
      unusedTabs: unusedTabs.length,
      pairingReplayPaired: pairingReplay.reduce(
        (s, r) => s + (r.diagnostics?.pairedNotes ?? 0),
        0,
      ),
      pairingReplayUnpairedNotation: pairingReplay.reduce(
        (s, r) => s + (r.diagnostics?.unpairedNotationNotes ?? 0),
        0,
      ),
      pairingReplayUnusedTabs: pairingReplay.reduce(
        (s, r) => s + (r.diagnostics?.unusedTabDigits ?? 0),
        0,
      ),
    },
    measureMismatchUnusedTabs: unusedTabs.filter((t) => t.measureMismatch).length,
    measureMismatchUnpairedNotation: unpairedNotation.filter((n) => n.measureMismatch)
      .length,
    semantic: {
      overall: report.classes?.overall ?? null,
      classes: Object.fromEntries(
        Object.entries(report.classes ?? {}).map(([k, v]) => [
          k,
          { score: v.score, n: v.numerator, d: v.denominator },
        ]),
      ),
      defectCodes: (report.defects ?? []).reduce((acc, d) => {
        acc[d.code] = (acc[d.code] ?? 0) + 1
        return acc
      }, {}),
    },
  }

  const payload = {
    summary,
    measureCompare,
    pairingReplay,
    unpairedNotation,
    unusedTabs,
    attachedSample: attached.slice(0, 20),
    allTabNotes: allTabNotes.map((t) => ({
      measureNumber: t.measureNumber,
      xNorm: t.xNorm,
      string: t.string,
      fret: t.fret,
      midi: t.midi,
      positionInMeasure: t.positionInMeasure,
      systemIndex: t.systemIndex,
      targetIndex: t.targetIndex,
    })),
  }

  writeFileSync(join(OUT, 'paired-tab-unpair-inventory.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'paired-tab-unpair-omr.musicxml'), omr.musicXml ?? '')

  // Human-readable report
  const lines = []
  lines.push('# Paired guitar TAB unpair inventory (c52a38a)')
  lines.push('')
  lines.push(`Pipeline tablature: ${JSON.stringify(omr.diagnostics?.tablature)}`)
  lines.push(
    `Replay totals: attached=${summary.totals.attached} unpairedNotation=${summary.totals.unpairedNotation} unusedTabs=${summary.totals.unusedTabs} tabDigits=${summary.totals.tabDigitsExtracted}`,
  )
  lines.push(
    `Cross-measure nearest: unusedTabs with measureMismatch=${summary.measureMismatchUnusedTabs}, unpairedNotation with measureMismatch=${summary.measureMismatchUnpairedNotation}`,
  )
  lines.push('')
  lines.push('## Truth vs generated chords (m1–m8)')
  for (const m of measureCompare) {
    lines.push(
      `- m${m.measure}: truthChords=${m.truthChordCount} genChords=${m.generatedChordCount} pitchMatched=${m.matchedChords}`,
    )
    for (const row of m.rows) {
      if (row.pitchMatch) continue
      lines.push(
        `  - chord[${row.chordIndex}] truth=${row.truth?.labels?.join('+') ?? '—'} (${row.truth?.midis?.join(',') ?? ''}) gen=${row.generated?.labels?.join('+') ?? '—'} (${row.generated?.midis?.join(',') ?? ''}) genStringFret=${JSON.stringify(row.generated?.strings)}/${JSON.stringify(row.generated?.frets)}`,
      )
    }
  }
  lines.push('')
  lines.push('## Unpaired notation notes')
  for (const n of unpairedNotation) {
    lines.push(
      `- m${n.measure} xNorm=${n.xNorm?.toFixed(4)} ${n.label}(${n.midi}) nearestCol=${n.nearestNotationColumn?.xNorm?.toFixed(4)} Δ=${n.nearestNotationColumn?.distance?.toFixed(4)} boundary=${n.boundary?.side}@${n.boundary?.distance?.toFixed(4)} [${n.boundary?.x0?.toFixed(3)}–${n.boundary?.x1?.toFixed(3)}] nearestTab=m${n.nearestGlobalTab?.measure}@${n.nearestGlobalTab?.xNorm?.toFixed(4)} s${n.nearestGlobalTab?.string}f${n.nearestGlobalTab?.fret} Δ=${n.nearestGlobalTab?.distance?.toFixed(4)}${n.measureMismatch ? ` MISMATCH→tabM${n.measureMismatch.tabMeasure}` : ''}`,
    )
  }
  lines.push('')
  lines.push('## Unused TAB digits')
  for (const t of unusedTabs) {
    lines.push(
      `- m${t.measure} xNorm=${t.xNorm?.toFixed(4)} ${t.label}(${t.midi}) s${t.string}f${t.fret} nearestCol=${t.nearestNotationColumn?.xNorm?.toFixed(4)} Δ=${t.nearestNotationColumn?.distance?.toFixed(4)} boundary=${t.boundary?.side}@${t.boundary?.distance?.toFixed(4)} [${t.boundary?.x0?.toFixed(3)}–${t.boundary?.x1?.toFixed(3)}] globalCol=m${t.nearestGlobalNotationColumn?.measure}@${t.nearestGlobalNotationColumn?.xNorm?.toFixed(4)} Δ=${t.nearestGlobalNotationColumn?.distance?.toFixed(4)}${t.measureMismatch ? ` MISMATCH→notM${t.measureMismatch.notationMeasure}` : ''}`,
    )
  }
  lines.push('')
  lines.push('## Per-measure pairing replay')
  for (const r of pairingReplay) {
    lines.push(
      `- m${r.measure} tabs=${r.tabCount} notes=${r.notationNoteCount} paired=${r.diagnostics?.pairedNotes} unpairedN=${r.diagnostics?.unpairedNotationNotes} unusedT=${r.diagnostics?.unusedTabDigits} box=[${r.box?.x0?.toFixed(3)}–${r.box?.x1?.toFixed(3)}] cols=${r.notationColumns.map((x) => x.toFixed(3)).join(',')}`,
    )
  }
  writeFileSync(join(OUT, 'paired-tab-unpair-inventory.txt'), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
