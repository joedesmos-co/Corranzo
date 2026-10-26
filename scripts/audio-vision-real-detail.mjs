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
function jamsNotes(base){const d=JSON.parse(readFileSync(`/tmp/guitarset/jams/${base}.jams`,'utf8'));const out=[];for(const a of d.annotations){if(a.namespace!=='note_midi'||!a.data)continue;for(const o of a.data){const m=Math.round(Number(o.value));const t=Number(o.time);if(m>=21&&m<=108)out.push({midi:m,onset:t,offset:t+Math.max(0.05,Number(o.duration||0.1))})}}return out.sort((a,b)=>a.onset-b.onset)}
const bases=['02_BN1-129-Eb_comp','02_BN1-147-Gb_comp']
for(const base of bases){
  const wav=readWavPcm(`/tmp/guitarset/${base}_mic.wav`)
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,dur:(n.endSeconds??n.startSeconds)-n.startSeconds}))
  const truth=jamsNotes(base).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset}))
  // octave errors: pred note whose midi not in truth but midi±12 (or 24) is
  let oct=0, falseN=0, missed=0
  const matchedTruth=new Set()
  for(const p of pred){
    const cand=truth.map((t,i)=>({t,i,d:Math.abs(t.onset-p.onset)})).filter(x=>x.d<=0.12).sort((a,b)=>a.d-b.d)
    if(cand.length===0){falseN++;continue}
    const c=cand[0]
    if(c.t.midi===p.midi){matchedTruth.add(c.i)}
    else if(Math.abs(c.t.midi-p.midi)%12===0){oct++;matchedTruth.add(c.i)}
    else falseN++
  }
  for(let i=0;i<truth.length;i++) if(!matchedTruth.has(i)) missed++
  // by register
  const reg=(lo,hi)=>{const t=truth.filter(n=>n.midi>=lo&&n.midi<hi);const tp=t.filter((_,i)=>true).length;return t.length}
  console.log(base)
  console.log('  truth',truth.length,'pred',pred.length,'missed',missed,'octaveErrors',oct,'falseNotes',falseN)
  console.log('  bass(<48) truth',truth.filter(n=>n.midi<48).length,'mid truth',truth.filter(n=>n.midi>=48&&n.midi<72).length)
  // duration error
  const durErrs=[]
  for(const p of pred){const c=truth.filter(t=>Math.abs(t.onset-p.onset)<=0.12).sort((a,b)=>Math.abs(a.onset-p.onset)-Math.abs(b.onset-p.onset))[0];if(c&&c.midi===p.midi) durErrs.push(Math.abs((c.offset-c.onset)-p.dur)*1000)}
  console.log('  durMAE ms', durErrs.length? Math.round(durErrs.reduce((a,b)=>a+b,0)/durErrs.length):'na', 'onsetMAE', )
  const onErrs=pred.map(p=>{const c=truth.filter(t=>Math.abs(t.onset-p.onset)<=0.12).sort((a,b)=>Math.abs(a.onset-p.onset)-Math.abs(b.onset-p.onset))[0];return c?Math.abs(c.onset-p.onset)*1000:null}).filter(x=>x!=null)
  console.log('  onsetMAE ms', onErrs.length? Math.round(onErrs.reduce((a,b)=>a+b,0)/onErrs.length):'na')
}
await closeBasicPitchNode()
