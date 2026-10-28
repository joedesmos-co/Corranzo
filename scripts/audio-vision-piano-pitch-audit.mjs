#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
for(const id of ['piano-mozart-dyad','piano-schubert-triad','piano-schubert-single']){
  const c=m.clips.find(x=>x.id===id); if(!c)continue
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const ref=(c.truth.notes||[]).filter(n=>n.onset>=0)
  // match by nearest onset within 0.15, then compare pitch
  let exact=0,octave=0,fifth=0,other=0,unmatched=0
  const used=new Set()
  for(const r of ref){
    let best=-1,bd=0.15
    bp.notes.forEach((p,i)=>{if(used.has(i))return;const d=Math.abs(p.startSeconds-r.onset);if(d<bd){bd=d;best=i}})
    if(best<0){unmatched++;continue}
    used.add(best)
    const pi=bp.notes[best].midi
    const diff=pi-r.midi
    if(diff===0)exact++
    else if(Math.abs(diff)%12===0)octave++
    else if(Math.abs(diff)%12===7)fifth++
    else other++
  }
  console.log(`${id}: ref ${ref.length} exact ${exact} octave ${octave} fifth ${fifth} other ${other} unmatched ${unmatched}`)
  // print pairs
  console.log('  ref midis:', ref.slice(0,10).map(n=>n.midi).join(','))
  console.log('  bp  midis:', bp.notes.slice(0,10).map(n=>n.midi).join(','))
}
await closeBasicPitchNode()
