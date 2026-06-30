#!/usr/bin/env node
/**
 * Compare the reverted beam/stem diagnostics baseline with the failed Phase 2
 * beam-duration cap runs. This script reads saved benchmark reports only; it
 * does not run OMR or change runtime output.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  baselineDir: 'tmp/omr-benchmark-iter/beam-stem2-reverted',
  broadDir: 'tmp/omr-benchmark-iter/beam-stem2',
  tightDir: 'tmp/omr-benchmark-iter/beam-stem2-tight',
  outMd: 'tmp/omr-benchmark-iter/beam-stem2/beam-cap-regression-analysis.md',
  outJson: 'tmp/omr-benchmark-iter/beam-stem2/beam-cap-regression-analysis.json',
}

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

function usage() {
  return [
    'Beam/stem cap regression analyzer',
    '',
    'Reads saved OMR benchmark reports and writes a markdown/json diagnosis.',
    '',
    'Options:',
    '  --baseline-dir <dir>   Reverted diagnostics-only report dir',
    '  --broad-dir <dir>      Broad cap failed report dir',
    '  --tight-dir <dir>      Tight cap failed report dir',
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

function readJson(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing report: ${rel(path)}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readReportSet(dir) {
  const fullDir = resolvePath(dir)
  return {
    dir: fullDir,
    clean: readJson(join(fullDir, 'clean.json')),
    dense: readJson(join(fullDir, 'dense.json')),
  }
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`
}

function formatSigned(value, digits = 0) {
  const fixed = digits > 0 ? value.toFixed(digits) : String(value)
  return value > 0 ? `+${fixed}` : fixed
}

function metric(report, name) {
  return report.metrics?.[name] ?? null
}

function total(report, name) {
  return report.totals?.[name] ?? null
}

function metricDelta(after, before, name) {
  const a = metric(after, name)
  const b = metric(before, name)
  return a == null || b == null ? null : a - b
}

function totalDelta(after, before, name) {
  const a = total(after, name)
  const b = total(before, name)
  return a == null || b == null ? null : a - b
}

function compactMetrics(label, baseline, run) {
  return {
    label,
    durationAccuracy: metric(run.dense, 'durationAccuracy'),
    durationAccuracyDelta: metricDelta(run.dense, baseline.dense, 'durationAccuracy'),
    wrongDurationCount: total(run.dense, 'wrongDurationCount'),
    wrongDurationDelta: totalDelta(run.dense, baseline.dense, 'wrongDurationCount'),
    onsetAccuracy: metric(run.dense, 'onsetAccuracy'),
    onsetAccuracyDelta: metricDelta(run.dense, baseline.dense, 'onsetAccuracy'),
    wrongOnsetCount: total(run.dense, 'wrongOnsetCount'),
    wrongOnsetDelta: totalDelta(run.dense, baseline.dense, 'wrongOnsetCount'),
    pitchAccuracy: metric(run.dense, 'pitchAccuracy'),
    pitchAccuracyDelta: metricDelta(run.dense, baseline.dense, 'pitchAccuracy'),
    wrongPitchCount: total(run.dense, 'wrongPitchCount'),
    wrongPitchDelta: totalDelta(run.dense, baseline.dense, 'wrongPitchCount'),
    chordGroupingAccuracy: metric(run.dense, 'chordGroupingAccuracy'),
    chordGroupingDelta: metricDelta(run.dense, baseline.dense, 'chordGroupingAccuracy'),
    chordMismatchCount: total(run.dense, 'chordMismatchCount'),
    chordMismatchDelta: totalDelta(run.dense, baseline.dense, 'chordMismatchCount'),
    generatedNoteCount: total(run.dense, 'generatedNoteCount'),
    generatedNoteDelta: totalDelta(run.dense, baseline.dense, 'generatedNoteCount'),
    generatedMeasureCount: total(run.dense, 'generatedMeasureCount'),
    generatedMeasureDelta: totalDelta(run.dense, baseline.dense, 'generatedMeasureCount'),
    cleanDurationAccuracy: metric(run.clean, 'durationAccuracy'),
    cleanDurationDelta: metricDelta(run.clean, baseline.clean, 'durationAccuracy'),
    cleanWrongDurationCount: total(run.clean, 'wrongDurationCount'),
    cleanWrongDurationDelta: totalDelta(run.clean, baseline.clean, 'wrongDurationCount'),
    cleanPitchAccuracy: metric(run.clean, 'pitchAccuracy'),
    cleanPitchDelta: metricDelta(run.clean, baseline.clean, 'pitchAccuracy'),
    cleanOnsetAccuracy: metric(run.clean, 'onsetAccuracy'),
    cleanOnsetDelta: metricDelta(run.clean, baseline.clean, 'onsetAccuracy'),
    cleanChordAccuracy: metric(run.clean, 'chordGroupingAccuracy'),
    cleanChordDelta: metricDelta(run.clean, baseline.clean, 'chordGroupingAccuracy'),
    cleanGeneratedNoteCount: total(run.clean, 'generatedNoteCount'),
    cleanGeneratedNoteDelta: totalDelta(run.clean, baseline.clean, 'generatedNoteCount'),
  }
}

function perMeasureMap(report) {
  return new Map((report.perMeasure ?? []).map((measure) => [measure.measureNumber, measure]))
}

function allDiagnosticMeasures(report) {
  const result = []
  for (const page of report.generatedOmrDiagnostics?.pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        result.push({
          page: page.page ?? page.pageNumber ?? null,
          systemIndex: system.systemIndex ?? null,
          measureNumber: measure.measureNumber,
          diagnostics: measure,
        })
      }
    }
  }
  return result
}

function correctionByMeasure(report) {
  const map = new Map()
  for (const entry of allDiagnosticMeasures(report)) {
    const correction = entry.diagnostics.beamRhythmCorrections
    if (!correction) continue
    map.set(entry.measureNumber, {
      ...entry,
      correction,
    })
  }
  return map
}

function makeMeasureRows(baselineReport, runReport) {
  const beforeMeasures = perMeasureMap(baselineReport)
  const afterMeasures = perMeasureMap(runReport)
  const corrections = correctionByMeasure(runReport)
  const rows = []

  for (const [measureNumber, entry] of corrections.entries()) {
    const applied = entry.correction.appliedBeamRhythmCorrections ?? 0
    if (applied <= 0) continue

    const before = beforeMeasures.get(measureNumber)
    const after = afterMeasures.get(measureNumber)
    if (!before || !after) continue

    const samples = entry.correction.beamRhythmCorrectionSamples ?? []
    rows.push({
      measureNumber,
      page: entry.page,
      systemIndex: entry.systemIndex,
      appliedCorrections: applied,
      appliedNotes: entry.correction.appliedBeamRhythmCorrectionNotes ?? 0,
      skippedReasons: entry.correction.beamRhythmCorrectionSkippedReasons ?? {},
      samples,
      durationDelta: after.wrongDurationCount - before.wrongDurationCount,
      onsetDelta: after.wrongOnsetCount - before.wrongOnsetCount,
      pitchDelta: after.wrongPitchCount - before.wrongPitchCount,
      chordDelta: after.chordMismatchCount - before.chordMismatchCount,
      errorDelta: after.errorCount - before.errorCount,
      before,
      after,
    })
  }

  return rows.sort((a, b) => a.measureNumber - b.measureNumber)
}

function sum(rows, field) {
  return rows.reduce((totalValue, row) => totalValue + (row[field] ?? 0), 0)
}

function sampleShape(sample) {
  return `${sample.fromDurationDivisions}->${sample.toDurationDivisions}/n${sample.noteCount}`
}

function summarizeMeasureRows(rows) {
  const affected = rows.length
  const improvedDuration = rows.filter((row) => row.durationDelta < 0).length
  const worsenedDuration = rows.filter((row) => row.durationDelta > 0).length
  const unchangedDuration = rows.filter((row) => row.durationDelta === 0).length
  const appliedCorrections = sum(rows, 'appliedCorrections')
  const appliedNotes = sum(rows, 'appliedNotes')

  return {
    affected,
    appliedCorrections,
    appliedNotes,
    improvedDuration,
    worsenedDuration,
    unchangedDuration,
    durationDelta: sum(rows, 'durationDelta'),
    onsetDelta: sum(rows, 'onsetDelta'),
    pitchDelta: sum(rows, 'pitchDelta'),
    chordDelta: sum(rows, 'chordDelta'),
    errorDelta: sum(rows, 'errorDelta'),
    topWorse: [...rows]
      .sort((a, b) =>
        b.durationDelta - a.durationDelta ||
        b.onsetDelta - a.onsetDelta ||
        b.errorDelta - a.errorDelta ||
        b.appliedNotes - a.appliedNotes,
      )
      .slice(0, 10),
    topBetter: [...rows]
      .sort((a, b) =>
        a.durationDelta - b.durationDelta ||
        a.onsetDelta - b.onsetDelta ||
        a.errorDelta - b.errorDelta ||
        b.appliedNotes - a.appliedNotes,
      )
      .slice(0, 10),
  }
}

function summarizeSampleShapes(rows) {
  const buckets = new Map()
  for (const row of rows) {
    const rowShapes = new Map()
    for (const sample of row.samples) {
      const key = sampleShape(sample)
      rowShapes.set(key, (rowShapes.get(key) ?? 0) + 1)
    }

    for (const [key, sampleCount] of rowShapes.entries()) {
      const bucket = buckets.get(key) ?? {
        key,
        sampleCount: 0,
        measures: new Set(),
        durationDelta: 0,
        onsetDelta: 0,
        pitchDelta: 0,
        chordDelta: 0,
        errorDelta: 0,
      }
      bucket.sampleCount += sampleCount
      bucket.measures.add(row.measureNumber)
      bucket.durationDelta += row.durationDelta
      bucket.onsetDelta += row.onsetDelta
      bucket.pitchDelta += row.pitchDelta
      bucket.chordDelta += row.chordDelta
      bucket.errorDelta += row.errorDelta
      buckets.set(key, bucket)
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      measureCount: bucket.measures.size,
      measures: [...bucket.measures].sort((a, b) => a - b),
    }))
    .sort((a, b) =>
      b.errorDelta - a.errorDelta ||
      b.durationDelta - a.durationDelta ||
      b.sampleCount - a.sampleCount,
    )
}

function categorizeRows(rows) {
  const categories = [
    {
      id: 'near_or_dotted_three_to_two',
      label: '3->2 caps: likely dotted/near-correct beamed notes',
      predicate: (row) => row.samples.some((sample) => sample.fromDurationDivisions === 3),
    },
    {
      id: 'multi_note_event',
      label: 'multi-note event caps: beam belongs to only part of an event',
      predicate: (row) => row.samples.some((sample) => sample.noteCount > 1),
    },
    {
      id: 'long_to_eighth',
      label: 'long-to-eighth caps: likely sustained voice/overlap collapse',
      predicate: (row) => row.samples.some((sample) => sample.fromDurationDivisions >= 6),
    },
    {
      id: 'quarter_to_eighth',
      label: '4->2 caps: quarter-like event shortened to eighth',
      predicate: (row) => row.samples.some((sample) => sample.fromDurationDivisions === 4),
    },
    {
      id: 'single_note_event',
      label: 'single-note event caps',
      predicate: (row) => row.samples.length > 0 && row.samples.every((sample) => sample.noteCount === 1),
    },
  ]

  return categories.map((category) => {
    const matching = rows.filter(category.predicate)
    return {
      id: category.id,
      label: category.label,
      measureCount: matching.length,
      appliedCorrections: sum(matching, 'appliedCorrections'),
      appliedNotes: sum(matching, 'appliedNotes'),
      durationDelta: sum(matching, 'durationDelta'),
      onsetDelta: sum(matching, 'onsetDelta'),
      pitchDelta: sum(matching, 'pitchDelta'),
      chordDelta: sum(matching, 'chordDelta'),
      errorDelta: sum(matching, 'errorDelta'),
      measures: matching.map((row) => row.measureNumber).sort((a, b) => a - b),
    }
  })
}

function aggregateSkipped(report) {
  return report.generatedOmrDiagnostics?.beamRhythmCorrections?.skippedReasons ?? {}
}

function summarizeSkipped(report) {
  const skipped = aggregateSkipped(report)
  return Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))
}

function capSummary(report) {
  const corrections = report.generatedOmrDiagnostics?.beamRhythmCorrections
  if (!corrections) {
    return {
      candidates: 0,
      noteCandidates: 0,
      applied: 0,
      appliedNotes: 0,
      skippedReasons: {},
      samples: [],
    }
  }
  return {
    candidates: corrections.beamRhythmCorrectionCandidates ?? 0,
    noteCandidates: corrections.beamRhythmCorrectionNoteCandidates ?? 0,
    applied: corrections.appliedBeamRhythmCorrections ?? 0,
    appliedNotes: corrections.appliedBeamRhythmCorrectionNotes ?? 0,
    skippedReasons: corrections.skippedReasons ?? {},
    samples: corrections.samples ?? [],
  }
}

function beamStemSummary(report) {
  const beamStem = report.generatedOmrDiagnostics?.beamStemReconstruction ?? {}
  return {
    noteCount: beamStem.noteCount ?? 0,
    stemAttachmentRate: beamStem.stemAttachmentRate ?? 0,
    beamAttachmentRate: beamStem.beamAttachmentRate ?? 0,
    averageConfidence: beamStem.averageConfidence ?? 0,
    disagreementRate: beamStem.disagreementRate ?? 0,
    disagreements: beamStem.disagreements ?? {},
  }
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function metricTableRows(metricSummaries) {
  return metricSummaries.map((entry) => [
    entry.label,
    formatPercent(entry.durationAccuracy),
    formatSigned(entry.wrongDurationDelta),
    formatPercent(entry.onsetAccuracy),
    formatSigned(entry.wrongOnsetDelta),
    formatPercent(entry.pitchAccuracy),
    formatSigned(entry.wrongPitchDelta),
    formatPercent(entry.chordGroupingAccuracy),
    formatSigned(entry.chordMismatchDelta),
    `${entry.generatedNoteCount} (${formatSigned(entry.generatedNoteDelta)})`,
    `${entry.generatedMeasureCount} (${formatSigned(entry.generatedMeasureDelta)})`,
  ])
}

function cleanTableRows(metricSummaries) {
  return metricSummaries.map((entry) => [
    entry.label,
    formatPercent(entry.cleanPitchAccuracy),
    formatSigned(entry.cleanPitchDelta, 4),
    formatPercent(entry.cleanDurationAccuracy),
    formatSigned(entry.cleanDurationDelta, 4),
    formatPercent(entry.cleanOnsetAccuracy),
    formatSigned(entry.cleanOnsetDelta, 4),
    formatPercent(entry.cleanChordAccuracy),
    formatSigned(entry.cleanChordDelta, 4),
    `${entry.cleanGeneratedNoteCount} (${formatSigned(entry.cleanGeneratedNoteDelta)})`,
  ])
}

function measureTableRows(rows) {
  return rows.map((row) => [
    String(row.measureNumber),
    String(row.appliedCorrections),
    String(row.appliedNotes),
    formatSigned(row.durationDelta),
    formatSigned(row.onsetDelta),
    formatSigned(row.pitchDelta),
    formatSigned(row.errorDelta),
    row.samples.map(sampleShape).join(', ') || 'none retained',
  ])
}

function categoryTableRows(categories) {
  return categories.map((category) => [
    category.label,
    String(category.measureCount),
    String(category.appliedCorrections),
    String(category.appliedNotes),
    formatSigned(category.durationDelta),
    formatSigned(category.onsetDelta),
    formatSigned(category.pitchDelta),
    formatSigned(category.errorDelta),
  ])
}

function shapeTableRows(shapes) {
  return shapes.slice(0, 12).map((shape) => [
    shape.key,
    String(shape.sampleCount),
    String(shape.measureCount),
    formatSigned(shape.durationDelta),
    formatSigned(shape.onsetDelta),
    formatSigned(shape.pitchDelta),
    formatSigned(shape.errorDelta),
    shape.measures.slice(0, 12).join(', '),
  ])
}

function skippedTableRows(skipped) {
  return skipped.map(({ reason, count }) => [reason, String(count)])
}

function formatCapSummary(summary) {
  return [
    `candidates=${summary.candidates}`,
    `noteCandidates=${summary.noteCandidates}`,
    `applied=${summary.applied}`,
    `appliedNotes=${summary.appliedNotes}`,
  ].join(', ')
}

function makeMarkdown(analysis) {
  const {
    generatedAt,
    paths,
    metrics,
    cleanUnchanged,
    baselineBeamStem,
    broad,
    tight,
  } = analysis

  return [
    '# Beam/Stem Phase 2 Regression Analysis',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Inputs',
    '',
    `- Baseline/reverted reports: \`${paths.baselineDir}\``,
    `- Broad cap reports: \`${paths.broadDir}\``,
    `- Tight cap reports: \`${paths.tightDir}\``,
    '- Source command requested by handoff: `npm run omr:benchmark-dashboard`',
    '',
    '## Executive summary',
    '',
    'The failed Phase 2 cap runs did not prove that the beam graph is bad at finding ink. They proved that event-level beam duration caps are the wrong abstraction. The beam/stem graph is highly attached to noteheads, but the cap applied one beam-derived duration to an existing musical event. In dense measures, one existing event can contain multiple voices, sustained chord tones, or a beamed attack plus an overhanging note. Shortening that whole event changed written MusicXML timing and sometimes evaluator alignment.',
    '',
    'The broad cap regressed because it converted many near-beam or dotted-looking durations (`3->2`) into plain eighths. The tight cap removed those near/dotted cases, but still regressed because the remaining long-to-eighth caps hit ambiguous events where beam evidence belonged to only one note or voice inside the event.',
    '',
    cleanUnchanged
      ? 'Clean Gymnopedie remained unchanged across the failed runs and the reverted baseline.'
      : 'Warning: clean fixture metrics changed in at least one failed run; inspect clean deltas before any runtime retry.',
    '',
    '## Dense metric comparison',
    '',
    table(
      [
        'Run',
        'Duration',
        'Wrong dur Δ',
        'Onset',
        'Wrong onset Δ',
        'Pitch',
        'Wrong pitch Δ',
        'Chord',
        'Chord mismatch Δ',
        'Notes',
        'Measures',
      ],
      metricTableRows(metrics),
    ),
    '',
    '## Clean metric comparison',
    '',
    table(
      [
        'Run',
        'Pitch',
        'Pitch Δ',
        'Duration',
        'Duration Δ',
        'Onset',
        'Onset Δ',
        'Chord',
        'Chord Δ',
        'Notes',
      ],
      cleanTableRows(metrics),
    ),
    '',
    '## Beam/stem baseline reliability',
    '',
    table(
      ['Measure', 'Value'],
      [
        ['Notes in graph', String(baselineBeamStem.noteCount)],
        ['Stem attachment', formatPercent(baselineBeamStem.stemAttachmentRate)],
        ['Beam attachment', formatPercent(baselineBeamStem.beamAttachmentRate)],
        ['Average confidence', baselineBeamStem.averageConfidence.toFixed(4)],
        ['Disagreement rate', formatPercent(baselineBeamStem.disagreementRate)],
        ['Graph beamed but current long', String(baselineBeamStem.disagreements.graphBeamedButCurrentLong ?? 0)],
        ['Current short without beam graph', String(baselineBeamStem.disagreements.currentShortWithoutBeamGraph ?? 0)],
        ['Current beam probe without graph', String(baselineBeamStem.disagreements.currentBeamProbeWithoutGraph ?? 0)],
      ],
    ),
    '',
    'Interpretation: stem attachment is strong enough to keep investing in beam/stem diagnostics. Beam attachment is partial, and the disagreement rate shows that beams cannot safely overwrite current rhythm until ownership and voice context are explicit.',
    '',
    '## Broad cap failure',
    '',
    `Cap summary: ${formatCapSummary(broad.capSummary)}`,
    '',
    table(['Skipped reason', 'Count'], skippedTableRows(broad.skipped)),
    '',
    table(
      [
        'Affected measures',
        'Improved dur',
        'Worsened dur',
        'Same dur',
        'Dur Δ',
        'Onset Δ',
        'Pitch Δ',
        'Error Δ',
      ],
      [[
        String(broad.measureSummary.affected),
        String(broad.measureSummary.improvedDuration),
        String(broad.measureSummary.worsenedDuration),
        String(broad.measureSummary.unchangedDuration),
        formatSigned(broad.measureSummary.durationDelta),
        formatSigned(broad.measureSummary.onsetDelta),
        formatSigned(broad.measureSummary.pitchDelta),
        formatSigned(broad.measureSummary.errorDelta),
      ]],
    ),
    '',
    'Top broad-cap worsened measures:',
    '',
    table(
      ['Measure', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Retained cap samples'],
      measureTableRows(broad.measureSummary.topWorse),
    ),
    '',
    'Top broad-cap improved measures:',
    '',
    table(
      ['Measure', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Retained cap samples'],
      measureTableRows(broad.measureSummary.topBetter),
    ),
    '',
    'Broad-cap category signals:',
    '',
    table(
      ['Category', 'Measures', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ'],
      categoryTableRows(broad.categories),
    ),
    '',
    'Broad-cap sample shape signals:',
    '',
    table(
      ['Shape', 'Samples', 'Measures', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Measures'],
      shapeTableRows(broad.shapes),
    ),
    '',
    '## Tight cap failure',
    '',
    `Cap summary: ${formatCapSummary(tight.capSummary)}`,
    '',
    table(['Skipped reason', 'Count'], skippedTableRows(tight.skipped)),
    '',
    table(
      [
        'Affected measures',
        'Improved dur',
        'Worsened dur',
        'Same dur',
        'Dur Δ',
        'Onset Δ',
        'Pitch Δ',
        'Error Δ',
      ],
      [[
        String(tight.measureSummary.affected),
        String(tight.measureSummary.improvedDuration),
        String(tight.measureSummary.worsenedDuration),
        String(tight.measureSummary.unchangedDuration),
        formatSigned(tight.measureSummary.durationDelta),
        formatSigned(tight.measureSummary.onsetDelta),
        formatSigned(tight.measureSummary.pitchDelta),
        formatSigned(tight.measureSummary.errorDelta),
      ]],
    ),
    '',
    'Top tight-cap worsened measures:',
    '',
    table(
      ['Measure', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Retained cap samples'],
      measureTableRows(tight.measureSummary.topWorse),
    ),
    '',
    'Top tight-cap improved measures:',
    '',
    table(
      ['Measure', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Retained cap samples'],
      measureTableRows(tight.measureSummary.topBetter),
    ),
    '',
    'Tight-cap category signals:',
    '',
    table(
      ['Category', 'Measures', 'Caps', 'Notes', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ'],
      categoryTableRows(tight.categories),
    ),
    '',
    'Tight-cap sample shape signals:',
    '',
    table(
      ['Shape', 'Samples', 'Measures', 'Dur Δ', 'Onset Δ', 'Pitch Δ', 'Error Δ', 'Measures'],
      shapeTableRows(tight.shapes),
    ),
    '',
    '## Failure categories',
    '',
    '1. Beam evidence correct but duration already handled: both failed runs skipped 429 `not-too-long` candidates. That means current rhythm logic had already shortened many beamed notes to at or below the beam value. The runtime cap mostly targeted the hard residual cases, not the easy wins.',
    '',
    '2. Dotted or near-correct values were flattened: the broad run changed many `3->2` events. Those are visually beamed, but the current duration was often a dotted/near-beam value or part of a local subdivision. Flattening them produced the broad onset regression and increased wrong durations.',
    '',
    '3. Beam belonged to one voice while the existing event represented more than one voice: the diagnostics skipped 48 `mixed-event-has-unbeamed-note` cases, and the top worsened measures include multi-note caps. Event-level caps cannot distinguish a beamed attack from a sustained chord tone or accompaniment voice.',
    '',
    '4. Capping broke sustained/voice overlap: the tight run removed the obvious `3->2` near/dotted cases and still regressed. Its remaining long-to-eighth and quarter-to-eighth caps are exactly the cases where a beamed stem can coexist with a longer sounding or written voice in the current event model.',
    '',
    '5. Evaluator rematching amplified the damage: broad caps did not change note or measure count, but wrong onsets increased. Shortened durations altered the generated timeline enough that the evaluator rematched neighboring notes differently, so some pitch and onset changes are downstream alignment artifacts rather than direct detection changes.',
    '',
    '6. Staff-line or ornament artifacts are not the primary explanation: clean stayed unchanged and stem attachment remained high. Dense false positives may exist, but the dominant failure is ownership of valid beam evidence, not raw visual beam extraction.',
    '',
    '## Extra signal needed before beams affect runtime',
    '',
    '- Stem direction per notehead, not only per event.',
    '- Per-note beam count and beam level, not a single event-level inferred unit.',
    '- Beam group boundaries: start, continue, end, hook, and whether a note shares the same beam span.',
    '- Voice ownership before duration overwrite: a beamed upper voice and a sustained lower voice must be separate rhythmic objects.',
    '- Separate written duration from sounding sustain/playback duration so a short beamed attack does not erase an overhanging note or tied sustain.',
    '- A simulation/evaluator gate that proves a beam-derived edit improves duration without increasing onset/chord errors before it reaches MusicXML.',
    '',
    '## Recommended next safe milestone',
    '',
    'Do not retry event-level beam duration caps. The next safe milestone is diagnostics-only Beam Ownership Reconstruction:',
    '',
    '1. Build per-note `BeamOwnershipCandidate` records: notehead id, stem id, stem direction, beam ids, beam level count, beam group boundary role, and local event id.',
    '2. Compare those candidates against existing musical events to flag event-level conflicts: mixed stem directions, beamed plus unbeamed notes, same event with multiple beam groups, and long-duration notes inside a beamed event.',
    '3. Add an offline simulation report that predicts a per-note or per-voice split but does not write MusicXML.',
    '4. Only after the simulation improves dense duration without onset/chord regression should runtime MusicXML generation consume the beam graph.',
    '',
    'This keeps the reliable Phase 1 extraction work, but moves the next benchmark bet from duration capping to voice-safe beam ownership.',
    '',
  ].join('\n')
}

function analyzeRun(label, baseline, run) {
  const rows = makeMeasureRows(baseline.dense, run.dense)
  return {
    label,
    capSummary: capSummary(run.dense),
    skipped: summarizeSkipped(run.dense),
    measureRows: rows,
    measureSummary: summarizeMeasureRows(rows),
    categories: categorizeRows(rows),
    shapes: summarizeSampleShapes(rows),
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(usage())
    return
  }

  const baselineDir = argValue(args, '--baseline-dir') ?? DEFAULTS.baselineDir
  const broadDir = argValue(args, '--broad-dir') ?? DEFAULTS.broadDir
  const tightDir = argValue(args, '--tight-dir') ?? DEFAULTS.tightDir
  const outMd = resolvePath(argValue(args, '--md') ?? DEFAULTS.outMd)
  const outJson = resolvePath(argValue(args, '--json') ?? DEFAULTS.outJson)

  const baseline = readReportSet(baselineDir)
  const broad = readReportSet(broadDir)
  const tight = readReportSet(tightDir)

  const metrics = [
    compactMetrics('Reverted baseline', baseline, baseline),
    compactMetrics('Broad cap', baseline, broad),
    compactMetrics('Tight cap', baseline, tight),
  ]
  const cleanUnchanged = metrics.slice(1).every((entry) =>
    entry.cleanPitchDelta === 0 &&
    entry.cleanDurationDelta === 0 &&
    entry.cleanOnsetDelta === 0 &&
    entry.cleanChordDelta === 0 &&
    entry.cleanGeneratedNoteDelta === 0,
  )

  const analysis = {
    generatedAt: new Date().toISOString(),
    paths: {
      baselineDir: rel(resolvePath(baselineDir)),
      broadDir: rel(resolvePath(broadDir)),
      tightDir: rel(resolvePath(tightDir)),
    },
    metrics,
    cleanUnchanged,
    baselineBeamStem: beamStemSummary(baseline.dense),
    broad: analyzeRun('Broad cap', baseline, broad),
    tight: analyzeRun('Tight cap', baseline, tight),
  }

  ensureParent(outMd)
  writeFileSync(outMd, makeMarkdown(analysis))
  ensureParent(outJson)
  writeFileSync(outJson, `${JSON.stringify(analysis, null, 2)}\n`)

  console.log(`Wrote ${rel(outMd)}`)
  console.log(`Wrote ${rel(outJson)}`)
}

main()
