#!/usr/bin/env node
/**
 * Honest piano evaluation:
 *  - raw strict F1
 *  - independent (model-free) offset per performance
 *  - model-optimized offset, clearly labelled unverified
 *  - pitch-only recall, onset MAE, false/missing counts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const ind=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/independent-offset.json'),'utf8'))
const indByPerf=Object.fromEntries(Object.entries(ind.summary).map(([k,v])=>[k,v.weightedMeanDelta]))
// model-optimized offsets (previous campaign), labelled unverified
const modelOpt={'vienna-mozart-p01':0.525,'vienna-schubert-p01':0.42,'vienna-mozart-p02':0.0,'vienna-schubert-p02':0.71}
const rows=[]
for(const c of m.clips.filter(x=>x.instrument==='piano')){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const truth=(c.truth.notes||[]).filter(n=>n.onset>=0).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  if(!truth.length) continue
  const raw=scoreEvents(bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds})),truth,{tolerance:0.12})
  const indOff=indByPerf[c.performance]??0
  // independent offset shifts the REFERENCE by indOff (negative = ref late), so
  // to align the model we shift it by -indOff.
  const indShift=-indOff
  const indScore=scoreEvents(bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds+indShift})),truth,{tolerance:0.12})
  const optOff=modelOpt[c.performance]??0
  const optScore=scoreEvents(bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds+optOff})),truth,{tolerance:0.12})
  // pitch-only recall within 1s
  let pitchHits=0
  for(const t of truth){ if(bp.notes.some(p=>p.midi===t.midi && Math.abs(p.startSeconds-t.onset)<=1.0)) pitchHits++ }
  rows.push({id:c.id,performance:c.performance,ref:truth.length,model:bp.notes.length,rawF1:raw.eventF1,indOffset:indShift,indF1:indScore.eventF1,indR:indScore.pitchRecall,optOffset:optOff,optF1:optScore.eventF1,optR:optScore.pitchRecall,pitchOnlyRecall:Math.round(pitchHits/truth.length*1000)/1000,rawFalse:raw.falsePositives,rawMissed:raw.missed,rawOnsetMae:raw.onsetMaeMs})
  console.log(`${c.id.padEnd(24)} rawF1 ${raw.eventF1} | ind ${indShift.toFixed(2)} F1 ${indScore.eventF1} | opt ${optOff.toFixed(2)} F1 ${optScore.eventF1} | pitchOnly ${Math.round(pitchHits/truth.length*1000)/1000}`)
}
await closeBasicPitchNode()
const mean=v=>{const x=v.filter(n=>Number.isFinite(n));return x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*1000)/1000:null}
const agg={rawF1:mean(rows.map(r=>r.rawF1)),indF1:mean(rows.map(r=>r.indF1)),optF1:mean(rows.map(r=>r.optF1)),pitchOnlyRecall:mean(rows.map(r=>r.pitchOnlyRecall)),rawOnsetMae:mean(rows.map(r=>r.rawOnsetMae))}
console.log('\nAGG:',JSON.stringify(agg))
writeFileSync(join(root,'benchmarks/audio-vision/piano-honest.json'),JSON.stringify({generatedAt:new Date().toISOString(),description:'Honest piano evaluation: raw, independent model-free offset, model-optimized offset (unverified).',rows,aggregate:agg},null,1))
console.log('written')
