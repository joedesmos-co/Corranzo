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
const clips=manifest.clips.filter(c=>c.split==='dev')
for(const variant of [{name:'prod',onsetThreshold:0.65},{name:'onset0.5',onsetThreshold:0.50}]){
  let tp=0,fp=0,ref=0
  const byInst={}
  for(const c of clips){
    const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
    const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
    const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model'),onsetThreshold:variant.onsetThreshold,frameThreshold:0.5,minNoteFrames:3})
    const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds}))
    const delta=deltaById[c.id]??0
    const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset+delta})).filter(n=>n.onset>=0)
    const sc=scoreEvents(pred,truth,{tolerance:0.12})
    tp+=sc.matched; fp+=sc.falsePositives; ref+=truth.length
    byInst[c.instrument]=byInst[c.instrument]||{tp:0,fp:0,ref:0}
    byInst[c.instrument].tp+=sc.matched; byInst[c.instrument].fp+=sc.falsePositives; byInst[c.instrument].ref+=truth.length
  }
  const prec=tp/(tp+fp); const rec=tp/ref; const f1=2*prec*rec/(prec+rec)
  console.log(`\n${variant.name}: P ${prec.toFixed(3)} R ${rec.toFixed(3)} F1 ${f1.toFixed(3)} (tp ${tp} fp ${fp} ref ${ref})`)
  for(const [inst,v] of Object.entries(byInst)){
    const p=v.tp/(v.tp+v.fp), r=v.tp/v.ref, f=2*p*r/(p+r)
    console.log(`   ${inst}: P ${p.toFixed(3)} R ${r.toFixed(3)} F1 ${f.toFixed(3)} (tp ${v.tp} fp ${v.fp} ref ${v.ref})`)
  }
}
await closeBasicPitchNode()
