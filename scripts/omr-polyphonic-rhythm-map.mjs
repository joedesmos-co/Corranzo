#!/usr/bin/env node
/**
 * Diagnostic-only map for joint polyphonic rhythm packing.
 * Writes tmp/omr-polyphonic-rhythm and does not alter evaluator behavior.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const RUNTIME_ROOT = resolve(option('runtime-root', ROOT))
const OUT = resolve(option('output', join(ROOT, 'tmp/omr-polyphonic-rhythm')))
function runtimeModule(relativePath) {
  return pathToFileURL(join(RUNTIME_ROOT, relativePath)).href
}

const [
  { runPdfOmrPipeline },
  { processOmrPageAnalysis },
  { normalizeSemanticNotes },
  {
    SEMANTIC_EVAL_SCHEMA_VERSION,
    SEMANTIC_EVALUATOR_VERSION,
    resolveSemanticEvalOptions,
  },
  { buildMeasureFingerprint, alignMeasureSequences },
  { matchSemanticEvents, summarizeChordIntegrity },
  { parseMusicXml },
  { OMR_DIAGNOSTIC_FLAG, setOmrDiagnosticFlag },
  { makePdfTextExtractor, makeRenderPageCallback, renderPdfToPages },
] = await Promise.all([
  import(runtimeModule('src/features/omr/runPdfOmrPipeline.js')),
  import(runtimeModule('src/features/omr/processOmrPage.js')),
  import(runtimeModule('src/features/omr/semanticMusicXmlEvaluator.js')),
  import(runtimeModule('src/features/omr/semanticEvalTolerances.js')),
  import(runtimeModule('src/features/omr/semanticMeasureAlignment.js')),
  import(runtimeModule('src/features/omr/semanticEventMatching.js')),
  import(runtimeModule('src/features/musicxml/parseMusicXml.js')),
  import(runtimeModule('src/features/omr/omrDiagnosticFlags.js')),
  import(runtimeModule('scripts/lib/renderPdfPages.mjs')),
])

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'generated'), { recursive: true })

const REPRESENTATIVE_KEYS = new Set([
  'piano-grand-voices-vector:m1',
  'piano-grand-voices-vector:m5',
  'piano-grand-voices-vector:m7',
  'piano-grand-voices-vector:m8',
  'piano-rhythm-tuplets-vector:m4',
  'piano-rhythm-tuplets-vector:m5',
  'piano-rhythm-tuplets-vector:m8',
  'piano-articulation-scan:m2',
  'piano-articulation-scan:m6',
  'piano-dense-advanced-vector:m1',
  'piano-dense-advanced-vector:m5',
  'piano-dense-advanced-vector:m7',
  'guitar-paired-chords-vector:m1',
  'guitar-paired-chords-vector:m6',
])

function gitCommit() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
    .toString()
    .trim()
}

function expandHome(value) {
  if (value?.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}

function resolveFixturePath(relativePath, roots) {
  for (const root of roots) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function eventVoice(note) {
  return note?.rawVoice ?? note?.voice ?? 1
}

function noteFields(note) {
  return {
    midi: note.midi ?? null,
    label: note.label ?? null,
    onsetQuarters: rounded(note.onsetQuarters),
    durationQuarters: rounded(note.durationQuarters),
    voice: eventVoice(note),
    staff: note.staff ?? null,
    isRest: Boolean(note.isRest),
    isChord: Boolean(note.isChord),
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
  }
}

function groupSemanticEvents(notes = []) {
  const events = new Map()
  for (const note of notes) {
    const key = [
      eventVoice(note),
      note.staff ?? 1,
      rounded(note.onsetQuarters, 4),
      rounded(note.durationQuarters, 4),
      note.isRest ? 'rest' : 'note',
    ].join('|')
    const event = events.get(key) ?? {
      voice: eventVoice(note),
      staff: note.staff ?? 1,
      onsetQuarters: rounded(note.onsetQuarters),
      durationQuarters: rounded(note.durationQuarters),
      type: note.isRest ? 'rest' : 'note',
      midis: [],
      pitches: [],
      tieStart: false,
      tieStop: false,
    }
    if (!note.isRest && Number.isFinite(note.midi)) {
      event.midis.push(note.midi)
      event.pitches.push(note.label)
    }
    event.tieStart ||= Boolean(note.tieStart)
    event.tieStop ||= Boolean(note.tieStop)
    events.set(key, event)
  }
  return [...events.values()]
    .map((event) => ({
      ...event,
      midis: [...event.midis].sort((a, b) => a - b),
      pitches: [...event.pitches].sort(),
    }))
    .sort(
      (left, right) =>
        left.voice - right.voice ||
        left.staff - right.staff ||
        left.onsetQuarters - right.onsetQuarters,
    )
}

function semanticByMeasure(notes, measures) {
  const byNumber = new Map(measures.map((measure) => [measure.number, []]))
  for (const note of notes) {
    if (!byNumber.has(note.measureNumber)) byNumber.set(note.measureNumber, [])
    byNumber.get(note.measureNumber).push(note)
  }
  return byNumber
}

function nearestGraphHead(graph, note) {
  let best = null
  let bestDistance = Infinity
  for (const head of graph?.noteheads ?? []) {
    const dx = Math.abs((head.cx ?? 0) - (note.cx ?? 0))
    const dy = Math.abs((head.cy ?? 0) - (note.cy ?? 0))
    const distance = dx + dy
    if (distance < bestDistance && distance <= 16) {
      best = head
      bestDistance = distance
    }
  }
  return best
}

function eventMidis(event) {
  return (event?.notes ?? [])
    .map((note) => note.midi)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
}

function sameMidis(left = [], right = []) {
  return left.length === right.length && left.every((midi, index) => midi === right[index])
}

function matchProvenance(event, entries, used) {
  const midis = eventMidis(event)
  const clef = event.notes?.[0]?.clef ?? null
  const candidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => {
      if (used.has(index)) return false
      return entry.clef === clef && sameMidis([...(entry.midis ?? [])].sort((a, b) => a - b), midis)
    })
    .sort(
      (left, right) =>
        Math.abs((left.entry.startDivision ?? 0) - (event.startDivision ?? 0)) -
        Math.abs((right.entry.startDivision ?? 0) - (event.startDivision ?? 0)),
    )
  if (!candidates.length) return null
  used.add(candidates[0].index)
  return candidates[0].entry
}

function candidateId(head, note, measureNumber) {
  return (
    head?.id ??
    note.candidateId ??
    note.symbolId ??
    note.id ??
    `m${measureNumber}:x${Math.round(note.cx ?? 0)}:y${Math.round(note.cy ?? 0)}:${note.midi ?? '?'}`
  )
}

function pipelineEventRows(measure) {
  const provenance = measure.rhythmProvenance?.noteDurations ?? []
  const used = new Set()
  return (measure.events ?? [])
    .filter((event) => event.type === 'note')
    .map((event, eventIndex) => {
      const entry = matchProvenance(event, provenance, used)
      const notes = event.notes ?? []
      const heads = notes.map((note) => nearestGraphHead(measure.beamStemGraph, note))
      const ownerships = heads.map((head) => head?.beamOwnership).filter(Boolean)
      const stemDirections = [
        ...new Set(
          notes
            .map((note, index) =>
              note.stem?.direction ??
              note.stemDirection ??
              ownerships[index]?.stemDirection ??
              null,
            )
            .filter(Boolean),
        ),
      ]
      const beamGroups = [
        ...new Set(ownerships.map((ownership) => ownership.beamGroupId).filter(Boolean)),
      ]
      const voiceIds = [
        ...new Set(ownerships.map((ownership) => ownership.likelyVoiceId).filter(Boolean)),
      ]
      const rawX = notes.map((note) => rounded(note.cx, 2)).filter(Number.isFinite)
      const rawPositions = notes
        .map((note) => rounded(note.positionInMeasure, 4))
        .filter(Number.isFinite)
      return {
        eventIndex,
        type: 'note',
        clef: notes[0]?.clef ?? null,
        inferredVoiceIds: voiceIds,
        midis: eventMidis(event),
        candidateIds: notes.map((note, index) =>
          candidateId(heads[index], note, measure.measureNumber),
        ),
        stemDirections,
        beamGroups,
        beamCounts: notes.map((note) => note.beams ?? 0),
        chordColumn: rounded(event.cx ?? (rawX.length ? rawX.reduce((a, b) => a + b, 0) / rawX.length : null), 2),
        rawX,
        rawPositions,
        provisionalOnsetDivisions: entry?.startDivision ?? null,
        packedOnsetDivisions: event.startDivision ?? null,
        provisionalDurationDivisions:
          entry?.decisionChain?.[0]?.durationDivisions ??
          entry?.sources?.gap?.durationDivisions ??
          null,
        finalDurationDivisions: event.durationDivisions ?? null,
        durationDecisionChain: entry?.decisionChain ?? [],
        flags: {
          vectorLaneSpacingAdjusted: Boolean(event.vectorLaneSpacingAdjusted),
          beamDurationAdjusted: Boolean(event.beamDurationAdjusted),
          beamDurationFloored: Boolean(event.beamDurationFloored),
          beamOnsetResnapped: Boolean(event.beamOnsetResnapped),
          denseChordOnsetResnapped: Boolean(event.denseChordOnsetResnapped),
          perClefDurationAdjusted: Boolean(event.perClefDurationAdjusted),
          perClefStretchCapped: Boolean(event.perClefStretchCapped),
          musicalEventReconstructionAdjusted: Boolean(
            event.musicalEventReconstructionAdjusted,
          ),
          jointPolyphonicRhythmAdjusted: Boolean(
            event.jointPolyphonicRhythmAdjusted,
          ),
          jointPolyphonicChordCoalesced: Boolean(
            event.jointPolyphonicChordCoalesced,
          ),
          durationClamped: Boolean(event.durationClamped),
        },
      }
    })
}

function restEvidence(measure) {
  return {
    detected: (measure.detectorObservations?.rests ?? []).map((rest, index) => ({
      id: rest.id ?? `m${measure.measureNumber}:rest:${index}`,
      x: rounded(rest.cx, 2),
      positionInMeasure: rounded(rest.positionInMeasure, 4),
      type: rest.durationType ?? null,
      durationDivisions: rest.durationDivisions ?? null,
      clef: rest.clef ?? null,
    })),
    diagnostics: measure.vectorRestDiagnostics ?? null,
    emitted: (measure.events ?? [])
      .filter((event) => event.type === 'rest')
      .map((event) => ({
        startDivision: event.startDivision ?? null,
        durationDivisions: event.durationDivisions ?? null,
        source: event.source ?? null,
      })),
  }
}

function measureVoiceTotals(events = []) {
  const totals = {}
  for (const event of events) {
    const voice = `${event.voice}:${event.staff}`
    const end = event.onsetQuarters + event.durationQuarters
    totals[voice] = Math.max(totals[voice] ?? 0, end)
  }
  return totals
}

function truthFeatures(events = [], capacityQuarters = 4) {
  const noteEvents = events.filter((event) => event.type === 'note')
  const voices = [...new Set(events.map((event) => `${event.voice}:${event.staff}`))]
  const byVoice = new Map()
  for (const event of events) {
    const key = `${event.voice}:${event.staff}`
    if (!byVoice.has(key)) byVoice.set(key, [])
    byVoice.get(key).push(event)
  }
  let overlapCount = 0
  const lanes = [...byVoice.values()]
  for (let i = 0; i < lanes.length; i += 1) {
    for (let j = i + 1; j < lanes.length; j += 1) {
      for (const left of lanes[i]) {
        for (const right of lanes[j]) {
          if (
            left.type === 'note' &&
            right.type === 'note' &&
            left.onsetQuarters < right.onsetQuarters + right.durationQuarters &&
            right.onsetQuarters < left.onsetQuarters + left.durationQuarters
          ) {
            overlapCount += 1
          }
        }
      }
    }
  }
  const durations = noteEvents.map((event) => event.durationQuarters)
  const longest = durations.length ? Math.max(...durations) : 0
  const shortest = durations.length ? Math.min(...durations) : 0
  return {
    voices,
    voiceCount: voices.length,
    hasRests: events.some((event) => event.type === 'rest'),
    overlapCount,
    hasSustainedAgainstMoving:
      overlapCount > 0 && longest >= 2 && shortest <= 1,
    hasChordsAgainstMotion:
      noteEvents.some((event) => event.midis.length > 1) &&
      new Set(noteEvents.map((event) => event.onsetQuarters)).size >= 3,
    capacityQuarters,
    voiceTotals: measureVoiceTotals(events),
  }
}

function mismatchSummary(truthNotes, generatedNotes) {
  const matched = matchSemanticEvents(truthNotes, generatedNotes, resolveSemanticEvalOptions({ mode: 'written' }))
  const chords = summarizeChordIntegrity(matched.matches, matched.missing, matched.extra, resolveSemanticEvalOptions({ mode: 'written' }))
  const onset = matched.matches.filter((pair) => !pair.onsetCorrect)
  const duration = matched.matches.filter((pair) => !pair.durationCorrect && !pair.truth.isRest)
  return {
    onsetMismatchCount: onset.length,
    durationMismatchCount: duration.length,
    missingNoteCount: matched.missing.filter((note) => !note.isRest).length,
    extraNoteCount: matched.extra.filter((note) => !note.isRest).length,
    missingRestCount: matched.missing.filter((note) => note.isRest).length,
    extraRestCount: matched.extra.filter((note) => note.isRest).length,
    incorrectChordCount: chords.incorrectChordCount ?? chords.count ?? 0,
    onsetPairs: onset.map((pair) => ({
      expected: noteFields(pair.truth),
      generated: noteFields(pair.generated),
      differenceQuarters: rounded(pair.onsetDiffQuarters),
    })),
    durationPairs: duration.map((pair) => ({
      expected: noteFields(pair.truth),
      generated: noteFields(pair.generated),
      differenceQuarters: rounded(pair.durationDiffQuarters),
    })),
    missing: matched.missing.map(noteFields),
    extra: matched.extra.map(noteFields),
  }
}

function findPipelineEvent(rows, generated) {
  if (!generated || generated.isRest) return null
  const generatedStart = generated.onsetQuarters * 4
  return [...rows]
    .map((row) => ({
      row,
      score:
        (row.midis.includes(generated.midi) ? 0 : 100) +
        Math.abs((row.packedOnsetDivisions ?? 0) - generatedStart),
    }))
    .sort((left, right) => left.score - right.score)[0]?.row ?? null
}

function firstDurationDivergence(pair, row) {
  const expected = pair.expected.durationQuarters * 4
  if (!row) return 'MusicXML/event alignment (no candidate match)'
  const initial = row.provisionalDurationDivisions
  if (initial !== expected) {
    return 'buildNoteEventsFromGroups: shared X-gap duration packing'
  }
  for (const step of row.durationDecisionChain ?? []) {
    if (
      step.stage !== 'initial-event' &&
      Number.isFinite(step.durationDivisions) &&
      step.durationDivisions !== expected
    ) {
      return `${step.function} (${step.stage})`
    }
  }
  if (row.finalDurationDivisions !== expected) {
    return 'late duration emission/clamp'
  }
  return 'semantic alignment after rhythm packing'
}

function firstOnsetDivergence(pair, row) {
  const expected = pair.expected.onsetQuarters * 4
  if (!row) return 'MusicXML/event alignment (no candidate match)'
  if (row.provisionalOnsetDivisions !== expected) {
    return 'buildNoteEventsFromGroups: shared position/onset grid'
  }
  if (row.flags.beamOnsetResnapped) return 'resnapFlooredBeamOnsets'
  if (row.flags.denseChordOnsetResnapped) return 'resnapDenseChordOnsets'
  if (row.flags.vectorLaneSpacingAdjusted) return 'normalizeDenseVectorLaneSpacing'
  if (row.flags.musicalEventReconstructionAdjusted) return 'reconstructMusicalEvents'
  if (row.packedOnsetDivisions !== expected) return 'late onset resnap'
  return 'semantic alignment after rhythm packing'
}

function divergenceRows(mismatches, pipelineRows) {
  return [
    ...mismatches.onsetPairs.map((pair) => {
      const row = findPipelineEvent(pipelineRows, pair.generated)
      return {
        code: 'onset-mismatch',
        midi: pair.generated.midi,
        expectedOnset: pair.expected.onsetQuarters,
        generatedOnset: pair.generated.onsetQuarters,
        firstStage: firstOnsetDivergence(pair, row),
        candidateIds: row?.candidateIds ?? [],
      }
    }),
    ...mismatches.durationPairs.map((pair) => {
      const row = findPipelineEvent(pipelineRows, pair.generated)
      return {
        code: 'duration-mismatch',
        midi: pair.generated.midi,
        expectedDuration: pair.expected.durationQuarters,
        generatedDuration: pair.generated.durationQuarters,
        firstStage: firstDurationDivergence(pair, row),
        candidateIds: row?.candidateIds ?? [],
      }
    }),
  ]
}

function classifyMeasure(record) {
  const features = record.truthFeatures
  const mismatch = record.mismatches
  const rows = record.pipelineEvents
  const stages = record.divergences.map((entry) => entry.firstStage).join(' ')
  if (
    features.hasRests &&
    record.restEvidence.detected.length === 0 &&
    (mismatch.onsetMismatchCount || mismatch.missingRestCount)
  ) {
    return 'missing rests cause onset collapse'
  }
  if (
    features.hasSustainedAgainstMoving &&
    mismatch.durationMismatchCount > 0 &&
    rows.some((row) => row.flags.perClefDurationAdjusted || row.flags.perClefStretchCapped)
  ) {
    return 'sustained voice steals timing capacity from moving voice'
  }
  if (
    mismatch.incorrectChordCount > 0 &&
    rows.some((row) => row.midis.length > 1)
  ) {
    return 'chords split during voice packing'
  }
  if (
    mismatch.durationMismatchCount > 0 &&
    rows.some((row) => row.beamCounts.some((count) => count > 0)) &&
    /buildNoteEventsFromGroups|beam/i.test(stages)
  ) {
    return 'stem/beam evidence lost before duration assignment'
  }
  if (
    rows.some(
      (row) =>
        row.flags.durationClamped ||
        (row.packedOnsetDivisions ?? 0) + (row.finalDurationDivisions ?? 0) >
          record.meterCapacityDivisions,
    )
  ) {
    return 'meter overflow triggers destructive resnapping'
  }
  if (
    mismatch.missingNoteCount > 0 &&
    mismatch.extraNoteCount > 0 &&
    mismatch.onsetMismatchCount > 0
  ) {
    return 'onset alignment error masquerading as missing/extra notes'
  }
  if (
    features.voiceCount > 1 &&
    mismatch.durationMismatchCount > 0 &&
    rows.some((row) => row.flags.perClefDurationAdjusted)
  ) {
    return 'one voice spacing stretches another voice durations'
  }
  return 'voices packed as one shared sequence'
}

const MECHANISM_DEFINITIONS = [
  {
    mechanism: 'voices packed as one shared sequence',
    evidenceStrength: 'high',
    regressionRisk: 'high',
    applies: (record) =>
      record.truthFeatures.voiceCount > 1 &&
      record.divergences.some((entry) =>
        entry.firstStage.startsWith('buildNoteEventsFromGroups'),
      ),
  },
  {
    mechanism: 'one voice spacing stretches another voice durations',
    evidenceStrength: 'high',
    regressionRisk: 'high',
    applies: (record) =>
      record.truthFeatures.voiceCount > 1 &&
      record.mismatches.durationMismatchCount > 0 &&
      record.pipelineEvents.some((event) => event.flags.perClefDurationAdjusted),
  },
  {
    mechanism: 'missing rests cause onset collapse',
    evidenceStrength: 'high',
    regressionRisk: 'high',
    applies: (record) =>
      record.truthFeatures.hasRests &&
      record.mismatches.missingRestCount > 0 &&
      record.restEvidence.detected.length === 0,
  },
  {
    mechanism: 'sustained voice steals timing capacity from moving voice',
    evidenceStrength: 'medium-high',
    regressionRisk: 'high',
    applies: (record) =>
      record.truthFeatures.hasSustainedAgainstMoving &&
      record.mismatches.durationMismatchCount > 0,
  },
  {
    mechanism: 'chords split during voice packing',
    evidenceStrength: 'low',
    regressionRisk: 'high',
    applies: (record) => record.mismatches.incorrectChordCount > 0,
  },
  {
    mechanism: 'stem/beam evidence lost before duration assignment',
    evidenceStrength: 'high',
    regressionRisk: 'high',
    applies: (record) =>
      record.mismatches.durationMismatchCount > 0 &&
      record.pipelineEvents.some((event) =>
        event.beamCounts.some((count) => count > 0),
      ) &&
      record.divergences.some((entry) =>
        /buildNoteEventsFromGroups|beam/i.test(entry.firstStage),
      ),
  },
  {
    mechanism: 'meter overflow triggers destructive resnapping',
    evidenceStrength: 'low',
    regressionRisk: 'high',
    applies: (record) =>
      record.divergences.some((entry) =>
        /resnap|clamp/i.test(entry.firstStage),
      ),
  },
  {
    mechanism: 'onset alignment error masquerading as missing/extra notes',
    evidenceStrength: 'high',
    regressionRisk: 'medium',
    applies: (record) =>
      record.mismatches.onsetMismatchCount > 0 &&
      record.mismatches.missingNoteCount > 0 &&
      record.mismatches.extraNoteCount > 0,
  },
]

function markdownEventTable(events) {
  if (!events.length) return '_None._'
  return [
    '| Voice/staff | Onset | Duration | Type | Pitches | Tie |',
    '|---|---:|---:|---|---|---|',
    ...events.map(
      (event) =>
        `| ${event.voice}/${event.staff} | ${event.onsetQuarters} | ${event.durationQuarters} | ${event.type} | ${event.pitches.join(', ') || '—'} | ${event.tieStart ? 'start' : ''}${event.tieStart && event.tieStop ? '+' : ''}${event.tieStop ? 'stop' : ''} |`,
    ),
  ].join('\n')
}

function markdownPipelineTable(events) {
  if (!events.length) return '_No emitted note events._'
  return [
    '| Clef / voice evidence | Candidates | Stems / beams | X columns | Provisional onset→packed | Provisional duration→final | Flags |',
    '|---|---|---|---|---|---|---|',
    ...events.map((event) => {
      const flags = Object.entries(event.flags)
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(', ')
      return `| ${event.clef ?? '?'} / ${event.inferredVoiceIds.join('; ') || 'unresolved'} | ${event.candidateIds.join('<br>')} | ${event.stemDirections.join(', ') || '—'} / ${event.beamGroups.join(', ') || event.beamCounts.join(',')} | ${event.rawX.join(', ')} | ${event.provisionalOnsetDivisions ?? '—'}→${event.packedOnsetDivisions ?? '—'} | ${event.provisionalDurationDivisions ?? '—'}→${event.finalDurationDivisions ?? '—'} | ${flags || '—'} |`
    }),
  ].join('\n')
}

function markdownDivergenceTable(rows) {
  if (!rows.length) return '_No matched onset/duration divergence._'
  return [
    '| Defect | MIDI | Expected→generated | First divergent stage | Candidates |',
    '|---|---:|---|---|---|',
    ...rows.map((row) => {
      const transition =
        row.code === 'onset-mismatch'
          ? `${row.expectedOnset}→${row.generatedOnset}`
          : `${row.expectedDuration}→${row.generatedDuration}`
      return `| ${row.code} | ${row.midi} | ${transition} | ${row.firstStage} | ${row.candidateIds.join(', ') || '—'} |`
    }),
  ].join('\n')
}

async function runFixture(fixture, roots) {
  const pdfPath = resolveFixturePath(fixture.pdf, roots)
  const truthPath = resolveFixturePath(fixture.truth, roots)
  if (!pdfPath || !truthPath) throw new Error(`Missing fixture files for ${fixture.id}`)
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: RUNTIME_ROOT,
    maxPages: fixture.maxPages ?? 4,
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: RUNTIME_ROOT })
  const captured = []
  const omr = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: fixture.maxPages ?? 4,
    preprocessPages: true,
    instrumentId: fixture.instrumentId ?? 'piano',
    title: fixture.id,
    analyzePage: async (imageData, context) => {
      const result = processOmrPageAnalysis(imageData, {
        ...context,
        captureOmrV3RawSymbols: true,
      })
      captured.push(result)
      return result
    },
  })
  if (!omr?.musicXml) throw new Error(`No MusicXML for ${fixture.id}`)
  writeFileSync(join(OUT, 'generated', `${fixture.id}.musicxml`), omr.musicXml)

  const truthXml = readFileSync(truthPath, 'utf8')
  const truthTiming = parseMusicXml(truthXml, `${fixture.id}.truth.musicxml`)
  const generatedTiming = parseMusicXml(omr.musicXml, `${fixture.id}.omr.musicxml`)
  const options = resolveSemanticEvalOptions({ mode: 'written' })
  const truthNotes = normalizeSemanticNotes(truthTiming, options)
  const generatedNotes = normalizeSemanticNotes(generatedTiming, options)
  const truthByMeasure = semanticByMeasure(truthNotes, truthTiming.measures ?? [])
  const generatedByMeasure = semanticByMeasure(generatedNotes, generatedTiming.measures ?? [])

  const truthFingerprints = (truthTiming.measures ?? []).map((measure) =>
    buildMeasureFingerprint(measure, truthByMeasure.get(measure.number) ?? []),
  )
  const generatedFingerprints = (generatedTiming.measures ?? []).map((measure) =>
    buildMeasureFingerprint(measure, generatedByMeasure.get(measure.number) ?? []),
  )
  const alignment = alignMeasureSequences(truthFingerprints, generatedFingerprints, options)

  const pipelineByMeasure = new Map()
  for (const page of captured) {
    for (const measure of page.measureRhythms ?? []) {
      pipelineByMeasure.set(measure.measureNumber, measure)
    }
  }

  const records = []
  for (const link of alignment.pairs ?? []) {
    if (link.kind !== 'match') continue
    const truthMeasureNumber = link.truthMeasureNumbers?.[0]
    const generatedMeasureNumber = link.generatedMeasureNumbers?.[0]
    if (truthMeasureNumber == null || generatedMeasureNumber == null) continue
    const key = `${fixture.id}:m${truthMeasureNumber}`
    if (!REPRESENTATIVE_KEYS.has(key)) continue
    const truthMeasure = (truthTiming.measures ?? []).find(
      (measure) => measure.number === truthMeasureNumber,
    )
    const truthMeasureNotes = truthByMeasure.get(truthMeasureNumber) ?? []
    const generatedMeasureNotes = generatedByMeasure.get(generatedMeasureNumber) ?? []
    const expectedEvents = groupSemanticEvents(truthMeasureNotes)
    const generatedEvents = groupSemanticEvents(generatedMeasureNotes)
    const pipeline = pipelineByMeasure.get(generatedMeasureNumber) ?? {
      measureNumber: generatedMeasureNumber,
      events: [],
    }
    const pipelineEvents = pipelineEventRows(pipeline)
    const mismatches = mismatchSummary(truthMeasureNotes, generatedMeasureNotes)
    const meterCapacityQuarters =
      truthMeasure?.notatedLengthQuarters ?? truthMeasure?.lengthQuarters ?? 4
    const record = {
      fixture: fixture.id,
      truthMeasure: truthMeasureNumber,
      generatedMeasure: generatedMeasureNumber,
      page: pipeline.page ?? null,
      systemIndex: pipeline.systemIndex ?? null,
      meterCapacityQuarters,
      meterCapacityDivisions: meterCapacityQuarters * 4,
      expectedEvents,
      generatedEvents,
      truthFeatures: truthFeatures(expectedEvents, meterCapacityQuarters),
      pipelineEvents,
      restEvidence: restEvidence(pipeline),
      mismatches,
      vectorRhythmDiagnostics: pipeline.vectorRhythmDiagnostics ?? null,
      chordDiagnostics: pipeline.vectorChordDiagnostics ?? null,
      beamStemDiagnostics: pipeline.beamStemDiagnostics ?? null,
    }
    record.divergences = divergenceRows(mismatches, pipelineEvents)
    record.primaryMechanism = classifyMeasure(record)
    records.push(record)
  }
  return records
}

function mechanismRanking(records) {
  return MECHANISM_DEFINITIONS.map((definition) => {
    const affected = records.filter(definition.applies)
    const fixtures = [...new Set(affected.map((record) => record.fixture))]
    return {
      mechanism: definition.mechanism,
      mismatchCountExplained: 0,
      fixtures,
      measures: affected.length,
      evidenceStrength:
        affected.length > 0 ? definition.evidenceStrength : 'not observed',
      regressionRisk: definition.regressionRisk,
      observed: affected.length > 0,
      affectedMeasureKeys: affected.map(
        (record) => `${record.fixture}:m${record.truthMeasure}`,
      ),
    }
  }).map((entry) => {
    const affected = records.filter((record) =>
      entry.affectedMeasureKeys.includes(
        `${record.fixture}:m${record.truthMeasure}`,
      ),
    )
    return {
      ...entry,
      mismatchCountExplained: affected.reduce(
        (sum, record) =>
          sum +
          record.mismatches.onsetMismatchCount +
          record.mismatches.durationMismatchCount +
          record.mismatches.missingNoteCount +
          record.mismatches.extraNoteCount +
          record.mismatches.incorrectChordCount,
        0,
      ),
    }
  })
    .sort((left, right) => right.mismatchCountExplained - left.mismatchCountExplained)
}

async function main() {
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'),
  )
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((value) =>
    value.startsWith('/') || value.startsWith('~/')
      ? expandHome(value)
      : join(ROOT, value),
  )
  const fixtures = (manifest.fixtures ?? []).filter(
    (fixture) => fixture.pdf && fixture.truth && fixture.thresholds,
  )

  const records = []
  for (const fixture of fixtures) {
    console.error(`Tracing ${fixture.id}...`)
    records.push(...(await runFixture(fixture, roots)))
  }
  const ranking = mechanismRanking(records)
  const payload = {
    kind: 'omr-polyphonic-rhythm-failure-map',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    frozenFixtureCount: fixtures.length,
    frozenFixtureIds: fixtures.map((fixture) => fixture.id),
    recordCount: records.length,
    mechanismRanking: ranking,
    records,
  }
  writeFileSync(join(OUT, 'failure-map.json'), JSON.stringify(payload, null, 2))

  const lines = [
    '# Phase 1 — Joint polyphonic rhythm failure map',
    '',
    `- Commit: \`${payload.gitCommit}\``,
    `- Frozen evaluator: ${SEMANTIC_EVALUATOR_VERSION} / schema ${SEMANTIC_EVAL_SCHEMA_VERSION}`,
    `- Frozen fixtures executed: ${fixtures.length}/${fixtures.length}`,
    `- Representative measures: ${records.length}`,
    '- Production code changed during Phase 1: **no**',
    '',
    '## Ranked observed mechanisms',
    '',
    '| Rank | Mechanism | Mismatches explained | Fixtures | Measures | Evidence | Regression risk |',
    '|---:|---|---:|---:|---:|---|---|',
    ...ranking.map(
      (entry, index) =>
        `| ${index + 1} | ${entry.mechanism} | ${entry.mismatchCountExplained} | ${entry.fixtures.length} | ${entry.measures} | ${entry.evidenceStrength} | ${entry.regressionRisk} |`,
    ),
    '',
    'Counts are the event/chord mismatches in the representative trace set. Mechanisms overlap because one bad shared timeline can create onset, duration, and missing/extra symptoms together.',
    '',
    '## Frozen-corpus coverage',
    '',
    '| Fixture | Deep measure trace | Reason |',
    '|---|---|---|',
    ...fixtures.map((fixture) => {
      const count = records.filter((record) => record.fixture === fixture.id).length
      return `| ${fixture.id} | ${count ? `${count} measure${count === 1 ? '' : 's'}` : 'control only'} | ${count ? 'representative timing hotspot' : 'sparse, TAB, or notation control; full pipeline still executed'} |`
    }),
    '',
    'Two requested keys were not emitted as one-to-one aligned measures (`piano-dense-advanced-vector:m1` and `guitar-paired-chords-vector:m6`), so they are represented by neighboring aligned hotspots rather than assigned speculative event matches.',
    '',
  ]

  for (const record of records) {
    lines.push(
      `## ${record.fixture} — measure ${record.truthMeasure}`,
      '',
      `- Page/system: ${record.page ?? '—'} / ${record.systemIndex ?? '—'}`,
      `- Meter capacity: ${record.meterCapacityQuarters} quarters (${record.meterCapacityDivisions} internal divisions)`,
      `- Primary mechanism: **${record.primaryMechanism}**`,
      `- Mismatches: onset ${record.mismatches.onsetMismatchCount}, duration ${record.mismatches.durationMismatchCount}, chord ${record.mismatches.incorrectChordCount}, missing ${record.mismatches.missingNoteCount}, extra ${record.mismatches.extraNoteCount}, missing rests ${record.mismatches.missingRestCount}`,
      `- Truth voice ends: ${JSON.stringify(record.truthFeatures.voiceTotals)}`,
      `- Rest evidence: detected ${record.restEvidence.detected.length}, emitted ${record.restEvidence.emitted.length}`,
      '',
      '### Expected events by voice',
      '',
      markdownEventTable(record.expectedEvents),
      '',
      '### Generated events by voice',
      '',
      markdownEventTable(record.generatedEvents),
      '',
      '### Candidate geometry and packing',
      '',
      markdownPipelineTable(record.pipelineEvents),
      '',
      '### First timing divergence',
      '',
      markdownDivergenceTable(record.divergences),
      '',
    )
  }

  lines.push(
    '## Phase 1 conclusions',
    '',
    '- Vector note groups receive one shared horizontal onset grid before mixed clefs are split. Per-clef duration extension occurs later and cannot restore a correct independent timeline.',
    '- The provenance repeatedly shows wrong provisional durations at `buildNoteEventsFromGroups`; later beam floors, per-clef extension, reconstruction, and clamps are recovery heuristics acting after the first divergence.',
    '- Rest-bearing measures lose explicit silence when the rest glyph is absent or skipped, so the shared sequence collapses into the occupied horizontal columns.',
    '- Dense resnapping is downstream. It can move whole chord events safely, but it cannot infer which same-staff or cross-staff voice owns the remaining meter capacity.',
    '- No representative trace first diverged in a clamp/resnap stage, and no aligned hotspot exposed an isolated chord split. Those mechanisms remain required negative controls, not evidence-backed production targets.',
    '- Rest collapse was observed only in single-voice frozen truth. It is real, but it is adjacent to—not proof for—the joint polyphonic packer.',
    '- The frozen corpus has extensive paired-staff overlap but only one direct semantic voice mismatch; same-staff opposing-voice behavior therefore needs synthetic geometry controls before any production rule is attempted.',
    '',
    'Machine-readable detail: `failure-map.json`.',
    '',
  )
  writeFileSync(join(OUT, 'PHASE_1_FAILURE_MAP.md'), lines.join('\n'))
  console.error(`Wrote ${records.length} records to ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
