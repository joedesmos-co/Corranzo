#!/usr/bin/env node
// Throwaway: report whether each PDF triggers the vector-glyph OMR path.
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasVectorOmrNoteheads } from '../src/features/omr/processVectorOmrPage.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function pageTextFor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  let items = []
  const n = Math.min(doc.numPages, 24)
  for (let p = 1; p <= n; p += 1) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    items = items.concat((content.items ?? []).map((i) => ({ text: i.str ?? '' })))
  }
  return items
}

const NH = new Set([String.fromCharCode(0xe0a3), String.fromCharCode(0xe0a4)])

for (const p of process.argv.slice(2)) {
  try {
    const items = await pageTextFor(p)
    let nh = 0
    for (const it of items) for (const c of it.text ?? '') if (NH.has(c)) nh += 1
    console.log(JSON.stringify({ piece: basename(dirname(p)) || basename(p), vector: hasVectorOmrNoteheads(items), noteheadGlyphs: nh }))
  } catch (e) {
    console.log(JSON.stringify({ piece: p, err: String(e?.message ?? e) }))
  }
}
