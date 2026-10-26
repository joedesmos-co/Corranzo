#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const alignProbe = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById = Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
const manifest = JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const pianoClips = manifest.clips.filter(c=>c.instrument==='piano')
const rows=[]
for(const c of pianoClips){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,duration:(n.endSeconds??n.startSeconds)-n.startSeconds}))
  const delta=deltaById[c.id]??0
  const allTruth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  const rawTruth=allTruth.filter(n=>n.onset>=0)
  const alignedTruth=allTruth.map(n=>({midi:n.midi,onset:n.onset+delta,offset:(n.offset??n.onset+0.3)+delta})).filter(n=>n.onset>=0)
  const raw=scoreEvents(pred,rawTruth,{tolerance:0.12})
  const aligned=scoreEvents(pred,alignedTruth,{tolerance:0.12})
  rows.push({id:c.id, delta, rawF1:raw.eventF1, rawR:raw.pitchRecall, rawP:raw.pitchPrecision,
    alignedF1:aligned.eventF1, alignedR:aligned.pitchRecall, alignedP:aligned.pitchPrecision,
    truthRaw:rawTruth.length, truthAligned:alignedTruth.length, pred:pred.length,
    onsetMaeRaw:raw.onsetMaeMs, onsetMaeAligned:aligned.onsetMaeMs})
  console.log(`${c.id.padEnd(28)} delta ${String(delta).padStart(7)} raw F1 ${raw.eventF1} R ${raw.pitchRecall} | aligned F1 ${aligned.eventF1} R ${aligned.pitchRecall} onsetMAE ${aligned.onsetMaeMs}`)
}
await closeBasicPitchNode()
const mean=v=>{const x=v.filter(n=>Number.isFinite(n));return x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*1000)/1000:null}
const agg={clips:rows.length,
  rawF1:mean(rows.map(r=>r.rawF1)), rawR:mean(rows.map(r=>r.rawR)), rawP:mean(rows.map(r=>r.rawP)),
  alignedF1:mean(rows.map(r=>r.alignedF1)), alignedR:mean(rows.map(r=>r.alignedR)), alignedP:mean(rows.map(r=>r.alignedP)),
  onsetMaeRaw:mean(rows.map(r=>r.onsetMaeRaw)), onsetMaeAligned:mean(rows.map(r=>r.onsetMaeAligned))}
console.log('\nAGG', JSON.stringify(agg))
writeFileSync(join(root,'benchmarks/audio-vision/piano-aligned.json'), JSON.stringify({generatedAt:new Date().toISOString(), rows, aggregate:agg},null,1))
console.log('written')
