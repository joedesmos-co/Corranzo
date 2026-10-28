#!/usr/bin/env node
/**
 * Decisive piano test: for each clip, search a global time shift applied to
 * the MODEL predictions (not the reference) that maximizes strict F1. If a
 * single shift yields high F1, the model's pitches are right and the reference
 * is misaligned. If even the best shift stays low, the model's pitches are wrong.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const piano=m.clips.filter(c=>c.instrument==='piano')
for(const c of piano){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const truth=(c.truth.notes||[]).filter(n=>n.onset>=0).map(n=>({midi:n.midi,onset:n.onset}))
  if(!truth.length){console.log(c.id,'no truth');continue}
  let best={delta:0,f1:-1,p:0,r:0}
  for(let d=-1.0;d<=1.001;d+=0.025){
    const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds+d}))
    const s=scoreEvents(pred,truth,{tolerance:0.12})
    if(s.eventF1>best.f1) best={delta:Math.round(d*1000)/1000,f1:s.eventF1,p:s.pitchPrecision,r:s.pitchRecall}
  }
  const raw=scoreEvents(bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds})),truth,{tolerance:0.12})
  console.log(`${c.id.padEnd(24)} ref ${String(truth.length).padStart(2)} model ${String(bp.notes.length).padStart(2)} rawF1 ${raw.eventF1} | bestShift ${best.delta}s F1 ${best.f1} P ${best.p} R ${best.r}`)
}
await closeBasicPitchNode()
