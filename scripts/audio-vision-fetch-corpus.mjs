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
      license: clip.license,
      attribution: clip.attribution,
      difficulties: ['easy', 'advanced'],
    })
  }
}

for (const src of REAL_CORPUS.sources) {
  if (src.kind !== 'remote') continue
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
}

// GuitarSet full performances (CC-BY-4.0): local tracks + JAMS truth.
// Only added when the local archive has been extracted (see realCorpus.mjs).
{
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
  const gsTracks = [
    { id: 'guitarset-jazz-solo', wav: '/tmp/guitarset/tracks/04_Jazz1-200-B_solo_mic.wav', jams: '/tmp/guitarset/jams/04_Jazz1-200-B_solo.jams' },
    { id: 'guitarset-ss-comp', wav: '/tmp/guitarset/tracks/00_SS3-84-Bb_comp_mic.wav', jams: '/tmp/guitarset/jams/00_SS3-84-Bb_comp.jams' },
  ]
  for (const t of gsTracks) {
    if (!existsSync(t.wav) || !existsSync(t.jams)) continue
    const jams = JSON.parse(readFileSync(t.jams, 'utf8'))
    const truthNotes = []
    for (const a of jams.annotations) {
      if (a.namespace !== 'note_midi' || !Array.isArray(a.data)) continue
      for (const n of a.data) {
        if (!Number.isFinite(n.time) || !Number.isFinite(n.value)) continue
        truthNotes.push({ midi: Math.round(n.value), onset: Math.round(n.time * 1000) / 1000 })
      }
    }
    const truthChords = []
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
      truthChords,
      truthTempo,
      license: 'CC-BY-4.0',
      attribution: 'GuitarSet (Xi et al., ISMIR 2018), Zenodo record 3371780',
      difficulties: ['easy', 'intermediate', 'advanced'],
    })
  }
}

writeFileSync(manifestOut, JSON.stringify({ version: 1, entries }, null, 2))
console.log(`manifest: ${manifestOut} (${entries.length} entries)`)
