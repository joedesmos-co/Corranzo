#!/usr/bin/env node
/**
 * Independent audio/reference offset verification (NO model).
 *
 * Cross-correlate the reference onset impulse train with the audio's spectral
 * flux onset strength over shifts [-1,+1]s, per clip, then aggregate per
 * performance. This is the audio-vs-annotation offset, derived from waveform
 * evidence only. It never reads Basic Pitch output.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { magnitudeSpectrogram, spectralFlux } from '../src/features/audio-vision/dsp.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))

async function fluxEnvelope(samples){
  const {frames,frameSeconds}=await magnitudeSpectrogram(samples,{sampleRate:SR})
  const flux=spectralFlux(frames)
  // normalize
  const mx=Math.max(...flux,1e-9)
  return {flux:flux.map(v=>v/mx),frameSeconds}
}
function scoreShift(flux,frameSeconds,onsets,delta){
  let s=0
  for(const t of onsets){
    const x=(t+delta)/frameSeconds
    const i=Math.round(x)
    if(i<1||i>=flux.length-1) continue
    // parabolic-ish: take max of 3 neighbours to tolerate frame quantization
    s += Math.max(flux[i-1],flux[i],flux[i+1])
  }
  return s/Math.max(1,onsets.length)
}
const rows=[]
for(const c of m.clips.filter(x=>x.instrument==='piano')){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const {flux,frameSeconds}=await fluxEnvelope(samples)
  const onsets=(c.truth.notes||[]).filter(n=>n.onset>=0 && n.onset<3).map(n=>n.onset)
  if(onsets.length<2) continue
  let best={delta:0,score:-1}
  for(let d=-1.0;d<=1.001;d+=0.01){
    const s=scoreShift(flux,frameSeconds,onsets,Math.round(d*100)/100)
    if(s>best.score) best={delta:Math.round(d*100)/100,score:s}
  }
  const zero=scoreShift(flux,frameSeconds,onsets,0)
  rows.push({id:c.id,performance:c.performance,notes:onsets.length,bestDelta:best.delta,bestScore:Math.round(best.score*1000)/1000,zeroScore:Math.round(zero*1000)/1000})
  console.log(`${c.id.padEnd(24)} ${c.performance.padEnd(22)} n=${onsets.length} bestDelta ${best.delta.toFixed(2)} best ${best.score.toFixed(3)} @0 ${zero.toFixed(3)}`)
}
// aggregate per performance: weighted mean of per-clip best deltas
const byPerf={}
for(const r of rows){byPerf[r.performance]=byPerf[r.performance]||[];byPerf[r.performance].push(r)}
const summary={}
for(const [perf,list] of Object.entries(byPerf)){
  const w=list.reduce((a,r)=>a+r.notes,0)
  const mean=list.reduce((a,r)=>a+r.bestDelta*r.notes,0)/w
  const deltas=list.map(r=>r.bestDelta)
  summary[perf]={clips:list.length,weightedMeanDelta:Math.round(mean*1000)/1000,deltas}
  console.log(`PERF ${perf.padEnd(22)} clips ${list.length} weightedMean ${mean.toFixed(3)} deltas [${deltas.join(', ')}]`)
}
writeFileSync(join(root,'benchmarks/audio-vision/independent-offset.json'),JSON.stringify({generatedAt:new Date().toISOString(),description:'Model-free audio/reference offset from spectral-flux cross-correlation; per performance aggregate.',rows,summary},null,1))
console.log('\nwritten')
