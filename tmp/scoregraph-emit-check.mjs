import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { makeRenderPageCallback, renderPdfToPages } from '../scripts/lib/renderPdfPages.mjs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
async function extractor(pdf){const pdfjs=await import(join(ROOT,'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));const doc=await pdfjs.getDocument({data:new Uint8Array(readFileSync(pdf)),isEvalSupported:false}).promise;return async(_s,n)=>{const p=await doc.getPage(n);const vp=p.getViewport({scale:1,rotation:0});const c=await p.getTextContent();return (c.items??[]).map(i=>({text:i.str??'',x:i.transform?.[4]??0,y:i.transform?.[5]??0,pageWidth:vp.width,pageHeight:vp.height,width:i.width,height:i.height,fontName:i.fontName}))}}
const pdf='public/fixtures/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf'
const r=await renderPdfToPages(pdf,{rootDir:ROOT})
const res=await runPdfOmrPipeline(pdf,{renderPage:makeRenderPageCallback(r.pages),extractPageText:await extractor(pdf),numPages:r.numPages,maxPages:24,preprocessPages:true,title:basename(pdf)})
const d=res.diagnostics
console.error('SCOREGRAPH '+JSON.stringify(d.scoreGraph))
console.error('PARITY '+JSON.stringify(d.runtimeVsScoreGraph))
console.error('MUSICXML_LEN '+(res.musicXml?.length??0))
