import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setPdfjsLoader,
  setPdfAnalysisCanvasFactory,
} from '../src/features/score-follow/pdfPageAnalysis.js'
import { setOmrDiagnosticFlag, OMR_DIAGNOSTIC_FLAG } from '../src/features/omr/omrDiagnosticFlags.js'
import { runPdfOmrClient } from '../src/features/omr/runPdfOmrClient.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let canvasAvailable = false
let createCanvas = null
let pdfjsModule = null
try {
  const [canvasMod, pdfjsMod] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ])
  createCanvas = canvasMod.createCanvas
  pdfjsModule = pdfjsMod
  canvasAvailable = Boolean(createCanvas)
} catch {
  canvasAvailable = false
}

const CORRECTED = join(ROOT, 'benchmarks/omr-fixtures-corrected')

function readFixture(name) {
  const dir = join(CORRECTED, name)
  return {
    pdf: new Uint8Array(readFileSync(join(dir, `${name}.pdf`))),
    reference: readFileSync(join(dir, `${name}.musicxml`), 'utf8'),
  }
}

/** Rest events with measure, normalized type and duration in quarters. */
function restEvents(xml) {
  const out = []
  let divisions = 1
  for (const m of xml.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)) {
    const div = m[2].match(/<divisions>(\d+)<\/divisions>/)
    if (div) divisions = Number(div[1])
    for (const n of m[2].matchAll(/<note[^>]*>([\s\S]*?)<\/note>/g)) {
      const body = n[1]
      if (!/<rest/.test(body)) continue
      const rawType = body.match(/<type>([^<]+)<\/type>/)?.[1] ?? null
      const type = rawType === 'sixteenth' ? '16th' : rawType === 'thirty-second' ? '32nd' : rawType
      const duration = Number(body.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0)
      out.push({ measure: Number(m[1]), type, quarters: +(duration / divisions).toFixed(3) })
    }
  }
  return out.sort((a, b) => a.measure - b.measure || a.quarters - b.quarters)
}

/** Dotted note events with measure, written quarters and pitch. */
function dottedEvents(xml) {
  const out = []
  let divisions = 1
  for (const m of xml.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)) {
    const div = m[2].match(/<divisions>(\d+)<\/divisions>/)
    if (div) divisions = Number(div[1])
    for (const n of m[2].matchAll(/<note[^>]*>([\s\S]*?)<\/note>/g)) {
      const body = n[1]
      if (!/<dot\s*\/>/.test(body)) continue
      const duration = Number(body.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0)
      const pitch = (body.match(/<step>([^<]+)<\/step>/)?.[1] ?? '') + (body.match(/<octave>([^<]+)<\/octave>/)?.[1] ?? '')
      out.push({ measure: Number(m[1]), quarters: +(duration / divisions).toFixed(3), pitch })
    }
  }
  return out
}

async function generate(name) {
  const { pdf } = readFixture(name)
  const result = await runPdfOmrClient(pdf, {
    title: name,
    instrumentId: 'piano',
    useWorker: false,
  })
  return { generated: restEvents(result.musicXml), result }
}

beforeAll(() => {
  if (canvasAvailable) {
    setPdfjsLoader(() => pdfjsModule)
    setPdfAnalysisCanvasFactory((width, height) => createCanvas(width, height))
  }
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, false)
  setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.TRACE, false)
})

afterAll(() => {
  setPdfjsLoader(null)
  setPdfAnalysisCanvasFactory(null)
})

describe.skipIf(!canvasAvailable)('rest and dot semantics against independent references', () => {
  it('recovers printed rests with zero false positives (corrected rhythm)', async () => {
    const name = 'piano-rhythm-tuplets-vector'
    const { reference } = readFixture(name)
    const ref = restEvents(reference)
    const { generated } = await generate(name)
    const key = (r) => `${r.measure}:${r.type}:${r.quarters}`
    const refKeys = new Set(ref.map(key))
    const genKeys = generated.map(key)
    const tp = genKeys.filter((k) => refKeys.has(k)).length
    const fp = genKeys.length - tp
    const fn = ref.length - tp

    // Written rests are (eighth, 16th) in m4, quarter in m5, whole in m6,
    // quarter in m8. The m8 quarter cannot be placed because the recognized
    // note intervals over-occupy that measure, so it must abstain rather
    // than invent or stretch a rest.
    expect(generated).toEqual([
      { measure: 4, type: '16th', quarters: 0.25 },
      { measure: 4, type: 'eighth', quarters: 0.5 },
      { measure: 5, type: 'quarter', quarters: 1 },
      { measure: 6, type: 'whole', quarters: 4 },
    ])
    expect(fp).toBe(0)
    expect(tp).toBe(4)
    expect(fn).toBe(1)
  })

  it('recovers a lone quarter rest exactly (corrected beginner)', async () => {
    const name = 'piano-beginner-single-vector'
    const { reference } = readFixture(name)
    const ref = restEvents(reference)
    const { generated } = await generate(name)
    expect(ref).toEqual([{ measure: 7, type: 'quarter', quarters: 1 }])
    expect(generated).toEqual(ref)
  })

  it('recovers every dotted note exactly with zero promotions', async () => {
    const { result } = await generate('piano-rhythm-tuplets-vector')
    const { reference } = readFixture('piano-rhythm-tuplets-vector')
    expect(dottedEvents(result.musicXml)).toEqual(dottedEvents(reference))
    expect(dottedEvents(result.musicXml)).toEqual([
      { measure: 4, quarters: 1.5, pitch: 'A4' },
      { measure: 8, quarters: 0.75, pitch: 'F4' },
    ])
    const beginner = await generate('piano-beginner-single-vector')
    const beginnerRef = readFixture('piano-beginner-single-vector')
    expect(dottedEvents(beginner.result.musicXml)).toEqual(dottedEvents(beginnerRef.reference))
    expect(dottedEvents(beginner.result.musicXml)).toHaveLength(1)
  }, 30000)

  it('never promotes an undotted reference to dotted (corrected dense)', async () => {
    const name = 'piano-dense-advanced-vector'
    const { result } = await generate(name)
    expect(dottedEvents(result.musicXml)).toEqual([])
  }, 30000)

  it('emits no rests on a reference with none (corrected grand)', async () => {
    const name = 'piano-grand-voices-vector'
    const { reference } = readFixture(name)
    expect(restEvents(reference)).toEqual([])
    const { generated } = await generate(name)
    expect(generated).toEqual([])
  }, 30000)
})
