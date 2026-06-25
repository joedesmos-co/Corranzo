export const EXERCISE_TYPES = [
  { id: 'chords', label: 'Chords' },
  { id: 'scales', label: 'Scales' },
  { id: 'sight-reading', label: 'Sight reading' },
  { id: 'technique', label: 'Technique' },
  { id: 'other', label: 'Other' },
]

const EXERCISE_TYPE_IDS = new Set(EXERCISE_TYPES.map((type) => type.id))

export function normalizeExerciseType(value) {
  const id = String(value ?? '').trim()
  return EXERCISE_TYPE_IDS.has(id) ? id : 'other'
}

export function exerciseTypeLabel(exerciseType) {
  return (
    EXERCISE_TYPES.find((type) => type.id === exerciseType)?.label ?? 'Other'
  )
}
