/** Written boundaries, not ratio-sized note buckets, define tuplet membership.
 * Work is bounded to one source scope. Cross-scope/incomplete spans abstain.
 */
export function writtenTupletGroups(notes) {
  const lanes = new Map()
  for (const note of notes) {
    const key = `${note.partId}|${note.voice}`
    if (!lanes.has(key)) lanes.set(key, new Map())
    const events = lanes.get(key)
    if (!events.has(note.offsetQuarters)) events.set(note.offsetQuarters, [])
    events.get(note.offsetQuarters).push(note)
  }
  const groups = []
  for (const events of lanes.values()) {
    const active = new Map()
    let unmarked = []
    const flushUnmarked = () => {
      if (unmarked.length) groups.push({ roles: unmarked, marks: [], reason: 'NO_EXPLICIT_TUPLET_BOUNDARIES' })
      unmarked = []
    }
    for (const roles of [...events.values()].sort((a, b) => a[0].offsetQuarters - b[0].offsetQuarters)) {
      const marks = roles.flatMap(note => (note.tupletMarks ?? []).map(mark => ({ ...mark, eventId: note.id })))
      const modified = roles.some(note => note.timeModification?.actualNotes && note.timeModification?.normalNotes)
      if (!modified && !marks.length) {
        flushUnmarked()
        for (const group of active.values()) {
          group.reason = 'ORDINARY_EVENT_INSIDE_INCOMPLETE_TUPLET'
          groups.push(group)
        }
        active.clear()
        continue
      }
      if (marks.length || active.size) flushUnmarked()
      // Existing groups include this event before stop/start transitions. This
      // permits a shared endpoint and keeps chord/rest members together.
      for (const group of active.values()) group.roles.push(...roles)
      for (const mark of marks) {
        const number = String(mark.number ?? '1')
        if (mark.type === 'start') {
          if (active.has(number)) {
            const previous = active.get(number)
            previous.reason = 'REPEATED_START_WITHOUT_STOP'
            groups.push(previous)
          }
          const group = { roles: [...roles], marks: [mark], number, depth: active.size,
            ratio: mark.ratio ?? null, reason: null }
          active.set(number, group)
        } else if (mark.type === 'stop') {
          const group = active.get(number)
          if (group) {
            if ([...active.keys()].at(-1) !== number) {
              for (const candidate of active.values()) candidate.reason = 'CROSSING_NON_NESTED_TUPLET_BOUNDARIES'
            }
            group.marks.push(mark)
            groups.push(group)
            active.delete(number)
          } else groups.push({ roles: [...roles], marks: [mark], number, reason: 'STOP_WITHOUT_START' })
        } else {
          for (const group of active.values()) group.reason = 'UNSUPPORTED_TUPLET_BOUNDARY_MARK'
        }
      }
      if (!marks.length && !active.size && modified) unmarked.push(...roles)
    }
    flushUnmarked()
    for (const group of active.values()) {
      group.reason ??= 'START_WITHOUT_STOP_IN_SOURCE_SCOPE'
      groups.push(group)
    }
  }
  for (const group of groups) {
    group.roles = [...new Map(group.roles.map(note => [note.id, note])).values()]
    if (group.number) {
      const boundarySequence = group.roles.flatMap(note => (note.tupletMarks ?? [])
        .filter(mark => String(mark.number ?? '1') === group.number).map(mark => mark.type))
      if (JSON.stringify(boundarySequence) !== JSON.stringify(['start', 'stop']))
        group.reason ??= 'CONTRADICTORY_OR_AMBIGUOUS_EXPLICIT_BOUNDARIES'
    }
    const ratios = [...new Map(group.roles.filter(n => n.timeModification).map(n => {
      const r = n.timeModification
      return [`${r.actualNotes}:${r.normalNotes}`, { actualNotes: r.actualNotes, normalNotes: r.normalNotes }]
    })).values()]
    const nested = group.depth > 0 || group.roles.some(note => (note.tupletMarks ?? []).some(m => String(m.number ?? '1') !== group.number))
    if (!group.ratio) {
      if (ratios.length === 1 && !nested) group.ratio = ratios[0]
      else group.reason ??= 'NESTED_OR_INCONSISTENT_RATIO_WITHOUT_EXPLICIT_LEVEL_RATIO'
    }
    if (!(group.ratio?.actualNotes > 0 && group.ratio?.normalNotes > 0)) group.reason ??= 'MISSING_TUPLET_RATIO'
  }
  return groups
}
