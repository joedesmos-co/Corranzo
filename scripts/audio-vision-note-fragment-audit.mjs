#!/usr/bin/env node
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
// merge identical-pitch notes whose gap is <= gapSec (fragmentation)
function mergeFragments(notes, gapSec){
  const sorted=[...notes].sort((a,b)=>a.startSeconds-b.startSeconds||a.midi-b.midi)
  const out=[]
  for(const n of sorted){
    const prev=[...out].reverse().find(o=>o.midi===n.midi)
    if(prev && n.startSeconds - prev.endSeconds <= gapSec && n.startSeconds >= prev.startSeconds){
      prev.endSeconds=Math.max(prev.endSeconds,n.endSeconds); prev.merged=(prev.merged||0)+1
    } else out.push({...n})
  }
  return out
}
const clips=m.clips.filter(c=>['piano','acoustic-guitar','electric-guitar'].includes(c.instrument)).slice(0,12)
for(const gap of [0,0.03,0.06,0.1]){
  let tp=0,fp=0,ref=0
  for(const c of clips){
    const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
    const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
    const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
    const merged=gap>0?mergeFragments(bp.notes,gap):bp.notes
    const pred=merged.map(n=>({midi:n.midi,onset:n.startSeconds}))
    const truth=(c.truth.notes||[]).filter(n=>n.onset>=0).map(n=>({midi:n.midi,onset:n.onset}))
    const sc=scoreEvents(pred,truth,{tolerance:0.12})
    tp+=sc.matched;fp+=sc.falsePositives;ref+=truth.length
  }
  const p=tp/(tp+fp),r=tp/ref,f=2*p*r/(p+r)
  console.log(`merge gap ${gap}s: P ${p.toFixed(3)} R ${r.toFixed(3)} F1 ${f.toFixed(3)} (tp ${tp} fp ${fp} ref ${ref})`)
}
await closeBasicPitchNode()
