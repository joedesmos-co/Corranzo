#!/usr/bin/env node
/**
 * Summarize Beam Ownership Reconstruction diagnostics from saved OMR benchmark
 * reports. Reads JSON reports only; does not run OMR or alter MusicXML.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DENSE_REPORT = 'tmp/omr-benchmark-dashboard/fixtures/dense.json'
const DEFAULT_CLEAN_REPORT = 'tmp/omr-benchmark-dashboard/fixtures/clean.json'
const DEFAULT_OUT_MD = 'tmp/omr-benchmark-iter/beam-ownership1/beam-ownership-diagnostics.md'
const DEFAULT_OUT_JSON = 'tmp/omr-benchmark-iter/beam-ownership1/beam-ownership-diagnostics.json'

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function usage() {
  return [
    'Beam ownership diagnostics report',
    '',
    'Options:',
    '  --dense-report <path>  Dense benchmark JSON report',
    '  --clean-report <path>  Clean benchmark JSON report',
    '  --md <path>            Markdown output path',
    '  --json <path>          JSON output path',
    '  --help                 Show this help',
  ].join('\n')
}

function resolvePath(path) {
  return path.startsWith('/') ? path : join(ROOT, path)
}

function rel(path) {
  return relative(ROOT, path)
}

function readJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${rel(path)}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  return `${(value * 100).toFixed(2)}%`
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function topEntries(object = {}, limit = 12) {
  return Object.entries(object)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
}

function metricSummary(report) {
  return {
    pitchAccuracy: report.metrics?.pitchAccuracy ?? null,
    durationAccuracy: report.metrics?.durationAccuracy ?? null,
    onsetAccuracy: report.metrics?.onsetAccuracy ?? null,
    chordGroupingAccuracy: report.metrics?.chordGroupingAccuracy ?? null,
    generatedNoteCount: report.totals?.generatedNoteCount ?? null,
    generatedMeasureCount: report.totals?.generatedMeasureCount ?? null,
    wrongPitchCount: report.totals?.wrongPitchCount ?? null,
    wrongDurationCount: report.totals?.wrongDurationCount ?? null,
    wrongOnsetCount: report.totals?.wrongOnsetCount ?? null,
    chordMismatchCount: report.totals?.chordMismatchCount ?? null,
  }
}

function requireOwnership(report, label) {
  const beamStem = report.generatedOmrDiagnostics?.beamStemReconstruction
  const ownership = beamStem?.ownership
  if (!ownership) {
    throw new Error(
      `${label} report has no beam ownership diagnostics. Run npm run omr:benchmark-dashboard after the diagnostics build.`,
    )
  }
  return { beamStem, ownership }
}

function compactOwnership(ownership = {}) {
  return {
    noteCount: ownership.noteCount ?? 0,
    notesWithStemDirection: ownership.notesWithStemDirection ?? 0,
    notesWithBeams: ownership.notesWithBeams ?? 0,
    notesWithoutBeams: ownership.notesWithoutBeams ?? 0,
    notesWithBeamGroup: ownership.notesWithBeamGroup ?? 0,
    beamGroupCount: ownership.beamGroupCount ?? 0,
    eventCount: ownership.eventCount ?? 0,
    mixedOwnershipEventCount: ownership.mixedOwnershipEventCount ?? 0,
    splitCandidateEventCount: ownership.splitCandidateEventCount ?? 0,
    splitCandidateNoteCount: ownership.splitCandidateNoteCount ?? 0,
    stemDirections: ownership.stemDirections ?? {},
    voiceRoles: ownership.voiceRoles ?? {},
    mixedOwnershipReasons: ownership.mixedOwnershipReasons ?? {},
    splitCandidateReasons: ownership.splitCandidateReasons ?? {},
  }
}

function compactEvent(event = {}) {
  return {
    measureNumber: event.measureNumber,
    eventIndex: event.eventIndex,
    startDivision: event.startDivision,
    durationDivisions: event.durationDivisions,
    beamedExpectedDivisions: event.beamedExpectedDivisions,
    noteCount: event.noteCount,
    notesWithBeams: event.notesWithBeams,
    notesWithoutBeams: event.notesWithoutBeams,
    stemDirections: event.stemDirections ?? [],
    beamGroupIds: event.beamGroupIds ?? [],
    voiceRoles: event.voiceRoles ?? [],
    reasons: event.reasons ?? [],
    noteheadIds: event.noteheadIds ?? [],
    ownerships: (event.ownerships ?? []).map((ownership) => ({
      noteheadId: ownership.noteheadId,
      staffRole: ownership.staffRole,
      clef: ownership.clef,
      midi: ownership.midi,
      stemDirection: ownership.stemDirection,
      attachedStemId: ownership.attachedStemId,
      attachedBeamIds: ownership.attachedBeamIds,
      beamCount: ownership.beamCount,
      beamLevel: ownership.beamLevel,
      beamGroupId: ownership.beamGroupId,
      likelyVoiceRole: ownership.likelyVoiceRole,
      likelyVoiceId: ownership.likelyVoiceId,
      expectedDivisions: ownership.expectedDivisions,
      confidence: ownership.confidence,
    })),
  }
}

function sampleRows(samples = []) {
  return samples.map((event) => [
    String(event.measureNumber ?? ''),
    String(event.eventIndex ?? ''),
    String(event.startDivision ?? ''),
    String(event.durationDivisions ?? ''),
    String(event.beamedExpectedDivisions ?? ''),
    `${event.notesWithBeams ?? 0}/${event.notesWithoutBeams ?? 0}`,
    (event.stemDirections ?? []).join(', ') || 'none',
    (event.beamGroupIds ?? []).join(', ') || 'none',
    (event.reasons ?? []).join(', '),
  ])
}

function reasonRows(reasons = {}) {
  return topEntries(reasons).map(([reason, count]) => [reason, String(count)])
}

function metricRows(label, metrics) {
  return [
    label,
    formatPercent(metrics.pitchAccuracy),
    formatPercent(metrics.durationAccuracy),
    formatPercent(metrics.onsetAccuracy),
    formatPercent(metrics.chordGroupingAccuracy),
    String(metrics.generatedNoteCount),
    String(metrics.generatedMeasureCount),
    String(metrics.wrongDurationCount),
    String(metrics.wrongOnsetCount),
    String(metrics.chordMismatchCount),
  ]
}

function makeMarkdown(analysis) {
  const dense = analysis.dense
  const clean = analysis.clean
  const ownership = dense.ownership
  const cleanOwnership = clean.ownership
  const splitSampleRows = sampleRows(dense.splitCandidateSamples)
  const mixedSampleRows = sampleRows(dense.mixedOwnershipSamples)

  return [
    '# Beam Ownership Reconstruction Phase 1 Diagnostics',
    '',
    `Generated: ${analysis.generatedAt}`,
    '',
    '## Inputs',
    '',
    `- Dense report: \`${analysis.paths.denseReport}\``,
    `- Clean report: \`${analysis.paths.cleanReport}\``,
    '',
    '## Benchmark guardrail',
    '',
    table(
      [
        'Fixture',
        'Pitch',
        'Duration',
        'Onset',
        'Chord',
        'Notes',
        'Measures',
        'Wrong dur',
        'Wrong onset',
        'Chord mismatch',
      ],
      [
        metricRows('dense', dense.metrics),
        metricRows('clean', clean.metrics),
      ],
    ),
    '',
    'These diagnostics are read-only. They add ownership fields to OMR diagnostics and do not feed MusicXML generation.',
    '',
    '## Dense ownership summary',
    '',
    table(
      ['Measure', 'Value'],
      [
        ['Owned noteheads', String(ownership.noteCount)],
        ['Notes with stem direction', String(ownership.notesWithStemDirection)],
        ['Notes with beams', String(ownership.notesWithBeams)],
        ['Notes without beams', String(ownership.notesWithoutBeams)],
        ['Notes with beam group', String(ownership.notesWithBeamGroup)],
        ['Beam groups', String(ownership.beamGroupCount)],
        ['Note events', String(ownership.eventCount)],
        ['Mixed ownership events', String(ownership.mixedOwnershipEventCount)],
        ['Split-candidate events', String(ownership.splitCandidateEventCount)],
        ['Split-candidate notes', String(ownership.splitCandidateNoteCount)],
        ['Stem attachment rate', formatPercent(dense.beamStem.stemAttachmentRate)],
        ['Beam attachment rate', formatPercent(dense.beamStem.beamAttachmentRate)],
        ['Beam/stem confidence', dense.beamStem.averageConfidence?.toFixed?.(4) ?? 'n/a'],
      ],
    ),
    '',
    '## Clean ownership summary',
    '',
    table(
      ['Measure', 'Value'],
      [
        ['Owned noteheads', String(cleanOwnership.noteCount)],
        ['Notes with stem direction', String(cleanOwnership.notesWithStemDirection)],
        ['Notes with beams', String(cleanOwnership.notesWithBeams)],
        ['Mixed ownership events', String(cleanOwnership.mixedOwnershipEventCount)],
        ['Split-candidate events', String(cleanOwnership.splitCandidateEventCount)],
      ],
    ),
    '',
    '## Dense voice roles',
    '',
    table(['Role', 'Notes'], reasonRows(ownership.voiceRoles)),
    '',
    '## Dense stem directions',
    '',
    table(['Direction', 'Notes'], reasonRows(ownership.stemDirections)),
    '',
    '## Mixed ownership reasons',
    '',
    table(['Reason', 'Events'], reasonRows(ownership.mixedOwnershipReasons)),
    '',
    '## Split candidate reasons',
    '',
    table(['Reason', 'Events'], reasonRows(ownership.splitCandidateReasons)),
    '',
    '## Split candidate samples',
    '',
    splitSampleRows.length
      ? table(
          [
            'Measure',
            'Event',
            'Start',
            'Duration',
            'Beam unit',
            'Beamed/unbeamed',
            'Stem dirs',
            'Beam groups',
            'Reasons',
          ],
          splitSampleRows,
        )
      : 'No split-candidate samples were recorded.',
    '',
    '## Mixed ownership samples',
    '',
    mixedSampleRows.length
      ? table(
          [
            'Measure',
            'Event',
            'Start',
            'Duration',
            'Beam unit',
            'Beamed/unbeamed',
            'Stem dirs',
            'Beam groups',
            'Reasons',
          ],
          mixedSampleRows,
        )
      : 'No mixed ownership samples were recorded.',
    '',
    '## Interpretation',
    '',
    '- The useful signal is no longer just whether an event is beamed. It is whether individual noteheads inside the event have incompatible ownership.',
    '- Split candidates are events where a beamed note has a shorter beam-implied unit than the event duration and the event also contains another ownership class, such as an unbeamed note or different stem direction.',
    '- These cases explain why event-level beam caps regressed: the beam evidence can be correct for one note while the event duration still belongs to a sustained or overlapping voice.',
    '',
    '## Recommended Phase 2 slice',
    '',
    'Use this ownership graph for simulation first, not MusicXML output:',
    '',
    '1. Select only split-candidate events with exactly one beamed ownership group and at least one unbeamed/stemmed sustain note.',
    '2. Require different stem directions or different likely voice ids inside the same event.',
    '3. Keep note count and measure count fixed: simulate splitting the beamed noteheads to the beam-implied duration while preserving the sustained noteheads at the original event duration.',
    '4. Score the simulated events against the evaluator before generating MusicXML.',
    '5. Promote to runtime only if duration improves and onset/chord/pitch stay stable on dense while clean remains unchanged.',
    '',
  ].join('\n')
}

function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage())
    return
  }

  const denseReportPath = resolvePath(argValue(args, '--dense-report') ?? DEFAULT_DENSE_REPORT)
  const cleanReportPath = resolvePath(argValue(args, '--clean-report') ?? DEFAULT_CLEAN_REPORT)
  const mdPath = resolvePath(argValue(args, '--md') ?? DEFAULT_OUT_MD)
  const jsonPath = resolvePath(argValue(args, '--json') ?? DEFAULT_OUT_JSON)

  const denseReport = readJson(denseReportPath, 'dense report')
  const cleanReport = readJson(cleanReportPath, 'clean report')
  const dense = requireOwnership(denseReport, 'dense')
  const clean = requireOwnership(cleanReport, 'clean')

  const analysis = {
    version: 1,
    generatedAt: new Date().toISOString(),
    paths: {
      denseReport: rel(denseReportPath),
      cleanReport: rel(cleanReportPath),
    },
    dense: {
      metrics: metricSummary(denseReport),
      beamStem: {
        stemAttachmentRate: dense.beamStem.stemAttachmentRate,
        beamAttachmentRate: dense.beamStem.beamAttachmentRate,
        averageConfidence: dense.beamStem.averageConfidence,
      },
      ownership: compactOwnership(dense.ownership),
      splitCandidateSamples: (dense.ownership.splitCandidateSamples ?? []).map(compactEvent),
      mixedOwnershipSamples: (dense.ownership.mixedOwnershipSamples ?? []).map(compactEvent),
    },
    clean: {
      metrics: metricSummary(cleanReport),
      beamStem: {
        stemAttachmentRate: clean.beamStem.stemAttachmentRate,
        beamAttachmentRate: clean.beamStem.beamAttachmentRate,
        averageConfidence: clean.beamStem.averageConfidence,
      },
      ownership: compactOwnership(clean.ownership),
      splitCandidateSamples: (clean.ownership.splitCandidateSamples ?? []).map(compactEvent),
      mixedOwnershipSamples: (clean.ownership.mixedOwnershipSamples ?? []).map(compactEvent),
    },
  }

  ensureParent(jsonPath)
  writeFileSync(jsonPath, `${JSON.stringify(analysis, null, 2)}\n`)
  ensureParent(mdPath)
  writeFileSync(mdPath, makeMarkdown(analysis))
  console.log(`Wrote ${rel(jsonPath)}`)
  console.log(`Wrote ${rel(mdPath)}`)
}

main()
