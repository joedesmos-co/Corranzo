import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'

/**
 * Tied-note duration integrity.
 *
 * One tie chain = one sounding note. The parser merges the chain into its
 * head (`applyTieSustainToNotes`); every downstream layer — WFY checkpoints,
 * visual lane, playback schedule — must report the SAME duration. Regression
 * guard for the double-count where the checkpoint layer added a
 * continuation's duration a second time (2q tied to 2q reported as 6q).
 */

function note(step, octave, duration, extra = '') {
  return `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`
}
function rest(duration) {
  return `<note><rest/><duration>${duration}</duration></note>`
}
function voiced(voice, step, octave, duration, extra = '') {
  return `<note><voice>${voice}</voice><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type>${extra}</note>`
}
function attrs(divisions = 1) {
  return `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
}
function wrap(partsXml, partList = null) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">${partList ?? '<part-list><score-part id="P1"><part-name>Tie</part-name></score-part></part-list>'}${partsXml}</score-partwise>`
}
function part(id, measuresXml) {
  return `<part id="${id}">${measuresXml}</part>`
}
function measure(number, body) {
  return `<measure number="${number}">${body}</measure>`
}
const TIE_START = '<tie type="start"/>'
const TIE_STOP = '<tie type="stop"/>'

/** Durations of every tie chain head at one pipeline layer. */
function tieHeadDurations(checkpoints) {
  return checkpoints
    .flatMap((checkpoint) => checkpoint.notes ?? [])
    .filter((note) => note.tieStart && !note.suppressPlaybackAttack)
    .map((note) => note.durationQuarters)
}

function tieHeads(timingMap) {
  return timingMap.notes.filter((note) => note.tieStart && !note.suppressPlaybackAttack)
}

describe('tie chain merging — parser layer', () => {
  it('merges a 2q+2q tie into one 4q sounding note', () => {
    const xml = wrap(part('P1', measure(1, attrs() + note('C', 4, 2, TIE_START) + note('C', 4, 2, TIE_STOP))))
    const timingMap = parseMusicXml(xml, 'tie.musicxml')
    const heads = tieHeads(timingMap)
    expect(heads).toHaveLength(1)
    expect(heads[0].durationQuarters).toBeCloseTo(4, 9)
    expect(heads[0].durationSeconds).toBeCloseTo(2, 9) // 4q at 120bpm
    expect(heads[0].writtenDurationQuarters).toBeCloseTo(2, 9)
    expect(heads[0].tiedChainDurationQuarters).toBeCloseTo(4, 9)
    expect(heads[0].tieChainNoteCount).toBe(2)
    // The continuation is sustain, not a new attack.
    const continuation = timingMap.notes.find((note) => note.tieStop && !note.tieStart)
    expect(continuation.suppressPlaybackAttack).toBe(true)
    expect(timingMap.notes.filter((note) => !note.isRest && note.midi != null && !note.suppressPlaybackAttack)).toHaveLength(1)
  })

  it('merges ties across barlines and multi-measure chains', () => {
    const xml = wrap(
      part(
        'P1',
        measure(1, attrs() + note('C', 4, 2, TIE_START) + rest(2)) +
          measure(2, note('C', 4, 2, TIE_STOP) + note('D', 4, 2)) +
          measure(3, note('E', 4, 1, TIE_START) + rest(3)) +
          measure(4, note('E', 4, 1, TIE_START + TIE_STOP) + note('E', 4, 2, TIE_STOP) + rest(0)),
      ),
    )
    const timingMap = parseMusicXml(xml, 'ties.musicxml')
    const heads = tieHeads(timingMap)
    expect(heads.map((note) => note.durationQuarters)).toEqual([4, 4])
    expect(heads[1].tieChainNoteCount).toBe(3)
  })

  it('ties a chord fully and partially without inventing attacks', () => {
    const fullyTied =
      wrap(
        part(
          'P1',
          measure(1, attrs() + note('C', 4, 2, TIE_START) + note('E', 4, 2, '<chord/>' + TIE_START) + rest(2)) +
            measure(2, note('C', 4, 2, TIE_STOP) + note('E', 4, 2, '<chord/>' + TIE_STOP) + rest(2)),
        ),
      )
    const fully = parseMusicXml(fullyTied, 'full.musicxml')
    expect(tieHeadDurations([{ notes: tieHeads(fully) }])).toEqual([4, 4])
    expect(fully.notes.filter((note) => !note.isRest && !note.suppressPlaybackAttack)).toHaveLength(2)

    const partial =
      wrap(
        part(
          'P1',
          measure(1, attrs() + note('C', 4, 2, TIE_START) + note('G', 4, 2, '<chord/>') + rest(2)) +
            measure(2, note('C', 4, 2, TIE_STOP) + note('G', 4, 2) + note('A', 4, 2)),
        ),
      )
    const partly = parseMusicXml(partial, 'partial.musicxml')
    const cHead = partly.notes.find((note) => note.midi === 60 && note.tieStart)
    const gNote = partly.notes.find((note) => note.midi === 67 && !note.suppressPlaybackAttack)
    expect(cHead.durationQuarters).toBeCloseTo(4, 9)
    // The untied chord mate keeps its own written duration and its own attack,
    // and the re-struck G in the next measure stays a separate attack.
    expect(gNote.durationQuarters).toBeCloseTo(2, 9)
    expect(partly.notes.filter((note) => !note.isRest && !note.suppressPlaybackAttack)).toHaveLength(4)
  })

  it('keeps repeated same-pitch notes without ties as separate attacks', () => {
    const xml = wrap(part('P1', measure(1, attrs() + note('F', 4, 2) + note('F', 4, 2))))
    const timingMap = parseMusicXml(xml, 'repeat.musicxml')
    expect(tieHeads(timingMap)).toHaveLength(0)
    const attacks = timingMap.notes.filter((note) => !note.isRest && !note.suppressPlaybackAttack)
    expect(attacks).toHaveLength(2)
    expect(attacks.every((note) => note.durationQuarters === 2)).toBe(true)
  })

  it('keeps separate same-pitch tie chains distinct (chain identity)', () => {
    // C tied 1q+1q, then another C tied 1q+1q — each chain must keep its own
    // duration, and no cross-chain absorption (Aguado op03-4/5 regression).
    const xml = wrap(
      part(
        'P1',
        measure(
          1,
          attrs() +
            note('C', 4, 1, TIE_START) +
            note('C', 4, 1, TIE_STOP) +
            note('D', 4, 1) +
            note('C', 4, 1, TIE_START) +
            note('C', 4, 1, TIE_STOP),
        ),
      ),
    )
    const timingMap = parseMusicXml(xml, 'chains.musicxml')
    const heads = tieHeads(timingMap)
    expect(heads).toHaveLength(2)
    expect(heads.map((note) => note.durationQuarters)).toEqual([2, 2])
    expect(new Set(heads.map((note) => note.tieChainId)).size).toBe(2)
  })

  it('continues a voice-2 chain from a voice-less tie-stop (<voice> is optional)', () => {
    // music21 exports often drop <voice> on tie continuations; without the
    // voice-less fallback the stop defaults to voice 1, misses its voice-2
    // head, and re-attacks a note that should sustain.
    const xml = wrap(
      part(
        'P1',
        measure(
          1,
          attrs() +
            voiced(1, 'C', 5, 2) +
            rest(2) +
            '<backup><duration>4</duration></backup>' +
            voiced(2, 'E', 4, 2, TIE_START),
        ) +
          measure(2, note('E', 4, 2, TIE_STOP) + rest(2)),
      ),
    )
    const timingMap = parseMusicXml(xml, 'voiceless.musicxml')
    const heads = tieHeads(timingMap)
    expect(heads).toHaveLength(1)
    expect(heads[0].durationQuarters).toBeCloseTo(4, 9)
    const continuation = timingMap.notes.find((note) => note.tieStop && !note.tieStart)
    expect(continuation.suppressPlaybackAttack).toBe(true)
    expect(timingMap.notes.filter((note) => !note.isRest && !note.suppressPlaybackAttack)).toHaveLength(2)
  })

  it('keeps independent per-voice tie chains separate', () => {
    const xml = wrap(
      part(
        'P1',
        measure(
          1,
          attrs() +
            voiced(1, 'C', 5, 2, TIE_START) +
            rest(2) +
            '<backup><duration>4</duration></backup>' +
            voiced(2, 'E', 4, 4, TIE_START),
        ) +
          measure(
            2,
            voiced(1, 'C', 5, 2, TIE_STOP) +
              voiced(1, 'D', 5, 2) +
              '<backup><duration>4</duration></backup>' +
              voiced(2, 'E', 4, 4, TIE_STOP),
          ),
      ),
    )
    const timingMap = parseMusicXml(xml, 'twovoice.musicxml')
    expect(tieHeads(timingMap).map((note) => note.durationQuarters)).toEqual([4, 8])
  })

  it('does not confuse a slur with a tie', () => {
    const xml = wrap(
      part(
        'P1',
        measure(
          1,
          attrs() +
            note('C', 4, 2, '<notations><slur number="1" type="start"/></notations>') +
            note('D', 4, 2, '<notations><slur number="1" type="stop"/></notations>'),
        ),
      ),
    )
    const timingMap = parseMusicXml(xml, 'slur.musicxml')
    expect(tieHeads(timingMap)).toHaveLength(0)
    expect(timingMap.notes.filter((note) => !note.isRest && !note.suppressPlaybackAttack)).toHaveLength(2)
    expect(timingMap.notes.filter((note) => (note.slurs ?? []).length > 0)).toHaveLength(2)
  })

  it('keeps chain durations across a tempo change', () => {
    // The tied note reaches the barline (rest first), so the chain is
    // musically contiguous: 2q at 120bpm (1s) then 2q at 60bpm (2s).
    const xml = wrap(
      part(
        'P1',
        measure(1, attrs() + '<direction><sound tempo="120"/></direction>' + rest(2) + note('C', 4, 2, TIE_START)) +
          measure(2, '<direction><sound tempo="60"/></direction>' + note('C', 4, 2, TIE_STOP) + note('D', 4, 2)),
      ),
    )
    const timingMap = parseMusicXml(xml, 'tempo.musicxml')
    const head = tieHeads(timingMap)[0]
    expect(head.quarterTime).toBeCloseTo(2, 9)
    expect(head.durationQuarters).toBeCloseTo(4, 9)
    expect(head.durationSeconds).toBeCloseTo(3, 9)
  })
})

describe('tie chain merging — practice layers', () => {
  it('reports one duration through WFY checkpoints and the visual lane', () => {
    const xml = wrap(
      part(
        'P1',
        measure(1, attrs() + note('C', 4, 2, TIE_START) + note('C', 4, 2, TIE_STOP) + note('D', 4, 4)),
      ),
    )
    const timingMap = parseMusicXml(xml, 'tie.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    const lane = buildVisualLaneGroups(timingMap)

    expect(tieHeadDurations(checkpoints)).toEqual([4])
    expect(tieHeadDurations(lane)).toEqual([4])

    const head = checkpoints.flatMap((checkpoint) => checkpoint.notes ?? []).find((note) => note.tieStart)
    expect(head.durationQuarters).toBeCloseTo(4, 9)
    expect(head.durationSeconds).toBeCloseTo(2, 9)
    expect(head.tiedContinuations).toHaveLength(1)
    expect(head.hasTiedSustain).toBe(true)
  })

  it('never double-counts a continuation in checkpoint durations', () => {
    // The F1 regression: 2q + 2q reported as 6q.
    const xml = wrap(
      part('P1', measure(1, attrs() + note('C', 4, 2, TIE_START) + note('C', 4, 2, TIE_STOP))),
    )
    const timingMap = parseMusicXml(xml, 'f1.musicxml')
    const checkpointHeads = buildNoteCheckpoints(timingMap).flatMap((checkpoint) => checkpoint.notes ?? [])
    for (const note of checkpointHeads) {
      const source = timingMap.notes.find((candidate) => candidate.id === note.id)
      expect(note.durationQuarters).toBeCloseTo(source.durationQuarters, 9)
      expect(note.durationSeconds).toBeCloseTo(source.durationSeconds, 9)
    }
  })

  it('produces one playable WFY target per tie chain', () => {
    const xml = wrap(
      part(
        'P1',
        measure(1, attrs() + note('C', 4, 2, TIE_START) + rest(2)) +
          measure(2, note('C', 4, 2, TIE_STOP) + note('D', 4, 2)),
      ),
    )
    const timingMap = parseMusicXml(xml, 'barline.musicxml')
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints).toHaveLength(2)
    const tied = checkpoints.find((checkpoint) => checkpoint.expectedMidis?.includes(60))
    expect(tied.expectedMidis).toEqual([60])
    // The sustained note must not become a second requirement.
    expect(checkpoints.filter((checkpoint) => checkpoint.expectedMidis?.includes(60))).toHaveLength(1)
    expect(checkpoints[1].expectedMidis).toEqual([62])
  })

  it('plays each tie chain once in the playback schedule', () => {
    const xml = wrap(
      part('P1', measure(1, attrs() + note('C', 4, 2, TIE_START) + note('C', 4, 2, TIE_STOP) + note('D', 4, 4))),
    )
    const timingMap = parseMusicXml(xml, 'schedule.musicxml')
    const schedule = buildScoreNoteSchedule(timingMap)
    expect(schedule).toHaveLength(2)
    const tied = schedule.find((event) => event.midi === 60)
    expect(tied.writtenDurationSeconds).toBeCloseTo(2, 9) // 4q sounding at 120bpm
    expect(schedule.find((event) => event.midi === 62).writtenDurationSeconds).toBeCloseTo(2, 9)
  })
})

describe('tie chains in real library scores', () => {
  it('keeps every tie chain duration consistent across layers', async () => {
    const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const dir = join(projectRoot, 'public', 'fixtures', 'practice-library')
    let checkedChains = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      let xmlFile
      try {
        xmlFile = (await readdir(join(dir, entry.name))).find((file) => /\.(musicxml|xml)$/i.test(file))
      } catch {
        continue
      }
      if (!xmlFile) continue
      const timingMap = parseMusicXml(await readFile(join(dir, entry.name, xmlFile), 'utf8'), xmlFile)
      const heads = tieHeads(timingMap)
      if (!heads.length) continue
      const checkpoints = buildNoteCheckpoints(timingMap)
      const byChain = new Map()
      for (const checkpoint of checkpoints) {
        for (const note of checkpoint.notes ?? []) {
          if (note.tieChainId != null && note.tieStart && !note.suppressPlaybackAttack) {
            byChain.set(note.tieChainId, note)
          }
        }
      }
      for (const head of heads) {
        const checkpointHead = byChain.get(head.tieChainId)
        expect(checkpointHead, `${entry.name} chain ${head.tieChainId}`).toBeTruthy()
        expect(checkpointHead.durationQuarters).toBeCloseTo(head.durationQuarters, 9)
        expect(checkpointHead.durationSeconds).toBeCloseTo(head.durationSeconds, 9)
        checkedChains += 1
      }
    }
    expect(checkedChains).toBeGreaterThan(100)
  })
})
