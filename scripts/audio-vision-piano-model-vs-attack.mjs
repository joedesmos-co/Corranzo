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
function attackTimes(samples){
  const frame=256,hop=128; const rms=[]
  for(let i=0;i+frame<samples.length;i+=hop){let s=0;for(let j=0;j<frame;j++)s+=samples[i+j]*samples[i+j];rms.push(Math.sqrt(s/frame))}
  const peaks=[]
  for(let i=2;i<rms.length-2;i++){const rise=rms[i]-rms[i-1],rise2=rms[i+1]-rms[i];if(rise>0.0008 && rise>=rise2) peaks.push(i*hop/SR)}
  return peaks
}
function nearestDist(t,peaks){let b=Infinity;for(const p of peaks){const d=Math.abs(p-t);if(d<b)b=d}return b}
for(const id of ['piano-mozart-dyad','piano-schubert-triad','piano-schubert-single']){
  const c=m.clips.find(x=>x.id===id); if(!c)continue
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const peaks=attackTimes(samples)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const ref=(c.truth.notes||[]).filter(n=>n.onset>=0)
  const refDist=ref.map(n=>nearestDist(n.onset,peaks))
  const modelDist=bp.notes.map(n=>nearestDist(n.startSeconds,peaks))
  const mean=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length*1000):null
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?Math.round(s[Math.floor(s.length/2)]*1000):null}
  console.log(`${id}: ref->attack mean ${mean(refDist)}ms med ${med(refDist)}ms | model->attack mean ${mean(modelDist)}ms med ${med(modelDist)}ms (ref ${ref.length}, model ${bp.notes.length})`)
}
await closeBasicPitchNode()
