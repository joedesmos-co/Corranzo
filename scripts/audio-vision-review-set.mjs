/**
 * M6 — Generate the reproducible musician-review set.
 *
 * From legally usable corpus material already on disk (TRIOS CC BY-NC-SA
 * 2.0 UK local-only, GuitarSet CC-BY-4.0, Musopen public-domain recording,
 * ccMixter CC BY-NC local-only) produces, for a small curated list:
 *   - solo piano + solo guitar MusicXML at easy/intermediate/advanced
 *   - a per-item facts JSON (tempo, densities, warnings, confidence,
 *     agreement + uncertain regions, excerpt coverage, license)
 * Audio is never copied into the repo: items reference the corpus path.
 *
 * Usage: node --expose-gc scripts/audio-vision-review-set.mjs [--out dir]
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { writeSmf } from './lib/writeSmf.mjs'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { mergeTiedContinuations } from '../src/features/practice/waitForYouCheckpoints.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outArgIdx = args.indexOf('--out')
const outDir = join(root, outArgIdx >= 0 ? args[outArgIdx + 1] : 'benchmarks/audio-vision/review-set')

// Curated: one item per musical shape we need ears on. All corpus-local.
const ITEMS = [
  { id: 'mozart-trio-mix', path: '/tmp/trios/TRIOS Dataset/mozart/mix.wav', source: 'TRIOS mix', license: 'CC BY-NC-SA 2.0 UK (local eval only)' },
  { id: 'take-five-trio-mix', path: '/tmp/trios/TRIOS Dataset/take_five/mix.wav', source: 'TRIOS mix', license: 'CC BY-NC-SA 2.0 UK (local eval only)' },
  { id: 'mozart-piano-stem', path: '/tmp/trios/TRIOS Dataset/mozart/piano.wav', source: 'TRIOS piano stem', license: 'CC BY-NC-SA 2.0 UK (local eval only)' },
  { id: 'guitarset-jazz-solo', path: '/tmp/guitarset/tracks/04_Jazz1-200-B_solo_mic.wav', source: 'GuitarSet solo', license: 'CC-BY-4.0 (Xi et al., ISMIR 2018)' },
  { id: 'guitarset-comping', path: '/tmp/guitarset/tracks/00_SS3-84-Bb_comp_mic.wav', source: 'GuitarSet comping', license: 'CC-BY-4.0 (Xi et al., ISMIR 2018)' },
  { id: 'chopin-nocturne', path: '/tmp/realcorpus/chopin-noct19-faulkner-excerpt.wav', source: 'Musopen excerpt (30-75s)', license: 'Public domain recording (Luke Faulkner)' },
  { id: 'five-piece-mix', path: '/tmp/realcorpus/bag-of-motifs-excerpt.wav', source: 'ccMixter excerpt (20-65s)', license: 'CC BY-NC (local eval only, do not redistribute)' },
]

const DIFFICULTIES = ['easy', 'intermediate', 'advanced']
const TARGETS = ['solo-piano', 'solo-guitar']

mkdirSync(outDir, { recursive: true })
const manifest = { version: 1, generatedAt: new Date().toISOString(), items: [] }

for (const item of ITEMS) {
  if (!existsSync(item.path)) {
    console.log(`skip ${item.id} (missing ${item.path})`)
    continue
  }
  console.log(`--- ${item.id}`)
  const wav = readWavPcm(item.path)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpNotes = bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude }))
  const entry = {
    id: item.id,
    source: item.source,
    license: item.license,
    audioPath: item.path,
    durationSeconds: Math.round((mono.length / 22050) * 10) / 10,
    variants: [],
  }
  for (const targetPart of TARGETS) {
    for (const difficulty of DIFFICULTIES) {
      const out = await runAudioArrangementPipeline(
        { name: `${item.id}.mp3`, size: 99, type: 'audio/mpeg' },
        new ArrayBuffer(8),
        { targetPart, difficulty, title: `${item.id} — ${targetPart} ${difficulty}` },
        {
          decodeAudioDataImpl: async () => ({
            channelData: [Float32Array.from(wav.samples)],
            sampleRate: wav.sampleRate,
            durationSeconds: wav.samples.length / wav.sampleRate,
            channelCount: 1,
          }),
          predictNotes: async () => bpNotes,
        },
      )
      if (!out.ok) {
        entry.variants.push({ targetPart, difficulty, ok: false, code: out.code, message: out.message })
        continue
      }
      const file = `${item.id}--${targetPart}--${difficulty}.musicxml`
      writeFileSync(join(outDir, file), out.musicXml)
      // Playable preview: derived FROM THE ENGRAVED SCORE (parseMusicXml), not
      // from a recomputed event list, so preview and score cannot disagree by
      // construction. Tied barline segments are merged like the practice engine
      // does. scripts/audio-vision-preview-verify.mjs proves the round trip.
      const midiFile = file.replace('.musicxml', '.mid')
      try {
        const timingMap = parseMusicXml(out.musicXml, file)
        const bpm = timingMap.tempoChanges?.[0]?.bpm ?? out.transcribed.tempo.bpm
        const notes = mergeTiedContinuations(
          (timingMap.notes ?? []).filter((n) => !n.isRest && Number.isFinite(n.midi) && Number.isFinite(n.timeSeconds)),
        )
        const events = notes.map((n) => ({
          timeSeconds: n.timeSeconds,
          midi: n.midi,
          durationSeconds: Math.max(0.05, (n.durationSeconds ?? 0.25)),
          velocity: Number.isFinite(n.velocity)
            ? (n.velocity <= 1 ? Math.max(1, Math.round(n.velocity * 127)) : n.velocity)
            : 64,
        }))
        if (events.length) {
          writeFileSync(join(outDir, midiFile), writeSmf(events, { tempoBpm: bpm }))
        }
            } catch (error) {
        // Previews are a convenience; never fail the score over one.
        console.warn(`preview skipped for ${file}: ${String(error?.message ?? error).slice(0, 100)}`)
      }
      entry.variants.push({
        targetPart,
        difficulty,
        ok: true,
        file,
        midiFile: existsSync(join(outDir, midiFile)) ? midiFile : null,
        tempoBpm: out.transcribed.tempo.bpm,
        notes: out.model.parts[0].events.length,
        measures: new Set(out.model.parts[0].events.map((e) => e.measureIndex)).size,
        confidence: out.confidence.overall,
        pitchSource: out.confidence.pitchSource,
        agreement: out.transcriptionAgreement,
        uncertainRegions: (out.uncertainRegions ?? []).length,
        suppressedHarmonics: out.suppressedHarmonics ?? 0,
        warnings: out.model.parts[0].warnings,
        excerpt: out.excerpt,
        license: item.license,
      })
      console.log(`  ${targetPart}/${difficulty}: ${out.model.parts[0].events.length} notes, conf ${out.confidence.overall}`)
    }
  }
  manifest.items.push(entry)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
const lines = ['# Musician review set (generated, no audio bundled)', '',
  manifest.generatedAt, '',
  'Files are MusicXML in this directory. Audio references stay outside the repo.', '',
  '| recording | variant | notes | measures | tempo | conf | agreement | uncertain |', '|---|---|---|---|---|---|---|---|']
for (const item of manifest.items) {
  for (const v of item.variants) {
    if (!v.ok) {
      lines.push(`| ${item.id} | ${v.targetPart}/${v.difficulty} | — | — | — | — | — | REFUSED: ${v.code} |`)
      continue
    }
    lines.push(`| ${item.id} | ${v.targetPart}/${v.difficulty} | ${v.notes} | ${v.measures} | ${v.tempoBpm} | ${v.confidence} | ${v.agreement ?? '—'} | ${v.uncertainRegions} |`)
  }
}
writeFileSync(join(outDir, 'README.md'), lines.join('\n') + '\n')
console.log(`\nwrote ${manifest.items.length} items x ${DIFFICULTIES.length * TARGETS.length} variants to ${outDir}`)
