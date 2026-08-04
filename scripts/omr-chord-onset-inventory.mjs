#!/usr/bin/env node
/**
 * Dense chord / onset ownership inventory for the frozen 9-fixture corpus.
 * Attaches measure-level vectorChordDiagnostics from the OMR pipeline.
 * Writes tmp/omr-chord-onset/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  evaluateSemanticMusicXml,
  normalizeSemanticNotes,
} from '../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
  resolveSemanticEvalOptions,
} from '../src/features/omr/semanticEvalTolerances.js'
import {
  buildMeasureFingerprint,
  alignMeasureSequences,
} from '../src/features/omr/semanticMeasureAlignment.js'
import {
  matchSemanticEvents,
  summarizeChordIntegrity,
} from '../src/features/omr/semanticEventMatching.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/omr-chord-onset')
mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'generated'), { recursive: true })
mkdirSync(join(OUT, 'diagnostics'), { recursive: true })

const FOCUS_CODES = new Set([
  'incorrect-chord',
  'missing-note',
  'extra-note',
  'onset-mismatch',
])

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function expandHome(pathValue) {
  if (!pathValue) return pathValue
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2))
  return pathValue
}

function resolveFixturePath(relativePath, searchPaths) {
  for (const root of searchPaths) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function readScoreXml(scorePath) {
  if (/\.mxl$/i.test(scorePath)) {
    const zip = await JSZip.loadAsync(readFileSync(scorePath))
    const entry =
      Object.keys(zip.files).find((name) => /score\.xml$/i.test(name)) ??
      Object.keys(zip.files).find((name) => /\.xml$/i.test(name) && !name.includes('META-INF'))
    if (!entry) throw new Error(`No MusicXML entry in ${scorePath}`)
    return zip.file(entry).async('string')
  }
  return readFileSync(scorePath, 'utf8')
}

function midiToLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const rounded = Math.round(midi)
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

function noteFields(note) {
  if (!note) return null
  return {
    id: note.id ?? null,
    midi: note.midi ?? null,
    label: note.label ?? null,
    onsetQuarters: note.onsetQuarters ?? null,
    durationQuarters: note.durationQuarters ?? null,
    voice: note.rawVoice ?? note.voice ?? null,
    staff: note.staff ?? null,
    isRest: Boolean(note.isRest),
    isChord: Boolean(note.isChord),
    stemDirection: note.stemDirection ?? null,
    beams: note.beams ?? null,
  }
}

function indexOmrMeasures(omr) {
  const byNumber = new Map()
  for (const page of omr.pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        const events = (measure.events ?? []).filter((event) => event.type === 'note')
        const noteheadIds = []
        const ownership = new Map()
        for (const event of events) {
          const eventKey = `${event.startDivision ?? 0}@${event.notes?.[0]?.clef ?? 'treble'}`
          for (const note of event.notes ?? []) {
            const id =
              note.candidateId ??
              note.symbolId ??
              note.id ??
              `${Math.round(note.cx ?? 0)}:${Math.round(note.cy ?? 0)}:${note.midi ?? '?'}`
            noteheadIds.push(id)
            if (!ownership.has(id)) ownership.set(id, [])
            ownership.get(id).push(eventKey)
          }
        }
        const duplicateOwnership = [...ownership.entries()].filter(([, keys]) => keys.length > 1)
        byNumber.set(measure.measureNumber, {
          page: page.page ?? page.pageNumber ?? null,
          systemIndex: system.systemIndex ?? null,
          chordDiagnostics: measure.vectorChordDiagnostics ?? null,
          rhythmDiagnostics: measure.vectorRhythmDiagnostics ?? null,
          reconstructDiagnostics: measure.musicalEventReconstructionDiagnostics ?? null,
          noteMatching: measure.vectorNoteMatching ?? null,
          events,
          duplicateOwnershipCount: duplicateOwnership.length,
          duplicateOwnership: duplicateOwnership.slice(0, 12).map(([id, keys]) => ({ id, events: keys })),
          noteheadCount: noteheadIds.length,
          uniqueNoteheadCount: ownership.size,
        })
      }
    }
  }
  return byNumber
}

function classifyMechanism(row) {
  const code = row.code
  const onsetDiff = row.onsetDiffQuarters
  const fragmented = Boolean(row.fragmentedSameClef)
  const sequentialSameX = (row.sequentialSameXCount ?? 0) > 0
  const expectedCount = row.expectedChordMidis?.length ?? (row.expected ? 1 : 0)
  const generatedCount = row.generatedChordMidis?.length ?? (row.generated ? 1 : 0)
  const pitchOnly =
    code === 'incorrect-chord' &&
    expectedCount === generatedCount &&
    expectedCount > 0 &&
    (row.expectedChordMidis ?? []).every((midi, index) => {
      const other = row.generatedChordMidis?.[index]
      return Number.isFinite(midi) && Number.isFinite(other) && Math.abs(midi - other) <= 1
    })

  if (pitchOnly || row.pitchOnlyMasquerade) return 'remaining-pitch-masquerading-as-chord'
  if (code === 'incorrect-chord' && fragmented) return 'same-chord-split-across-onsets'
  if (code === 'incorrect-chord' && sequentialSameX) return 'adjacent-chord-column-steal'
  if (code === 'incorrect-chord' && expectedCount > generatedCount) return 'note-dropped-during-packing'
  if (code === 'incorrect-chord' && generatedCount > expectedCount) {
    return 'nearby-voices-incorrectly-merged'
  }
  if (code === 'incorrect-chord' && onsetDiff != null && Math.abs(onsetDiff) >= 0.2) {
    return 'chord-geometry-ok-wrong-onset'
  }
  if (code === 'incorrect-chord') return 'same-chord-split-across-onsets'
  if (code === 'onset-mismatch' && (row.expected?.isChord || row.generated?.isChord)) {
    return 'complete-chord-wrong-onset'
  }
  if (code === 'onset-mismatch') return 'onset-resnap-or-gap-pack'
  if (code === 'missing-note' && fragmented) return 'same-chord-split-across-onsets'
  if (code === 'missing-note' && row.alignmentSymptom) return 'evaluator-alignment-artifact'
  if (code === 'missing-note') return 'note-dropped-during-packing'
  if (code === 'extra-note' && (row.duplicateOwnershipCount ?? 0) > 0) {
    return 'duplicate-ownership-of-one-notehead'
  }
  if (code === 'extra-note' && sequentialSameX) return 'adjacent-chord-column-steal'
  if (code === 'extra-note' && row.alignmentSymptom) return 'evaluator-alignment-artifact'
  if (code === 'extra-note') return 'nearby-voices-incorrectly-merged'
  return 'unclassified'
}

function collectStructuredMismatches(fixtureId, truthXml, generatedXml, omrByMeasure, options) {
  const resolved = resolveSemanticEvalOptions(options)
  const truthTiming = parseMusicXml(truthXml, `${fixtureId}.truth.musicxml`)
  const generatedTiming = parseMusicXml(generatedXml, `${fixtureId}.omr.musicxml`)
  const truthNotes = normalizeSemanticNotes(truthTiming, resolved)
  const generatedNotes = normalizeSemanticNotes(generatedTiming, resolved)
  const truthMeasures = truthTiming?.measures ?? []
  const generatedMeasures = generatedTiming?.measures ?? []

  const groupByIndex = (notes, measures) => {
    const byIndex = new Map(measures.map((_, index) => [index, []]))
    const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
    for (const note of notes) {
      const index = byNumber.get(note.measureNumber)
      if (index == null) continue
      byIndex.get(index).push(note)
    }
    return byIndex
  }

  const truthByIndex = groupByIndex(truthNotes, truthMeasures)
  const generatedByIndex = groupByIndex(generatedNotes, generatedMeasures)

  const alignment = alignMeasureSequences(
    truthMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, truthByIndex.get(index) ?? []),
    ),
    generatedMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? []),
    ),
    resolved,
  )

  const rows = []

  for (const link of alignment.pairs ?? []) {
    const truthNums = (link.truthMeasureNumbers ?? []).filter((n) => n != null)
    const generatedNums = (link.generatedMeasureNumbers ?? []).filter((n) => n != null)
    const truthMeasure = truthNums[0] ?? null
    const generatedMeasure = generatedNums[0] ?? null
    const omrMeasure = omrByMeasure.get(truthMeasure) ?? omrByMeasure.get(generatedMeasure) ?? null
    const chordDiag = omrMeasure?.chordDiagnostics ?? null

    const attachDiag = (row) => {
      const enriched = {
        ...row,
        page: omrMeasure?.page ?? null,
        systemIndex: omrMeasure?.systemIndex ?? null,
        fragmentedSameClef: chordDiag?.fragmentedSameClef ?? null,
        sequentialSameXCount: chordDiag?.sequentialSameXCount ?? null,
        chordOnsetCount: chordDiag?.onsetCount ?? null,
        chordFragmentedOnsetCount: chordDiag?.fragmentedOnsetCount ?? null,
        reconstructReasons: omrMeasure?.reconstructDiagnostics?.reasons ?? null,
        dedupedDuringGrouping: omrMeasure?.noteMatching?.dedupedDuringGrouping ?? null,
        duplicateOwnershipCount: omrMeasure?.duplicateOwnershipCount ?? null,
        duplicateOwnership: omrMeasure?.duplicateOwnership ?? null,
        uniqueNoteheadCount: omrMeasure?.uniqueNoteheadCount ?? null,
        noteheadCount: omrMeasure?.noteheadCount ?? null,
      }
      enriched.cluster = classifyMechanism(enriched)
      return enriched
    }

    if (link.kind !== 'match') {
      if (link.kind === 'missing') {
        for (const truthIndex of link.truthIndexes ?? []) {
          for (const note of truthByIndex.get(truthIndex) ?? []) {
            if (note.isRest) continue
            rows.push(
              attachDiag({
                fixture: fixtureId,
                code: 'missing-note',
                measure: note.measureNumber,
                expected: noteFields(note),
                generated: null,
                source: 'unmatched-measure',
                alignmentSymptom: true,
              }),
            )
          }
        }
      }
      if (link.kind === 'extra') {
        for (const generatedIndex of link.generatedIndexes ?? []) {
          for (const note of generatedByIndex.get(generatedIndex) ?? []) {
            if (note.isRest) continue
            rows.push(
              attachDiag({
                fixture: fixtureId,
                code: 'extra-note',
                measure: note.measureNumber,
                expected: null,
                generated: noteFields(note),
                source: 'unmatched-measure',
                alignmentSymptom: true,
              }),
            )
          }
        }
      }
      continue
    }

    if (truthMeasure == null || generatedMeasure == null) continue
    const truthIndex = link.truthIndexes?.[0]
    const generatedIndex = link.generatedIndexes?.[0]
    const truth = truthByIndex.get(truthIndex) ?? []
    const generated = generatedByIndex.get(generatedIndex) ?? []
    const matched = matchSemanticEvents(truth, generated, resolved)
    const chords = summarizeChordIntegrity(
      matched.matches,
      matched.missing,
      matched.extra,
      resolved,
    )

    for (const pair of matched.matches) {
      if (!pair.onsetCorrect) {
        rows.push(
          attachDiag({
            fixture: fixtureId,
            code: 'onset-mismatch',
            measure: truthMeasure,
            expected: noteFields(pair.truth),
            generated: noteFields(pair.generated),
            onsetDiffQuarters: pair.onsetDiffQuarters,
            pitchDeltaSemitones: pair.pitchDeltaSemitones,
            source: 'event-match',
          }),
        )
      }
    }

    for (const note of matched.missing) {
      if (note.isRest) continue
      rows.push(
        attachDiag({
          fixture: fixtureId,
          code: 'missing-note',
          measure: truthMeasure,
          expected: noteFields(note),
          generated: null,
          source: 'event-match',
        }),
      )
    }
    for (const note of matched.extra) {
      if (note.isRest) continue
      rows.push(
        attachDiag({
          fixture: fixtureId,
          code: 'extra-note',
          measure: truthMeasure,
          expected: null,
          generated: noteFields(note),
          source: 'event-match',
        }),
      )
    }

    for (const example of chords.examples ?? []) {
      const expectedChordMidis = example.truth ?? []
      const generatedChordMidis = example.generated ?? []
      rows.push(
        attachDiag({
          fixture: fixtureId,
          code: 'incorrect-chord',
          measure: truthMeasure,
          expected: null,
          generated: null,
          expectedChordMidis,
          generatedChordMidis,
          expectedPitches: expectedChordMidis.map(midiToLabel),
          generatedPitches: generatedChordMidis.map(midiToLabel),
          expectedOnset: example.onsetQuarters ?? null,
          generatedOnset: example.generatedOnsetQuarters ?? null,
          onsetDiffQuarters:
            example.onsetQuarters != null && example.generatedOnsetQuarters != null
              ? example.generatedOnsetQuarters - example.onsetQuarters
              : null,
          source: 'chord-integrity',
          pitchOnlyMasquerade:
            expectedChordMidis.length === generatedChordMidis.length &&
            expectedChordMidis.every(
              (midi, index) =>
                Number.isFinite(midi) &&
                Number.isFinite(generatedChordMidis[index]) &&
                Math.abs(midi - generatedChordMidis[index]) <= 1,
            ),
        }),
      )
    }
  }

  return rows.filter((row) => FOCUS_CODES.has(row.code))
}

function summarize(rows) {
  const byCode = {}
  const byCluster = {}
  const byFixture = {}
  const byFixtureCluster = {}
  for (const row of rows) {
    byCode[row.code] = (byCode[row.code] ?? 0) + 1
    byCluster[row.cluster] = (byCluster[row.cluster] ?? 0) + 1
    byFixture[row.fixture] = (byFixture[row.fixture] ?? 0) + 1
    const key = `${row.fixture}::${row.cluster}`
    byFixtureCluster[key] = (byFixtureCluster[key] ?? 0) + 1
  }
  return { byCode, byCluster, byFixture, byFixtureCluster, total: rows.length }
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((path) =>
    path.startsWith('~/') || path.startsWith('/') ? expandHome(path) : join(ROOT, path),
  )
  // Always include local fixtures root
  if (!roots.includes(join(ROOT, 'benchmarks/omr-fixtures'))) {
    roots.unshift(join(ROOT, 'benchmarks/omr-fixtures'))
  }
  const fixtures = (manifest.fixtures ?? []).filter((fixture) => {
    if (!fixture.truth || !fixture.pdf) return false
    if (fixture.expectedRejectionCodes) return false
    if (!fixture.thresholds) return false
    if (String(fixture.tier ?? '').startsWith('real-')) return false
    if (String(fixture.tier ?? '').startsWith('legacy')) return false
    return true
  })
  return { fixtures, roots }
}

async function main() {
  const only = (process.env.ONLY_FIXTURE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const { fixtures, roots } = loadFixtures()
  const selected = only.length
    ? fixtures.filter((fixture) => only.includes(fixture.id))
    : fixtures

  const allRows = []
  const results = []

  for (const fixture of selected) {
    const pdfPath = resolveFixturePath(fixture.pdf, roots)
    const truthPath = resolveFixturePath(fixture.truth, roots)
    process.stderr.write(`Inventory ${fixture.id}...\n`)
    if (!pdfPath || !truthPath) {
      results.push({ id: fixture.id, ok: false, error: 'missing files' })
      continue
    }
    try {
      const rendered = await renderPdfToPages(pdfPath, {
        rootDir: ROOT,
        maxPages: fixture.maxPages ?? 4,
      })
      const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
      const omr = await runPdfOmrPipeline(pdfPath, {
        renderPage: makeRenderPageCallback(rendered.pages),
        extractPageText,
        numPages: rendered.numPages,
        maxPages: fixture.maxPages ?? 4,
        preprocessPages: true,
        instrumentId: fixture.instrumentId ?? 'piano',
        title: fixture.id,
      })
      if (!omr?.musicXml) {
        results.push({ id: fixture.id, ok: false, error: 'no MusicXML' })
        continue
      }
      writeFileSync(join(OUT, 'generated', `${fixture.id}.musicxml`), omr.musicXml)
      const omrByMeasure = indexOmrMeasures(omr)
      writeFileSync(
        join(OUT, 'diagnostics', `${fixture.id}.chord-diag.json`),
        JSON.stringify(
          {
            measures: [...omrByMeasure.entries()].map(([measureNumber, value]) => ({
              measureNumber,
              ...value,
              events: (value.events ?? []).map((event) => ({
                startDivision: event.startDivision,
                durationDivisions: event.durationDivisions,
                denseChordOnsetResnapped: event.denseChordOnsetResnapped ?? false,
                noteCount: event.notes?.length ?? 0,
                midis: (event.notes ?? []).map((note) => note.midi),
                cxs: (event.notes ?? []).map((note) => note.cx),
                stemDirections: (event.notes ?? []).map((note) => note.stemDirection),
                voices: (event.notes ?? []).map((note) => note.voice),
                candidateIds: (event.notes ?? []).map(
                  (note) => note.candidateId ?? note.symbolId ?? note.id ?? null,
                ),
              })),
            })),
          },
          null,
          2,
        ),
      )

      const truthXml = await readScoreXml(truthPath)
      const report = evaluateSemanticMusicXml({
        groundTruthMusicXml: truthXml,
        generatedMusicXml: omr.musicXml,
        groundTruthFileName: basename(truthPath),
        generatedFileName: `${fixture.id}.omr.musicxml`,
        options: { mode: 'written' },
        meta: { gitCommit: gitCommit() },
      })
      const rows = collectStructuredMismatches(
        fixture.id,
        truthXml,
        omr.musicXml,
        omrByMeasure,
        { mode: 'written' },
      )
      allRows.push(...rows)
      results.push({
        id: fixture.id,
        ok: true,
        overall: report.overall?.percent ?? null,
        classes: report.classes ?? null,
        focusCounts: {
          'incorrect-chord': rows.filter((row) => row.code === 'incorrect-chord').length,
          'missing-note': rows.filter((row) => row.code === 'missing-note').length,
          'extra-note': rows.filter((row) => row.code === 'extra-note').length,
          'onset-mismatch': rows.filter((row) => row.code === 'onset-mismatch').length,
        },
        fragmentedMeasures: [...omrByMeasure.values()].filter(
          (measure) => measure.chordDiagnostics?.fragmentedSameClef,
        ).length,
        duplicateOwnershipMeasures: [...omrByMeasure.values()].filter(
          (measure) => (measure.duplicateOwnershipCount ?? 0) > 0,
        ).length,
      })
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }

  const summary = summarize(allRows)
  const payload = {
    kind: 'chord-onset-mismatch-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    summary,
    results,
    rows: allRows,
  }
  writeFileSync(join(OUT, 'mismatches.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'cluster-stats.json'), `${JSON.stringify(summary, null, 2)}\n`)

  const csvHeader = [
    'fixture',
    'code',
    'cluster',
    'measure',
    'page',
    'staff',
    'voice',
    'expectedOnset',
    'generatedOnset',
    'onsetDiff',
    'expectedPitch',
    'generatedPitch',
    'expectedChord',
    'generatedChord',
    'fragmentedSameClef',
    'sequentialSameXCount',
    'duplicateOwnershipCount',
  ]
  const esc = (value) => {
    const text = value == null ? '' : String(value)
    return /["',\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const csvLines = [
    csvHeader.join(','),
    ...allRows.map((row) =>
      [
        row.fixture,
        row.code,
        row.cluster,
        row.measure,
        row.page,
        row.expected?.staff ?? row.generated?.staff ?? '',
        row.expected?.voice ?? row.generated?.voice ?? '',
        row.expectedOnset ?? row.expected?.onsetQuarters ?? '',
        row.generatedOnset ?? row.generated?.onsetQuarters ?? '',
        row.onsetDiffQuarters ?? '',
        row.expected?.label ?? '',
        row.generated?.label ?? '',
        (row.expectedPitches ?? []).join(' '),
        (row.generatedPitches ?? []).join(' '),
        row.fragmentedSameClef,
        row.sequentialSameXCount,
        row.duplicateOwnershipCount,
      ]
        .map(esc)
        .join(','),
    ),
  ]
  writeFileSync(join(OUT, 'mismatches.csv'), `${csvLines.join('\n')}\n`)
  console.log(JSON.stringify({ summary, results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
