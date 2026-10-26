#!/usr/bin/env node
/**
 * Independent alignment diagnosis: for each truth onset, find the nearest
 * energy-attack peak in the waveform (NOT model output). Reports the offset
 * distribution. Determines whether annotations are systematically shifted.
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

function onsetStrength(samples, frame=256, hop=128) {
  // RMS per frame, then positive first difference (energy rise)
  const rms=[]
  for(let i=0;i+frame<samples.length;i+=hop){
    let s=0;for(let j=0;j<frame;j++)s+=samples[i+j]*samples[i+j];rms.push(Math.sqrt(s/frame))
  }
  const strength=[0]
  for(let i=1;i<rms.length;i++) strength.push(Math.max(0, rms[i]-rms[i-1]))
  return {strength, hop, frame}
}
function nearestPeak(strength, hop, t, windowSec=0.3){
  const idx=Math.floor(t*SR/hop)
  const w=Math.floor(windowSec*SR/hop)
  let best=-1,bestv=-1
  for(let i=Math.max(0,idx-w);i<=Math.min(strength.length-1,idx+w);i++){
    if(strength[i]>bestv){bestv=strength[i];best=i}
  }
  return best<0?null:(best*hop/SR - t)
}

// pick a handful of clips across instruments
const picks=['acoustic-bossa-single','acoustic-rock-dyad','electric-eg07-single','piano-schubert-single','piano-mozart-dyad']
for(const id of picks){
  const c=manifest.clips.find(x=>x.id===id)
  if(!c){console.log('missing',id);continue}
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const {strength,hop}=onsetStrength(samples)
  const delta=deltaById[id]??0
  const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  const offs=truth.map(t=>nearestPeak(strength,hop,t.onset,0.3)).filter(x=>x!==null)
  const med=offs.slice().sort((a,b)=>a-b)[Math.floor(offs.length/2)]
  const mean=offs.reduce((a,b)=>a+b,0)/offs.length
  console.log(`\n${id} (${c.instrument}) delta(probe)=${delta} n=${truth.length}`)
  console.log(`  truth->nearestAttack offset: mean ${Math.round(mean*1000)}ms median ${Math.round(med*1000)}ms min ${Math.round(Math.min(...offs)*1000)} max ${Math.round(Math.max(...offs)*1000)}`)
  // show first 5
  for(const t of truth.slice(0,5)){
    const o=nearestPeak(strength,hop,t.onset,0.3)
    console.log(`    midi ${t.midi} truth ${t.onset.toFixed(3)} attackOffset ${o===null?'NA':(o*1000).toFixed(0)+'ms'} dur ${(t.offset-t.onset).toFixed(3)}`)
  }
}
