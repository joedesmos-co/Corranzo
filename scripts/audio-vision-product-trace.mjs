#!/usr/bin/env node
/**
 * Phase A trace: run the ACTUAL product pipeline (runAudioArrangementPipeline)
 * with the production Basic Pitch worker path on rights-cleared mic-real clips.
 * Measure how many transcribed notes survive the arrangement and the strict
 * event F1 of the final arrangement vs the reference notes.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const m = JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const ids = ['piano-mozart-dyad','piano-schubert-triad','acoustic-bossa-chord','acoustic-rock-dyad','electric-eg07-single','electric-eg04-dyad']
const rows=[]
for(const id of ids){
  const c = m.clips.find(x=>x.id===id); if(!c) continue
  const wav = readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const sr = wav.sampleRate
  const samples = Float32Array.from(wav.samples)
  const file = { name: c.audio.file.split('/').pop(), size: samples.length*4, type:'audio/wav' }
  const out = await runAudioArrangementPipeline(file, new ArrayBuffer(64), {
    targetPart: c.instrument==='piano'?'solo-piano':'solo-guitar',
    difficulty:'intermediate',
  }, {
    decodeAudioDataImpl: async () => ({ channelData:[samples], sampleRate:sr, durationSeconds:samples.length/sr, channelCount:1 }),
    predictNotes: async (s) => (await predictBasicPitchNode(s,{modelDir:join(root,'public/neural-model')})).notes.map(n=>({midi:n.midi,startSeconds:n.startSeconds,endSeconds:n.endSeconds,amplitude:n.amplitude})),
  })
  const ref = (c.truth.notes||[]).filter(n=>n.onset>=0).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  const rawModel = out.ok ? (out.transcribed?.predictedNotes ?? []) : []
  const transcribed = out.ok ? (out.transcriptionEvidence?.events ?? []) : []
  const arranged = out.ok ? (out.model?.parts?.[0]?.events ?? []) : []
  const toEvents = (list)=>list.map(e=>({midi:e.midi,onset:e.startSeconds ?? e.startBeat,offset:e.endSeconds ?? (e.startBeat+e.durBeats)}))
  // arrangement events are in beats; convert using notation bpm? Use startBeat*60/bpm
  const bpm = out.ok ? out.notation.bpm : 100
  const arrEvents = arranged.map(e=>({midi:e.midi,onset:e.startBeat*60/bpm,offset:(e.startBeat+e.durBeats)*60/bpm}))
  const rawEvents = rawModel.map(e=>({midi:e.midi,onset:e.startSeconds}))
  const transEvents = transcribed.map(e=>({midi:e.midi,onset:e.startSeconds ?? e.startBeat*60/bpm}))
  const sRaw = scoreEvents(rawEvents, ref, {tolerance:0.12})
  const sRef = scoreEvents(transEvents, ref, {tolerance:0.12})
  const sArr = scoreEvents(arrEvents, ref, {tolerance:0.25})
  rows.push({id, instrument:c.instrument, ok:out.ok, code:out.code, refNotes:ref.length, rawModel:rawModel.length, rawF1:sRaw.eventF1, rawR:sRaw.pitchRecall, rawP:sRaw.pitchPrecision, transcribed:transcribed.length, arranged:arranged.length, transF1:sRef.eventF1, arrF1:sArr.eventF1, warnings:(out.model?.parts?.[0]?.warnings??[]).length})
  console.log(`${id.padEnd(22)} ${c.instrument.padEnd(16)} ref ${ref.length} raw ${rawModel.length} rawF1 ${sRaw.eventF1} rawR ${sRaw.pitchRecall} arr ${arranged.length} arrF1 ${sArr.eventF1}`)
}
await closeBasicPitchNode()
console.log('\nRows:', JSON.stringify(rows,null,1))
