#!/usr/bin/env node
/**
 * Import curated Practice Library assets from Mutopia (PDF + MIDI → MusicXML).
 *
 * Usage:
 *   npm run fixtures:practice-library
 *
 * Requires:
 *   python3 -m venv .venv-fixtures && .venv-fixtures/bin/pip install music21
 *
 * Local-only pieces (Minuet, Hungarian Dance) are left in place.
 * Generated sketch folders are removed after a successful import.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'public/fixtures/practice-library/manifest.json')
const outRoot = join(root, 'public/fixtures/practice-library')
const venvPython = join(root, '.venv-fixtures', 'bin', 'python3')

const GENERATED_SKETCH_DIRS = [
  'guitar-amazing-grace',
  'guitar-when-the-saints',
  'guitar-aura-lee',
  'guitar-ode-to-joy',
]

async function fetchBuffer(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function ensureMusicXmlFromMidi(midiPath, xmlPath) {
  if (!existsSync(venvPython)) {
    throw new Error(
      'Missing .venv-fixtures — run: python3 -m venv .venv-fixtures && .venv-fixtures/bin/pip install music21',
    )
  }
  const script = `
from music21 import converter
s = converter.parse(${JSON.stringify(midiPath)})
s.write('musicxml', ${JSON.stringify(xmlPath)})
`
  const result = spawnSync(venvPython, ['-c', script], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'music21 conversion failed')
  }
}

function patchMusicXmlMetadata(xml, piece) {
  let patched = xml
  const title = piece.title.replace(/[<>&]/g, '')
  if (patched.includes('<work-title>')) {
    patched = patched.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${title}</work-title>`)
  } else {
    patched = patched.replace(
      '<score-partwise',
      `<score-partwise version="3.1"><work><work-title>${title}</work-title></work>`,
    )
  }
  if (!patched.includes('<rights>')) {
    patched = patched.replace(
      '</identification>',
      `<rights>${piece.license} — ${piece.provenance}</rights></identification>`,
    )
  }
  return patched
}

async function importPiece(piece) {
  if (piece.localAssets) {
    for (const rel of Object.values(piece.localAssets)) {
      const abs = join(root, rel)
      if (!existsSync(abs)) {
        throw new Error(`Missing local asset for ${piece.id}: ${rel}`)
      }
    }
    console.log(`✓ local ${piece.id}`)
    return
  }

  const dir = join(outRoot, piece.id)
  mkdirSync(dir, { recursive: true })
  const pdfPath = join(dir, `${piece.id}.pdf`)
  const midiPath = join(dir, `${piece.id}.mid`)
  const xmlPath = join(dir, `${piece.id}.musicxml`)

  if (existsSync(pdfPath) && existsSync(midiPath) && existsSync(xmlPath)) {
    console.log(`· cached ${piece.id}`)
    return
  }

  console.log(`↓ ${piece.id}`)
  const [pdfBuf, midiBuf] = await Promise.all([
    fetchBuffer(piece.pdfUrl),
    fetchBuffer(piece.midiUrl),
  ])
  writeFileSync(pdfPath, pdfBuf)
  writeFileSync(midiPath, midiBuf)
  ensureMusicXmlFromMidi(midiPath, xmlPath)
  const xml = patchMusicXmlMetadata(readFileSync(xmlPath, 'utf8'), piece)
  writeFileSync(xmlPath, xml)
  console.log(`✓ imported ${piece.id}`)
}

function removeGeneratedSketches() {
  for (const id of GENERATED_SKETCH_DIRS) {
    const dir = join(outRoot, id)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      console.log(`removed generated sketch ${id}`)
    }
  }
  const legacyGuitar = join(root, 'public/fixtures/guitar-ode-to-joy')
  if (existsSync(legacyGuitar)) {
    // Keep legacy demo folder only if still referenced — Sprint 4 replaces it.
    // Leave files but catalog no longer points here.
  }
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  mkdirSync(outRoot, { recursive: true })

  for (const piece of manifest.pieces) {
    await importPiece(piece)
  }

  removeGeneratedSketches()

  const byInstrument = { piano: {}, guitar: {} }
  for (const piece of manifest.pieces) {
    const bucket = byInstrument[piece.instrumentId] ?? (byInstrument[piece.instrumentId] = {})
    bucket[piece.difficulty] = (bucket[piece.difficulty] ?? 0) + 1
  }
  console.log('\nCatalog counts:')
  console.log(JSON.stringify(byInstrument, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
