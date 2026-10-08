#!/usr/bin/env node
/**
 * Guitar Dataset v2 — Stage 1: ingest (D2 license gate + D6/D7 exact truth).
 *
 * For every candidate: read (.musicxml/.mxl) -> license gate -> parse ->
 * canonical GuitarEvents -> playability -> stable source IDs stamped into a
 * render copy. Writes per-score work records; rendering/joins happen in
 * Stage 2 (dataset-render.py, which owns Verovio).
 *
 * Every candidate ends PASS or QUARANTINED:<reason>. Nothing is silently
 * dropped. Generated fixtures are never candidates.
 *
 * Usage:
 *   node tools/guitar-vision/dataset-ingest.mjs --candidates <json> --work <dir>
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { canonicalEventsFromParsed } from '../../src/features/omr/guitar/guitarCanonicalEvents.js'
import { validatePlayability } from '../../src/features/omr/guitar/guitarPlayability.js'
import { classifyProvenance } from '../../src/features/omr/guitar/provenance.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Licenses accepted for Dataset v2 training data (commercial-compatible). */
export const LICENSE_ALLOWLIST = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'public-domain',
])

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

async function readScoreXml(path) {
  const absolute = resolve(ROOT, path)
  if (!existsSync(absolute)) return { ok: false, error: `missing file: ${path}` }
  try {
    if (path.toLowerCase().endsWith('.mxl')) {
      const zip = await JSZip.loadAsync(readFileSync(absolute))
      const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.musicxml') && !n.startsWith('__MACOSX'))
      if (!names.length) return { ok: false, error: 'mxl contains no .musicxml entry' }
      names.sort()
      const text = await zip.files[names[0]].async('string')
      return { ok: true, xml: text, containerEntry: names[0] }
    }
    return { ok: true, xml: readFileSync(absolute, 'utf8') }
  } catch (error) {
    return { ok: false, error: `read failure: ${error.message}` }
  }
}

/** Stamp stable source IDs on every <note> (pure function of the input). */
export function stampSourceIds(xml, prefix) {
  const ids = []
  let counter = 0
  const stamped = xml.replace(/<note(?=[\s>/])/g, () => {
    counter += 1
    const id = `${prefix}-n${String(counter).padStart(3, '0')}`
    ids.push(id)
    return `<note id="${id}"`
  })
  return { stamped, ids }
}

function classifyScore(parsed, canonical) {
  const clefs = (parsed.parts ?? []).flatMap((p) => p.clefs ?? [])
  const tabStaves = (parsed.parts ?? []).reduce((n, p) => n + (p.tabStaves?.length ?? 0), 0)
  const hasTab = tabStaves > 0 || clefs.some((c) => c.sign === 'TAB')
  const hasStandard = clefs.some((c) => c.sign !== 'TAB') || !hasTab
  if (hasTab && hasStandard) return 'paired'
  if (hasTab) return 'tab-only'
  return 'standard-only'
}

function techniqueCounts(canonical) {
  const counts = {}
  for (const event of canonical.events ?? []) {
    for (const technique of event.techniques ?? []) {
      counts[technique.kind] = (counts[technique.kind] ?? 0) + 1
    }
  }
  return counts
}

function familyPresence(parsed, canonical) {
  const families = new Set()
  const noteKinds = new Set((canonical.events ?? []).map((e) => e.time.noteType).filter(Boolean))
  for (const t of ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th']) {
    if (noteKinds.has(t)) families.add(`duration-${t}`)
  }
  if ((canonical.events ?? []).some((e) => e.time.dots > 0)) families.add('dots')
  if ((canonical.events ?? []).some((e) => e.time.dots > 1)) families.add('double-dots')
  if ((canonical.events ?? []).some((e) => e.time.tuplet)) families.add('tuplet')
  if ((canonical.events ?? []).some((e) => e.time.tie.start || e.time.tie.stop)) families.add('tie')
  if ((canonical.events ?? []).some((e) => e.time.isGrace)) families.add('grace-note')
  if ((canonical.events ?? []).some((e) => e.time.isCue)) families.add('cue-note')
  if ((canonical.events ?? []).some((e) => e.time.isRest)) families.add('rest')
  if ((parsed.measures ?? []).some((m) => m.multipleRest != null)) families.add('measure-rest')
  if ((parsed.measures ?? []).some((m) => m.marking?.forwardRepeat || m.marking?.backwardRepeat)) families.add('repeat')
  if ((parsed.measures ?? []).some((m) => (m.marking?.endingStartNumbers ?? []).length || m.marking?.endingStop)) families.add('ending')
  const voices = new Set((canonical.events ?? []).map((e) => `${e.time.voice}|${e.time.staff}`))
  if (voices.size > 1) families.add('multi-voice-rhythm')
  if ((canonical.events ?? []).some((e) => e.time.isChordTone)) families.add('chord')
  if ((canonical.events ?? []).some((e) => e.tab.string != null)) families.add('string-number')
  if ((canonical.events ?? []).some((e) => e.tab.fret != null)) families.add('fret-number')
  if ((canonical.events ?? []).some((e) => e.tab.pairing === 'verified')) families.add('standard-tab-pairing')
  if ((canonical.events ?? []).some((e) => e.tab.positionKind === 'string-indication')) families.add('string-indication')
  for (const event of canonical.events ?? []) {
    for (const technique of event.techniques ?? []) {
      families.add(`technique:${technique.kind}`)
      if (technique.kind === 'bend' && technique.semitones != null) families.add('bend-amount')
      if (technique.kind === 'harmonic') families.add(technique.artificial ? 'artificial-harmonic' : 'natural-harmonic')
    }
    if (event.deadNote) families.add('dead-note')
    if (event.ghostNote) families.add('ghost-note')
    if (event.notehead && event.notehead.value !== 'normal') families.add('notehead-variant')
    if (event.fingering.left.length || event.fingering.right) families.add('left-hand-fingering')
    if (event.lyric?.text) families.add('lyrics')
    const arts = event.articulations ?? {}
    for (const [key, fam] of [['staccato', 'staccato'], ['accent', 'accent'], ['tenuto', 'tenuto'], ['marcato', 'marcato'], ['fermata', 'fermata'], ['staccatissimo', 'staccatissimo'], ['breathMark', 'breath-mark']]) {
      if (arts[key]) families.add(fam)
    }
    if ((arts.slurs ?? []).length) families.add('slur')
  }
  for (const mark of canonical.navigation ?? []) {
    families.add(`navigation:${mark.kind}`)
    if (mark.kind === 'segno') families.add('segno')
    if (mark.kind === 'coda') families.add('coda')
    if (mark.kind === 'rehearsal') families.add('rehearsal-mark')
    if (mark.kind === 'capo') families.add('capo')
    if (mark.kind === 'position') families.add('position-indication')
    if (mark.kind === 'barre') families.add('barre')
    if (mark.kind === 'octave-shift') families.add('octave-shift')
  }
  if ((canonical.frames ?? []).length) families.add('chord-diagram')
  if ((parsed.harmonyEvents ?? []).length) families.add('chord-symbol')
  if ((parsed.tempoChanges ?? []).length > 1) families.add('tempo-marking')
  if ((parsed.keySignatures ?? []).length) families.add('key-signature')
  for (const event of canonical.events ?? []) {
    if (event.pitch?.accidental) families.add('accidental')
  }
  for (const q of canonical.quarantined ?? []) {
    families.add(`quarantine:${q.code}`)
  }
  return [...families].sort()
}

export async function ingestCandidate(candidate, workDir) {
  const record = {
    candidateId: candidate.id,
    collection: candidate.collection ?? null,
    tier: candidate.tier ?? 'real',
    status: 'PASS',
    quarantineReason: null,
    sourcePath: candidate.path,
  }
  const loaded = await readScoreXml(candidate.path)
  if (!loaded.ok) {
    return { ...record, status: 'QUARANTINED:read-failure', quarantineReason: loaded.error }
  }
  const sourceHash = sha256(loaded.xml)
  Object.assign(record, { sourceHash, sourceBytes: loaded.xml.length })

  // D2 license gate: declared license must allowlist AND rights evidence recorded.
  const declared = candidate.license ?? null
  if (!declared || !LICENSE_ALLOWLIST.includes(declared)) {
    return { ...record, status: 'QUARANTINED:licensing', quarantineReason: `license "${declared}" not in allowlist [${LICENSE_ALLOWLIST.join(', ')}]` }
  }

  let parsed
  try {
    parsed = parseMusicXml(loaded.xml, basename(candidate.path), { includeNonSoundingNotes: true })
  } catch (error) {
    return { ...record, status: 'QUARANTINED:parse-failure', quarantineReason: String(error.message).slice(0, 300) }
  }

  // Provenance backstop: machine output is never a label.
  const verdict = classifyProvenance({ path: candidate.path, text: loaded.xml.slice(0, 20000), declared: { provenance: candidate.provenance ?? 'real-printed', licence: declared } })
  if (!verdict.labelable) {
    return { ...record, status: 'QUARANTINED:provenance', quarantineReason: `provenance=${verdict.provenance} (${verdict.rule})` }
  }

  const canonical = canonicalEventsFromParsed(parsed, {
    sourceId: candidate.id,
    rawXml: loaded.xml,
    includeNonSoundingNotes: true,
  })
  const playability = validatePlayability(canonical)

  // D7 playable-event validation: errors quarantine; infos travel along.
  const errors = [
    ...canonical.quarantined.filter((q) => q.code === 'voice-duration-mismatch' || q.code === 'pairing-pitch-mismatch' || q.code === 'impossible-position' || q.code === 'tie-chain-corrupt'),
    ...playability.issues.filter((i) => i.severity === 'error'),
  ]
  // A handful of quarantined events does not fail a real score; a high
  // defect RATE does (systematic corruption, not local blemishes).
  const sounded = canonical.events.filter((e) => !e.time.isRest && !e.time.isGrace && !e.time.isCue).length || 1
  const defectRate = errors.length / sounded
  if (defectRate > 0.05) {
    return {
      ...record, status: 'QUARANTINED:playability',
      quarantineReason: `${errors.length} errors over ${sounded} sounded events (rate ${(defectRate * 100).toFixed(1)}% > 5%)`,
      sourceHash, eventCount: canonical.events.length, errors: errors.slice(0, 10),
    }
  }

  const classification = classifyScore(parsed, canonical)
  const { stamped, ids } = stampSourceIds(loaded.xml, candidate.id)
  const scoreDir = join(workDir, candidate.id)
  mkdirSync(scoreDir, { recursive: true })
  writeFileSync(join(scoreDir, 'stamped.musicxml'), stamped)
  writeFileSync(join(scoreDir, 'canonical.json'), JSON.stringify(canonical, null, 1))
  writeFileSync(join(scoreDir, 'parse-meta.json'), JSON.stringify({
    title: parsed.title, attribution: parsed.attribution, capo: parsed.capo,
    tuning: (parsed.parts ?? []).map((p) => ({ id: p.id, tuning: p.tuning ?? null, tabStaves: p.tabStaves ?? [] })),
    measures: parsed.measures.length, notes: parsed.notes.length,
    harmonyEvents: (parsed.harmonyEvents ?? []).length, frames: (parsed.frames ?? []).length,
    scoreMarks: parsed.scoreMarks ?? [],
  }, null, 1))

  const fretted = canonical.events.filter((e) => e.tab.fret != null)
  const frets = fretted.map((e) => e.tab.fret)
  return {
    ...record,
    license: declared,
    licenseEvidence: { declared, rights: parsed.attribution?.rights ?? [], encodingSoftware: parsed.attribution?.encodingSoftware ?? null },
    attribution: parsed.attribution ?? null,
    classification,
    eventCount: canonical.events.length,
    soundedCount: sounded,
    pairingsVerified: canonical.events.filter((e) => e.tab.pairing === 'verified').length,
    pairingsQuarantined: canonical.events.filter((e) => e.tab.pairing === 'quarantined').length,
    relations: (canonical.relations ?? []).length,
    navigation: (canonical.navigation ?? []).length,
    frames: (canonical.frames ?? []).length,
    capoFret: canonical.capoFret ?? 0,
    tuning: canonical.tuning ?? null,
    techniques: techniqueCounts(canonical),
    families: familyPresence(parsed, canonical),
    quarantineNotes: canonical.quarantined,
    playabilityOk: playability.ok,
    playabilityIssues: playability.issues,
    frets: { min: frets.length ? Math.min(...frets) : null, max: frets.length ? Math.max(...frets) : null, count: frets.length },
    stampedIds: ids.length,
    quarantinedEvents: canonical.quarantined.filter((q) => q.eventId).length,
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const get = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : fallback
  }
  const candidatesPath = resolve(ROOT, get('--candidates', 'tools/guitar-vision/dataset-candidates.json'))
  const workDir = resolve(ROOT, get('--work', 'datasets/guitar-vision/v2-pilot/work'))
  mkdirSync(workDir, { recursive: true })
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'))
  const records = []
  for (const candidate of candidates) {
    const record = await ingestCandidate(candidate, workDir)
    records.push(record)
    console.log(`${record.status} ${record.candidateId}${record.quarantineReason ? ` — ${record.quarantineReason}` : ''}`)
  }
  writeFileSync(join(workDir, 'ingest-records.json'), JSON.stringify({ version: 'guitar-dataset-ingest/1.0', records }, null, 1))
  const pass = records.filter((r) => r.status === 'PASS').length
  console.log(`PASS ${pass}/${records.length}`)
}
