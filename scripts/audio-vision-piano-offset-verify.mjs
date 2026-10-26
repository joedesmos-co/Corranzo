#!/usr/bin/env node
/**
 * Milestone 1: independent piano offset verification.
 * For each piano clip, compute median (truth onset - nearest energy attack).
 * Compare to align-probe bestDelta. If they agree, the correction is
 * waveform-supported. If not, the align-probe is overfitting.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const manifest=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById=Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))

function energyNearest(samples, t, windowSec=0.4){
  const frame=256,hop=128; let best=null,bestv=-1
  const s0=Math.floor((t-windowSec)*SR), s1=Math.floor((t+windowSec)*SR)
  for(let i=Math.max(0,s0);i+frame<Math.min(samples.length,s1);i+=hop){
    let s=0;for(let j=0;j<frame;j++)s+=samples[i+j]*samples[i+j];const v=Math.sqrt(s/frame)
    if(v>bestv){bestv=v;best=i/SR}
  }
  return best===null?null:(best-t)
}

const piano=manifest.clips.filter(c=>c.instrument==='piano')
for(const c of piano){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const truth=(c.truth.notes||[]).map(n=>({onset:n.onset,offset:n.offset??n.onset+0.3})).filter(n=>n.onset>=0)
  const offs=truth.map(t=>energyNearest(samples,t.onset,0.4)).filter(x=>x!==null)
  if(!offs.length){console.log(c.id,'no offsets');continue}
  const so=offs.slice().sort((a,b)=>a-b)
  const med=so[Math.floor(so.length/2)]
  const mean=offs.reduce((a,b)=>a+b,0)/offs.length
  const probe=deltaById[c.id]??0
  console.log(`${c.id.padEnd(24)} n=${truth.length} medAttackOffset=${(med*1000).toFixed(0)}ms mean=${(mean*1000).toFixed(0)}ms probeDelta=${(probe*1000).toFixed(0)}ms agree=${Math.abs(med+probe)<0.15?'YES':'NO'}`)
}
