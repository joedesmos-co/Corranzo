#!/usr/bin/env node
/**
 * Diagnostic-only: dense column-locked gap packing investigation.
 * Does not modify production recognition.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GEOMETRY_FIXTURES,
  traceColumnGapPacking,
} from './lib/columnGapPackingTrace.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/omr-column-gap-packing')
mkdirSync(join(OUT, 'traces'), { recursive: true })
mkdirSync(join(OUT, 'fixtures'), { recursive: true })

const traces = GEOMETRY_FIXTURES.map((fixture) => {
  const trace = traceColumnGapPacking(fixture)
  writeFileSync(join(OUT, 'traces', `${fixture.id}.json`), `${JSON.stringify(trace, null, 2)}\n`)
  writeFileSync(
    join(OUT, 'fixtures', `${fixture.id}.json`),
    `${JSON.stringify({ ...fixture, diagnosticOnly: true }, null, 2)}\n`,
  )
  return trace
})

writeFileSync(join(OUT, 'traces-summary.json'), `${JSON.stringify({ traces }, null, 2)}\n`)

for (const trace of traces) {
  console.log(
    JSON.stringify(
      {
        id: trace.id,
        groupCount: trace.groupCount,
        denseRhythmEntered: trace.denseRhythmEntered,
        denseRhythmRule: trace.denseRhythmRule,
        chordMergeX: trace.chordMergeX,
        splitColumns: trace.splitColumns,
        visualSplits: trace.visualSplits,
        failingTransition: trace.failingTransition,
        producedEventCount: trace.producedEventCount,
        independentSplit: trace.independentSplit?.map((entry) => ({
          columnId: entry.columnId,
          sparse: entry.sparse,
          dense: entry.dense,
          sparseOnsetsDiverge: entry.sparseOnsetsDiverge,
          denseOnsetsDiverge: entry.denseOnsetsDiverge,
        })),
      },
      null,
      2,
    ),
  )
}
