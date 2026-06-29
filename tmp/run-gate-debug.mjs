process.env.OMR_GATE_DEBUG = '1'
import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { makeRenderPageCallback, renderPdfToPages } from '../scripts/lib/renderPdfPages.mjs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
async function textExtractor(pdf){ const pdfjs = await import(join(ROOT,'node_modules/pdfjs-dist/legacy/build/pdf.mjs')); const doc = await pdfjs.getDocument({data:new Uint8Array(readFileSync(pdf)),isEvalSupported:false}).promise; return async (_s,n)=>{const p=await doc.getPage(n);const c=await p.getTextContent();return (c.items??[]).map(i=>({text:i.str??'',x:i.transform?.[4]??0,y:i.transform?.[5]??0}))} }
const pdf = process.argv[2]
const r = await renderPdfToPages(pdf,{rootDir:ROOT})
try { await runPdfOmrPipeline(pdf,{renderPage:makeRenderPageCallback(r.pages),extractPageText:await textExtractor(pdf),numPages:r.numPages,maxPages:24,preprocessPages:true,title:basename(pdf)}) } catch {}
console.error('GATE ' + basename(dirname(pdf)) + ' ' + JSON.stringify(globalThis.__omrGate))
