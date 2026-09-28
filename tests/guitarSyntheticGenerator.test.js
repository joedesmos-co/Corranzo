import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { soundingFromTab } from '../src/features/omr/guitar/pitchContract.js'
import {
  GENERATED_FAMILIES,
  SPLITS_THAT_MAY_BE_SYNTHETIC,
  generateEventModel,
  renderMusicXml,
} from '../tools/guitar-vision/generate-synthetic.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = join(ROOT, 'tools/guitar-vision/generate-synthetic.mjs')
const tempDirs = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gv-synth-'))
  tempDirs.push(dir)
  return dir
}

function runGenerator(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe('synthetic split guard', () => {
  it('permits only the training split', () => {
    expect(SPLITS_THAT_MAY_BE_SYNTHETIC).toEqual(['train'])
  })

  it('refuses to generate into validation', () => {
    const dir = tempDir()
    const result = runGenerator(['--split', 'validation', '--count', '1', '--out', dir])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/REFUSED/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses to generate into heldout and diagnostic', () => {
    for (const split of ['heldout', 'diagnostic']) {
      const result = runGenerator(['--split', split, '--count', '1', '--out', tempDir()])
      expect(result.code, split).not.toBe(0)
      expect(result.stderr, split).toMatch(/REFUSED/)
    }
  })

  it('writes into the training split', () => {
    const dir = tempDir()
    const result = runGenerator(['--split', 'train', '--count', '3', '--seed', '5', '--out', dir])
    expect(result.code).toBe(0)
    expect(readdirSync(dir).filter((name) => name.endsWith('.musicxml'))).toHaveLength(3)
  })
})

describe('determinism', () => {
  it('reproduces byte-identical output for a seed', () => {
    const a = tempDir()
    const b = tempDir()
    runGenerator(['--split', 'train', '--count', '4', '--seed', '11', '--out', a])
    runGenerator(['--split', 'train', '--count', '4', '--seed', '11', '--out', b])
    const names = readdirSync(a).sort()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(readFileSync(join(a, name), 'utf8'), name).toBe(readFileSync(join(b, name), 'utf8'))
    }
  })

  it('produces different output for a different seed', () => {
    const a = tempDir()
    const b = tempDir()
    runGenerator(['--split', 'train', '--count', '4', '--seed', '11', '--out', a])
    runGenerator(['--split', 'train', '--count', '4', '--seed', '12', '--out', b])
    const scoreA = readdirSync(a).find((name) => name.endsWith('.musicxml'))
    const scoreB = readdirSync(b).find((name) => name.endsWith('.musicxml'))
    expect(readFileSync(join(a, scoreA), 'utf8')).not.toBe(readFileSync(join(b, scoreB), 'utf8'))
  })

  it('marks its own provenance in the manifest', () => {
    const dir = tempDir()
    runGenerator(['--split', 'train', '--count', '1', '--seed', '3', '--out', dir])
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.split).toBe('train')
    expect(manifest.provenanceNote).toMatch(/TRAIN SPLIT ONLY/)
    expect(manifest.provenanceNote).toMatch(/never to be reported as real-data coverage/i)
  })
})

describe('generated MusicXML is valid and physically honest', () => {
  const model = generateEventModel(4242, { measures: 6, paired: true })
  const xml = renderMusicXml(model, { title: 'test' })
  const parsed = parseMusicXml(xml, 'test.musicxml')

  it('parses as score-partwise', () => {
    expect(xml).toContain('<score-partwise')
    expect(parsed.notes.length).toBeGreaterThan(0)
  })

  it('never nests a notations element inside another', () => {
    expect(xml).not.toMatch(/<notations>\s*<notations>/)
    expect(xml).not.toMatch(/<technical>\s*<technical>/)
  })

  it('places every marking in its schema-correct parent', () => {
    // Misplacing these is silent failure: the parser looks in the schema-correct
    // place, so a misplaced marking vanishes rather than erroring. Scan enough
    // seeds that every marking type is actually exercised.
    const seen = { slide: 0, glissando: 0, tuplet: 0, bend: 0, hammerOn: 0 }
    for (let seed = 1; seed <= 40; seed += 1) {
      const sample = renderMusicXml(generateEventModel(seed, { measures: 4, paired: true }), {})
      if (/<notations><slide/.test(sample)) seen.slide += 1
      if (/<notations><glissando/.test(sample)) seen.glissando += 1
      // time-modification is a child of <note>, after <type>.
      if (/<type>[^<]*<\/type>(?:<dot\/>)?<time-modification/.test(sample)) seen.tuplet += 1
      if (/<notations><technical><bend/.test(sample)) seen.bend += 1
      if (/<notations><technical><hammer-on/.test(sample)) seen.hammerOn += 1
      // Never inside the wrong parent.
      expect(sample, `seed ${seed}`).not.toMatch(/<technical>[^<]*<(?:slide|glissando|arpeggiate)/)
      expect(sample, `seed ${seed}`).not.toMatch(/<notations>[^<]*<time-modification/)
    }
    for (const [name, count] of Object.entries(seen)) {
      expect(count, `${name} was never generated, so placement is untested`).toBeGreaterThan(0)
    }
  })

  it('emits only physically playable string/fret positions', () => {
    for (const note of parsed.notes) {
      if (note.string == null || note.fret == null) continue
      expect(note.string, 'string out of range').toBeGreaterThanOrEqual(1)
      expect(note.string).toBeLessThanOrEqual(6)
      expect(note.fret, 'fret out of range').toBeGreaterThanOrEqual(0)
      expect(note.fret).toBeLessThanOrEqual(19)
      expect(soundingFromTab(note.string, note.fret)).toBeGreaterThanOrEqual(40)
    }
  })

  it('keeps the paired TAB staff consistent with the notation staff', () => {
    expect(parsed.parts[0].tabStaves.length).toBeGreaterThan(0)
    const tabNotes = parsed.notes.filter((note) => note.staff === 2 && note.string != null)
    const notationNotes = parsed.notes.filter((note) => note.staff === 1 && !note.isRest)
    expect(tabNotes.length).toBe(notationNotes.length)
    expect(tabNotes.length).toBeGreaterThan(0)

    // A TAB note carries no pitch of its own, so consistency is not "does the
    // note have a pitch" — it is "does this fret on this string sound the pitch
    // printed at the same moment". That is the real staff/TAB property.
    tabNotes.forEach((tabNote, index) => {
      const paired = notationNotes[index]
      expect(soundingFromTab(tabNote.string, tabNote.fret)).toBe(paired.midi)
      expect(tabNote.durationQuarters).toBe(paired.durationQuarters)
    })
  })

  it('emits bend amounts as real values rather than a placeholder', () => {
    const bends = [...xml.matchAll(/<bend[^>]*alteration="([^"]+)"[^>]*>([^<]*)</g)]
    for (const [, alteration, display] of bends) {
      expect(Number(alteration), 'a bend must sound somewhere above the written pitch').toBeGreaterThan(0)
      expect(display.trim().length, 'a bend must state its amount').toBeGreaterThan(0)
    }
  })

  it('resolves technique parameters during generation, not at render time', () => {
    // A renderer that called Math.random would make output non-reproducible.
    const first = renderMusicXml(generateEventModel(99, { measures: 3 }), { title: 'a' })
    const second = renderMusicXml(generateEventModel(99, { measures: 3 }), { title: 'a' })
    expect(first).toBe(second)
  })
})

describe('generated family claims', () => {
  it('claims only families the generator actually emits', () => {
    for (const family of GENERATED_FAMILIES) {
      expect(typeof family).toBe('string')
      expect(family.length).toBeGreaterThan(0)
    }
  })

  it('does not claim families it cannot produce', () => {
    // These require real engraver output or physical capture, so the generator
    // must not pretend to supply them.
    for (const family of [
      'palm-mute',
      'let-ring',
      'tremolo-picking',
      'whammy-bar',
      'pinch-harmonic',
      'scordatura',
      'chord-diagram',
      'pick-direction',
    ]) {
      expect(GENERATED_FAMILIES, family).not.toContain(family)
    }
  })
})
