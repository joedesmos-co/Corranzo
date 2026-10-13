/**
 * Materialize the real acceptance corpus locally (audio never committed).
 * Downloads remote sources, cuts excerpts with ffmpeg, writes 44.1 kHz wav +
 * a local manifest with sha + truth pointers for arrangebench.
 *
 * Usage: node scripts/audio-vision-fetch-corpus.mjs [--out /tmp/realcorpus] [--manifest out.json]
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { REAL_CORPUS } from './lib/realCorpus.mjs'

const args = process.argv.slice(2)
const outDir = args[args.indexOf('--out') + 1] ?? '/tmp/realcorpus'
const manifestOut = args[args.indexOf('--manifest') + 1] ?? '/tmp/realcorpus/manifest.json'
mkdirSync(outDir, { recursive: true })

async function download(url, dest, referer = null) {
  if (existsSync(dest) && statSync(dest).size > 1000) {
    console.log(`keep ${dest}`)
    return dest
  }
  console.log(`get ${url}`)
  await new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh)' }
    if (referer) headers.Referer = referer
    import('node:https').then(({ get }) => {
      const go = (u) => get(u, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          go(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          return
        }
        const out = createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => resolve(dest))
        out.on('error', reject)
      }).on('error', reject)
      go(url)
    })
  })
  return dest
}

function sha1Short(path) {
  const h = createHash('sha1')
  h.update(readFileSync(path))
  return h.digest('hex').slice(0, 12)
}

function excerptToWav(src, start, dur, dest) {
  if (existsSync(dest) && statSync(dest).size > 1000) {
    console.log(`keep ${dest}`)
    return dest
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(dur), '-i', src, '-ar', '44100', '-ac', '1', dest])
  console.log(`cut ${dest}`)
  return dest
}

const entries = []
// In-repo mic-real guitar clips with truth (arrangement-grade subset: single/dyad/chord/dense).
{
  const mic = JSON.parse(readFileSync('benchmarks/mic-real/manifest.json', 'utf8'))
  const excluded = new Set((mic.excluded ?? []).map((e) => e.id))
  const want = ['acoustic-jazz-single', 'acoustic-jazz-dyad', 'acoustic-bossa-chord', 'acoustic-strum-dense',
    'acoustic-funk-dense', 'acoustic-rock-dense', 'electric-eg01-dense', 'electric-eg10-dense']
  for (const id of want) {
    const clip = mic.clips.find((c) => c.id === id)
    if (!clip || excluded.has(id)) continue
    entries.push({
      id: `mic-real-${id}`,
      audio: `benchmarks/mic-real/${clip.audio.file}`,
      truthNotes: clip.truth.notes.map((n) => ({ midi: n.midi, onset: n.onset })),
      truthOffsets: clip.truth.notes.map((n) => ({ offset: Number.isFinite(n.offset) ? n.offset : n.onset + 0.5 })),
      license: clip.license,
      attribution: clip.attribution,
      difficulties: ['easy', 'advanced'],
    })
  }
}

for (const src of REAL_CORPUS.sources) {
  if (src.kind !== 'remote') continue
  try {
  const ext = src.url.endsWith('.flac') ? 'flac' : 'mp3'
  const raw = join(outDir, `${src.id}-full.${ext}`)
  await download(src.url, raw, src.fetch?.referer ?? null)
  const wav = join(outDir, `${src.id}-excerpt.wav`)
  excerptToWav(raw, src.excerpt.startSeconds, src.excerpt.durationSeconds, wav)
  entries.push({
    id: src.id,
    audio: wav,
    truthNotes: null,
    license: src.license,
    attribution: src.attribution,
    sha1: sha1Short(wav),
    difficulties: ['easy', 'intermediate', 'advanced'],
  })
  } catch (error) {
    // Remote sources are best-effort (rate limits/offline host). Local TRIOS
    // and GuitarSet material carries all graded truth, so skip and continue.
    console.warn(`skip remote ${src.id}: ${String(error?.message ?? error).slice(0, 120)}`)
  }
}

// GuitarSet full performances (CC-BY-4.0): local tracks + JAMS truth.
// Only added when the local archive has been extracted (see realCorpus.mjs).
{
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
  // Solo baselines previously validated, plus every comp track whose JAMS
  // carries chord labels (one recording per style: BN1-3, Funk1-3, Jazz1-3,
  // Rock1-3, SS1-3) -> independent labeled recordings, not adjacent windows.
  const gsTracks = [
    { id: 'guitarset-jazz-solo', wav: '/tmp/guitarset/tracks/04_Jazz1-200-B_solo_mic.wav', jams: '/tmp/guitarset/jams/04_Jazz1-200-B_solo.jams' },
    { id: 'guitarset-ss-comp', wav: '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav', jams: '/tmp/guitarset/jams/00_SS3-84-Bb_comp.jams' },
    ...['00_BN1-129-Eb', '00_BN2-131-B', '00_BN3-119-G', '00_Funk1-114-Ab', '00_Funk2-108-Eb', '00_Funk3-112-C#', '00_Jazz1-130-D', '00_Jazz2-110-Bb', '00_Jazz3-137-Eb', '00_Rock1-130-A', '00_Rock2-142-D', '00_Rock3-117-Bb', '00_SS1-100-C#', '00_SS2-107-Ab']
      .map((base) => ({ id: `guitarset-${base.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`, wav: `/tmp/guitarset/${base}_comp_mic.wav`, jams: `/tmp/guitarset/jams/${base}_comp.jams` })),
  ]
  for (const t of gsTracks) {
    if (!existsSync(t.wav) || !existsSync(t.jams)) continue
    const jams = JSON.parse(readFileSync(t.jams, 'utf8'))
    const truthNotes = []
    const truthOffsets = []
    const beatIndex = []
    for (const a of jams.annotations) {
      if (a.namespace === 'beat_position' && Array.isArray(a.data)) {
        for (const b of a.data) if (b.value && b.value.measure) beatIndex.push(b)
      }
      if (a.namespace !== 'note_midi' || !Array.isArray(a.data)) continue
      for (const n of a.data) {
        if (!Number.isFinite(n.time) || !Number.isFinite(n.value)) continue
        truthNotes.push({ midi: Math.round(n.value), onset: Math.round(n.time * 1000) / 1000 })
        truthOffsets.push({ offset: Math.round((n.time + (n.duration ?? 0.3)) * 1000) / 1000 })
      }
    }
    const truthChords = []
    const truthBars = []
    for (const a of jams.annotations) {
      if (a.namespace !== 'chord' || !Array.isArray(a.data)) continue
      for (const c of a.data) {
        const m = String(c.value ?? '').match(/^([A-G][#b]?):(maj|min|dim|aug|sus|7|maj7|min7|hdim)?/)
        if (!m) continue
        truthChords.push({
          startSeconds: c.time,
          endSeconds: c.time + (c.duration ?? 0),
          root: PC[m[1]] ?? 0,
          quality: m[2] === 'min' || m[2] === 'min7' ? 'minor' : 'major',
          label: c.value,
        })
        // JAMS also gives the bar each chord starts on: a bar-aligned chord
        // reference (each label covers exactly one 4-beat bar in GuitarSet).
        const beat = beatIndex.find((b) => Math.abs(b.time - c.time) < 1e-6)
        truthBars.push({
          measure: beat?.value?.measure ?? null,
          startSeconds: c.time,
          endSeconds: c.time + (c.duration ?? 0),
          label: c.value,
          root: PC[m[1]] ?? 0,
          quality: m[2] === 'min' || m[2] === 'min7' ? 'minor' : 'major',
        })
      }
      if (truthChords.length) break
    }
    let truthTempo = null
    for (const a of jams.annotations) {
      if (a.namespace === 'tempo' && Array.isArray(a.data) && a.data[0]) {
        truthTempo = a.data[0].value
        break
      }
    }
    truthNotes.sort((a, b) => a.onset - b.onset)
    entries.push({
      id: t.id,
      audio: t.wav,
      truthNotes,
      truthOffsets,
      truthChords,
      truthBars,
      truthTempo,
      license: 'CC-BY-4.0',
      attribution: 'GuitarSet (Xi et al., ISMIR 2018), Zenodo record 3371780',
      difficulties: ['easy', 'intermediate', 'advanced'],
    })
  }
}

// TRIOS score-aligned trios (CC BY-NC-SA 2.0 UK, local eval only).
// Real multi-instrument mixes + drift-free piano parts with MIDI truth.
// Materialized by scripts/lib/extract-trios-truth.py into /tmp/trios-truth.json.
{
  const TRIOS_LICENSE = 'CC BY-NC-SA 2.0 UK (TRIOS Dataset; local eval only, never redistribute)'
  const TRIOS_ATTRIB = 'TRIOS score-aligned multitrack dataset (Fujihara & Goto)'
  try {
    const trios = JSON.parse(readFileSync('/tmp/trios-truth.json', 'utf8'))
    for (const [take, data] of Object.entries(trios.takes)) {
      const takeDir = `/tmp/trios/TRIOS Dataset/${take}`
      const mixAudio = `${takeDir}/mix.wav`
      if (existsSync(mixAudio) && Array.isArray(data.mix?.notes) && data.mix.notes.length) {
        entries.push({
          id: `trios-${take}-mix`,
          audio: mixAudio,
          truthNotes: data.mix.notes,
          truthOffsets: data.mix.notes.map((n) => ({ offset: n.offset ?? n.onset + 0.5 })),
          license: TRIOS_LICENSE,
          attribution: TRIOS_ATTRIB,
          difficulties: ['easy', 'advanced'],
        })
      }
      for (const [part, pdata] of Object.entries(data.parts ?? {})) {
        if (['kick', 'snare', 'ride'].includes(part)) continue
        const partAudio = `${takeDir}/${part}.wav`
        if (!existsSync(partAudio) || !Array.isArray(pdata.notes) || !pdata.notes.length) continue
        entries.push({
          id: `trios-${take}-${part}`,
          audio: partAudio,
          truthNotes: pdata.notes,
          truthOffsets: pdata.notes.map((n) => ({ offset: n.offset ?? n.onset + 0.5 })),
          license: TRIOS_LICENSE,
          attribution: TRIOS_ATTRIB,
          difficulties: part === 'piano' ? ['easy', 'intermediate', 'advanced'] : ['easy', 'advanced'],
        })
      }
    }
  } catch {
    // TRIOS not materialized; entries skipped (see realCorpus.mjs).
  }
}

// HOLDOUT (M1): recordings 01-03 of each style - separate takes, performers
// and tempos from the development tracks (recording 00 + the two baselines).
// Kept in a separate manifest section so nothing here is used for tuning; the
// development ledgers never read it.
const holdoutEntries = [];
{
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
  try {
    const { readFileSync } = await import('node:fs')
    const picked = readFileSync('/tmp/guitarset/holdout.txt', 'utf8').split('\n').filter(Boolean)
    for (const base of picked) {
      const wav = `/tmp/guitarset/${base}_mic.wav`
      const jamsPath = `/tmp/guitarset/jams/${base}.jams`
      if (!existsSync(wav) || !existsSync(jamsPath)) continue
      const jams = JSON.parse(readFileSync(jamsPath, 'utf8'))
      const truthChords = []
      const truthBars = []
      for (const a of jams.annotations) {
        if (a.namespace !== 'chord' || !Array.isArray(a.data)) continue
        for (const c of a.data) {
          const m = String(c.value ?? '').match(/^([A-G][#b]?):(maj|min|dim|aug|sus|7|maj7|min7|hdim)?/)
          if (!m) continue
          const entry = {
            startSeconds: c.time,
            endSeconds: c.time + (c.duration ?? 0),
            root: PC[m[1]] ?? 0,
            quality: m[2] === 'min' || m[2] === 'min7' ? 'minor' : 'major',
            label: c.value,
          }
          truthChords.push(entry)
          truthBars.push({ measure: null, ...entry })
        }
        if (truthChords.length) break
      }
      holdoutEntries.push({
        id: `holdout-${base.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`,
        audio: wav,
        holdout: true,
        truthNotes: [],
        truthChords,
        truthBars,
        license: 'CC-BY-4.0 (local evaluation only)',
        attribution: 'GuitarSet (Xi et al., ISMIR 2018), Zenodo record 3371780 - HOLDOUT recording, never used for tuning',
        difficulties: ['easy', 'intermediate', 'advanced'],
      })
    }
  } catch (error) {
    console.warn(`holdout materialization skipped: ${String(error?.message ?? error).slice(0, 100)}`)
  }
}

writeFileSync(manifestOut, JSON.stringify({ version: 1, entries, holdoutEntries }, null, 2))
console.log(`manifest: ${manifestOut} (${entries.length} dev entries, ${holdoutEntries.length} holdout entries)`)
