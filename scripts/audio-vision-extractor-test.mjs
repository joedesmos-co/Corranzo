#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const manifest=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById=Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
const clips=manifest.clips.filter(c=>c.split==='eval-fresh' && c.instrument==='acoustic-guitar')
const variants=[
  {name:'prod', onsetThreshold:0.65, frameThreshold:0.5, minNoteFrames:3},
  {name:'onset0.5', onsetThreshold:0.50, frameThreshold:0.5, minNoteFrames:3},
  {name:'frame0.35', onsetThreshold:0.65, frameThreshold:0.35, minNoteFrames:3},
  {name:'both0.5/0.35', onsetThreshold:0.50, frameThreshold:0.35, minNoteFrames:3},
  {name:'minFrames2', onsetThreshold:0.65, frameThreshold:0.5, minNoteFrames:2},
]
const results={}
for(const v of variants){
  let tp=0,fp=0,ref=0
  for(const c of clips){
    const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
    const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
    const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model'),...v})
    const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds}))
    const delta=deltaById[c.id]??0
    const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset+delta})).filter(n=>n.onset>=0)
    const sc=scoreEvents(pred,truth,{tolerance:0.12})
    tp+=sc.matched; fp+=sc.falsePositives; ref+=truth.length
  }
  const prec=tp/(tp+fp); const rec=tp/ref; const f1=2*prec*rec/(prec+rec)
  results[v.name]={tp,fp,ref,precision:Math.round(prec*1000)/1000,recall:Math.round(rec*1000)/1000,f1:Math.round(f1*1000)/1000}
  console.log(`${v.name.padEnd(16)} tp ${tp} fp ${fp} ref ${ref} P ${results[v.name].precision} R ${results[v.name].recall} F1 ${results[v.name].f1}`)
}
await closeBasicPitchNode()
console.log('\n',JSON.stringify(results,null,2))
