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
const regOf=m=>m<48?'bass':m<72?'mid':'high'
for(const base of ['02_BN1-129-Eb_comp','02_BN1-147-Gb_comp']){
  const wav=readWavPcm(`/tmp/guitarset/${base}_mic.wav`)
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,dur:(n.endSeconds??n.startSeconds)-n.startSeconds}))
  const truth=jamsNotes(base).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset}))
  // cluster density of each truth note
  const sorted=[...truth].sort((a,b)=>a.onset-b.onset)
  const clusterSize=new Map()
  // group onsets within 80ms
  let groups=[];let cur=[]
  for(const n of sorted){if(cur.length && n.onset-cur[0].onset>0.08){groups.push(cur);cur=[]}cur.push(n)}if(cur.length)groups.push(cur)
  const sizeByNote=new Map()
  for(const g of groups) for(const n of g) sizeByNote.set(n,sizeByNote.get(n)||g.length) // careful: identity
  // simpler: map by index
  // compute per-note recall via scoreEvents matching by re-running with subsets
  for(const r of ['bass','mid','high']){
    const t=truth.filter(n=>regOf(n.midi)===r)
    const p=pred.filter(n=>regOf(n.midi)===r)
    const s=scoreEvents(p,t,{tolerance:0.12})
    console.log(base, r, 'truth',t.length,'pred',p.length,'P',s.pitchPrecision,'R',s.pitchRecall,'F1',s.eventF1)
  }
  // dense vs sparse: truth notes in clusters of size>=4
  const denseTruth=truth.filter(n=>{const g=groups.find(g=>g.includes(n));return g&&g.length>=4})
  const sparseTruth=truth.filter(n=>{const g=groups.find(g=>g.includes(n));return g&&g.length<4})
  for(const [label,subset] of [['dense',denseTruth],['sparse',sparseTruth]]){
    const s=scoreEvents(pred,subset,{tolerance:0.12}); console.log(base,label,'truth',subset.length,'R',s.pitchRecall,'F1',s.eventF1)
  }
  // quiet notes: we don't have velocity in jams; approximate by... skip
}
await closeBasicPitchNode()
