#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
for(const id of ['piano-mozart-dyad','piano-schubert-single']){
  const c=m.clips.find(x=>x.id===id)
  console.log(`\n${id} startSeconds=${c.audio.startSeconds} dur=${c.audio.durationSeconds}`)
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  // print RMS envelope every 25ms for first 1.2s
  const step=Math.floor(0.025*SR)
  const vals=[]
  for(let i=0;i+step<samples.length && i<1.3*SR;i+=step){let s=0;for(let j=0;j<step;j++)s+=samples[i+j]*samples[i+j];vals.push({t:(i/SR).toFixed(3),rms:Math.sqrt(s/step)})}
  const max=Math.max(...vals.map(v=>v.rms))
  console.log('RMS envelope (first 1.3s, normalized):')
  console.log(vals.map(v=>`${v.t}:${(v.rms/max).toFixed(2)}`).join(' '))
  // ref onsets
  const ref=(c.truth.notes||[]).filter(n=>n.onset>=0).sort((a,b)=>a.onset-b.onset)
  console.log('ref onsets:', ref.slice(0,8).map(n=>n.onset.toFixed(2)).join(','))
}
