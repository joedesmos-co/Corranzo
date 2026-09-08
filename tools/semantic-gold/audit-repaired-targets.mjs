/** Independent post-generation checks against original written MusicXML. */
import readline from 'node:readline'
import { parseWrittenNotation } from './assembler.mjs'

export function auditWrittenTargets(xml, records) {
  const notation = parseWrittenNotation(xml)
  const byId = new Map(notation.notes.map(note => [note.id, note]))
  const errors = []
  let tuplets = 0, rests = 0
  for (const record of records) {
    for (const label of record.tuplets) {
      tuplets++
      const members = label.semanticEventIds.map(id => byId.get(id))
      const fail = reason => errors.push({ family: 'TUPLET', label: label.labelId, reason })
      if (!members.length || members.some(n => !n)) { fail('MISSING_WRITTEN_MEMBERS'); continue }
      const first = members[0], number = String(label.value.boundaryNumber)
      const minimum = Math.min(...members.map(n => n.offsetQuarters))
      const maximum = Math.max(...members.map(n => n.offsetQuarters))
      if (members.some(n => n.partId !== first.partId || n.voice !== first.voice || n.measureNumber !== first.measureNumber)) fail('MIXED_LANE_OR_MEASURE')
      const expected = notation.notes.filter(n => n.partId === first.partId && n.voice === first.voice &&
        n.measureNumber === first.measureNumber && n.offsetQuarters >= minimum && n.offsetQuarters <= maximum)
      if (JSON.stringify(expected.map(n => n.id).sort()) !== JSON.stringify(members.map(n => n.id).sort())) fail('MISSING_OR_EXTRANEOUS_SPAN_MEMBERS')
      const marks = members.flatMap(n => n.tupletMarks.filter(m => String(m.number) === number).map(m => ({ ...m, note: n })))
      if (JSON.stringify(marks.map(m => m.type)) !== JSON.stringify(['start', 'stop'])) fail('CONTRADICTORY_EXPLICIT_BOUNDARIES')
      else {
        if (marks[0].note.offsetQuarters !== minimum || marks[1].note.offsetQuarters !== maximum) fail('BOUNDARIES_DO_NOT_MATCH_MEMBERS')
        const ratios = new Map(members.filter(n => n.timeModification).map(n => [
          `${n.timeModification.actualNotes}:${n.timeModification.normalNotes}`, n.timeModification]))
        const ratio = marks[0].ratio ?? (ratios.size === 1 ? [...ratios.values()][0] : null)
        if (label.value.ratio.actualNotes !== ratio?.actualNotes || label.value.ratio.normalNotes !== ratio?.normalNotes) fail('WRITTEN_RATIO_MISMATCH')
      }
      if (label.value.memberEventCount !== new Set(members.map(n => n.offsetQuarters)).size) fail('EVENT_COUNT_MISMATCH')
    }
    for (const item of record.rests) {
      rests++
      const { label, glyphClass, staffRole } = item
      const note = byId.get(label.semanticEventIds[0])
      const fail = reason => errors.push({ family: 'REST', label: label.labelId, reason })
      if (label.semanticEventIds.length !== 1 || !note?.isRest) { fail('NOT_ONE_EXPLICIT_WRITTEN_REST'); continue }
      if (label.value.divisionsNormalizedQuarters !== note.durationQuarters || label.value.dots !== note.dots || label.value.writtenType !== note.noteType) fail('WRITTEN_REST_DURATION_MISMATCH')
      if (JSON.stringify(label.value.timeModification ?? null) !== JSON.stringify(note.timeModification ?? null) || Boolean(label.value.grace) !== note.isGrace) fail('WRITTEN_REST_RATIO_OR_GRACE_MISMATCH')
      // Independent vocabulary comparison; do not call the alignment producer.
      const norm = value => {
        const name = String(value ?? '').replace(/[-_ ]/g, '').toLowerCase()
        const aliases = ['sixteenth', 'thirtysecond', 'sixtyfourth', 'onehundredtwentyeighth',
          'twohundredfiftysixth', 'fivehundredtwelfth', 'onethousandtwentyfourth']
        const types = ['16th', '32nd', '64th', '128th', '256th', '512th', '1024th']
        return types[aliases.indexOf(name)] ?? name
      }
      if (norm(glyphClass) !== norm(note.noteType) || staffRole !== (note.staff === 1 ? 'upper' : note.staff === 2 ? 'lower' : `staff-${note.staff}`)) fail('SOURCE_GLYPH_OR_STAFF_MISMATCH')
    }
  }
  return { tuplets_checked: tuplets, rests_checked: rests, errors }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      const message = JSON.parse(line)
      process.stdout.write(JSON.stringify(auditWrittenTargets(message.xml, message.records)) + '\n')
    } catch (error) { process.stdout.write(JSON.stringify({ error: error.stack }) + '\n') }
  }
}
