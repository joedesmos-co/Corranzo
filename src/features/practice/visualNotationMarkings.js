/**
 * Visual-only notation markings for Visual Practice.
 *
 * These selectors normalize parsed MusicXML fields into a small rendering
 * model. They deliberately do not affect playback timing or Wait For You
 * checkpoints; consumers use them only for SVG decoration.
 */

export const VISUAL_MARKING_KIND = {
  TIE: 'tie',
  SLUR: 'slur',
  STACCATO: 'staccato',
  ACCENT: 'accent',
  TENUTO: 'tenuto',
  HAMMER_ON: 'hammer-on',
  PULL_OFF: 'pull-off',
  SLIDE: 'slide',
  BEND: 'bend',
  VIBRATO: 'vibrato',
}

export const VISUAL_MARKING_SCOPE = {
  NOTE: 'note',
  SPAN: 'span',
}

export const VISUAL_GUITAR_TECHNIQUE_SYMBOLS = {
  [VISUAL_MARKING_KIND.HAMMER_ON]: 'h',
  [VISUAL_MARKING_KIND.PULL_OFF]: 'p',
  [VISUAL_MARKING_KIND.SLIDE]: '/',
  [VISUAL_MARKING_KIND.BEND]: 'b',
  [VISUAL_MARKING_KIND.VIBRATO]: '~',
}

const NOTE_MARKING_KINDS = new Set([
  VISUAL_MARKING_KIND.STACCATO,
  VISUAL_MARKING_KIND.ACCENT,
  VISUAL_MARKING_KIND.TENUTO,
  VISUAL_MARKING_KIND.BEND,
  VISUAL_MARKING_KIND.VIBRATO,
])

const SPAN_TECHNIQUE_KINDS = new Set([
  VISUAL_MARKING_KIND.HAMMER_ON,
  VISUAL_MARKING_KIND.PULL_OFF,
  VISUAL_MARKING_KIND.SLIDE,
])

function visualNoteId(note, group, noteIndex = 0) {
  return note?.visualNoteId ?? note?.id ?? `${group?.id ?? 'group'}-note-${noteIndex}`
}

function markingId(kind, scope, noteId, suffix = '') {
  return `${scope}-${kind}-${noteId}${suffix ? `-${suffix}` : ''}`
}

function normalizeTechniqueKind(kind) {
  switch (kind) {
    case 'hammer-on':
      return VISUAL_MARKING_KIND.HAMMER_ON
    case 'pull-off':
      return VISUAL_MARKING_KIND.PULL_OFF
    case 'slide':
      return VISUAL_MARKING_KIND.SLIDE
    case 'bend':
      return VISUAL_MARKING_KIND.BEND
    case 'vibrato':
      return VISUAL_MARKING_KIND.VIBRATO
    default:
      return null
  }
}

export function buildVisualNoteMarkings(note, { groupId = null } = {}) {
  if (!note) {
    return []
  }
  const noteId = visualNoteId(note, { id: groupId })
  const markings = []
  const push = (kind, extra = {}) => {
    if (!NOTE_MARKING_KINDS.has(kind)) {
      return
    }
    markings.push({
      id: markingId(kind, VISUAL_MARKING_SCOPE.NOTE, noteId),
      kind,
      scope: VISUAL_MARKING_SCOPE.NOTE,
      noteId,
      groupId,
      symbol: VISUAL_GUITAR_TECHNIQUE_SYMBOLS[kind] ?? null,
      source: 'musicxml',
      ...extra,
    })
  }

  if (note.staccato) {
    push(VISUAL_MARKING_KIND.STACCATO)
  }
  if (note.accent) {
    push(VISUAL_MARKING_KIND.ACCENT)
  }
  if (note.tenuto) {
    push(VISUAL_MARKING_KIND.TENUTO)
  }

  for (const technique of note.guitarTechniques ?? []) {
    const kind = normalizeTechniqueKind(technique.kind)
    if (kind === VISUAL_MARKING_KIND.BEND || kind === VISUAL_MARKING_KIND.VIBRATO) {
      push(kind, {
        technique,
        symbol: VISUAL_GUITAR_TECHNIQUE_SYMBOLS[kind],
      })
    }
  }

  return markings
}

function orderedNoteRefs(groups) {
  const refs = []
  for (const group of groups ?? []) {
    const notes = group.notes ?? []
    notes.forEach((note, noteIndex) => {
      if (note?.midi == null) {
        return
      }
      refs.push({
        note,
        noteId: visualNoteId(note, group, noteIndex),
        groupId: group.id ?? null,
        group,
        noteIndex,
        timeSeconds: group.timeSeconds ?? note.timeSeconds ?? 0,
        status: group.status ?? null,
      })
    })
  }
  refs.sort(
    (left, right) =>
      left.timeSeconds - right.timeSeconds ||
      (left.note.quarterTime ?? 0) - (right.note.quarterTime ?? 0) ||
      left.noteIndex - right.noteIndex,
  )
  return refs
}

function tieKey(note) {
  return [
    note.partId ?? '',
    note.voice ?? 1,
    note.staff ?? '',
    note.midi ?? '',
  ].join('|')
}

function numberedKey(kind, note, number = '1') {
  return [
    kind,
    note.partId ?? '',
    note.voice ?? 1,
    note.staff ?? '',
    number ?? '1',
  ].join('|')
}

function spanStatus(startStatus, endStatus) {
  if (startStatus === 'current' || endStatus === 'current') {
    return 'current'
  }
  if (startStatus === 'past' && endStatus === 'past') {
    return 'past'
  }
  return endStatus ?? startStatus ?? null
}

function makeSpan(kind, start, end, extra = {}) {
  return {
    id: markingId(kind, VISUAL_MARKING_SCOPE.SPAN, start.noteId, end.noteId),
    kind,
    scope: VISUAL_MARKING_SCOPE.SPAN,
    fromNoteId: start.noteId,
    toNoteId: end.noteId,
    fromGroupId: start.groupId,
    toGroupId: end.groupId,
    fromTimeSeconds: start.timeSeconds,
    toTimeSeconds: end.timeSeconds,
    status: spanStatus(start.status, end.status),
    source: 'musicxml',
    ...extra,
  }
}

function closeOpenSpan(openMap, key, endRef, kind, extra = {}) {
  const startRef = openMap.get(key)
  if (!startRef || startRef.noteId === endRef.noteId) {
    return null
  }
  openMap.delete(key)
  return makeSpan(kind, startRef, endRef, extra)
}

export function buildVisualSpanMarkings(groups) {
  const spans = []
  const openTies = new Map()
  const openSlurs = new Map()
  const openTechniques = new Map()

  for (const ref of orderedNoteRefs(groups)) {
    const note = ref.note

    if (note.tieStop) {
      const span = closeOpenSpan(openTies, tieKey(note), ref, VISUAL_MARKING_KIND.TIE)
      if (span) {
        spans.push(span)
      }
    }
    if (note.tieStart) {
      openTies.set(tieKey(note), ref)
    }

    const slurs = note.slurs ?? []
    for (const slur of slurs.filter((entry) => entry.type === 'stop')) {
      const key = numberedKey(VISUAL_MARKING_KIND.SLUR, note, slur.number)
      const span = closeOpenSpan(openSlurs, key, ref, VISUAL_MARKING_KIND.SLUR, {
        number: slur.number ?? '1',
        placement: slur.placement ?? null,
      })
      if (span) {
        spans.push(span)
      }
    }
    for (const slur of slurs.filter((entry) => entry.type === 'start')) {
      openSlurs.set(numberedKey(VISUAL_MARKING_KIND.SLUR, note, slur.number), ref)
    }

    const techniques = (note.guitarTechniques ?? [])
      .map((technique) => ({
        ...technique,
        kind: normalizeTechniqueKind(technique.kind),
      }))
      .filter((technique) => SPAN_TECHNIQUE_KINDS.has(technique.kind))

    for (const technique of techniques.filter((entry) => entry.type === 'stop')) {
      const key = numberedKey(technique.kind, note, technique.number)
      const span = closeOpenSpan(openTechniques, key, ref, technique.kind, {
        number: technique.number ?? '1',
        symbol: VISUAL_GUITAR_TECHNIQUE_SYMBOLS[technique.kind],
        technique,
      })
      if (span) {
        spans.push(span)
      }
    }
    for (const technique of techniques.filter((entry) => entry.type === 'start')) {
      openTechniques.set(numberedKey(technique.kind, note, technique.number), ref)
    }
  }

  return spans
}
