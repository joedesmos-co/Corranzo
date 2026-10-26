#!/usr/bin/env node
/**
 * Milestone 4: onset-snapping extractor experiment.
 * For each predicted note, snap onset to nearest spectral-flux energy peak
 * within a small window. Measure F1/recall/precision vs raw.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { magnitudeSpectrogram, spectralFlux } from '../src/features/audio-vision/dsp.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const manifest=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById=Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
const clips=manifest.clips.filter(c=>c.split==='eval-fresh' && c.instrument==='acoustic-guitar')

async function energyPeaks(samples){
  const {frames,frameSeconds}=await magnitudeSpectrogram(samples,{sampleRate:SR})
  const flux=spectralFlux(frames)
  const mx=Math.max(...flux); const peaks=[]
  for(let i=2;i<flux.length-2;i++){
    if(flux[i]>flux[i-1] && flux[i]>=flux[i+1] && flux[i]>mx*0.08) peaks.push(i*frameSeconds)
  }
  return peaks
}
function snap(onset,peaks,window=0.1){
  let best=null,bestd=window
  for(const p of peaks){const d=Math.abs(p-onset);if(d<bestd){bestd=d;best=p}}
  return best===null?onset:best
}
for(const snapWindow of [0.05,0.10]){
  let tp=0,fp=0,ref=0
  for(const c of clips){
    const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
    const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
    const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
    const peaks=await energyPeaks(samples)
    const pred=bp.notes.map(n=>({midi:n.midi,onset:snap(n.startSeconds,peaks,snapWindow)}))
    const delta=deltaById[c.id]??0
    const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset+delta})).filter(n=>n.onset>=0)
    const sc=scoreEvents(pred,truth,{tolerance:0.12})
    tp+=sc.matched; fp+=sc.falsePositives; ref+=truth.length
  }
  const prec=tp/(tp+fp), rec=tp/ref, f1=2*prec*rec/(prec+rec)
  console.log(`snap ${snapWindow}s: P ${prec.toFixed(3)} R ${rec.toFixed(3)} F1 ${f1.toFixed(3)} (tp ${tp} fp ${fp})`)
}
// raw baseline
let tp=0,fp=0,ref=0
for(const c of clips){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds}))
  const delta=deltaById[c.id]??0
  const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset+delta})).filter(n=>n.onset>=0)
  const sc=scoreEvents(pred,truth,{tolerance:0.12})
  tp+=sc.matched; fp+=sc.falsePositives; ref+=truth.length
}
const prec=tp/(tp+fp), rec=tp/ref, f1=2*prec*rec/(prec+rec)
console.log(`raw:        P ${prec.toFixed(3)} R ${rec.toFixed(3)} F1 ${f1.toFixed(3)} (tp ${tp} fp ${fp})`)
await closeBasicPitchNode()
