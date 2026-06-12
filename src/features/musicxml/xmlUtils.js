export function ensureArray(value) {
  if (value == null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

export function asNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getMeasureNumber(measureNode, fallbackIndex) {
  const raw = measureNode?.['@_number']
  if (raw == null) {
    return fallbackIndex + 1
  }
  const parsed = Number(String(raw).split('.')[0])
  return Number.isFinite(parsed) ? parsed : fallbackIndex + 1
}

export function divisionsToSeconds(divisionDuration, divisions, bpm) {
  if (divisionDuration <= 0 || divisions <= 0 || bpm <= 0) {
    return 0
  }
  const quarterSeconds = 60 / bpm
  return (divisionDuration / divisions) * quarterSeconds
}
