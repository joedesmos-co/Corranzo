/**
 * Privacy helpers for recognition problem reports.
 */

/** Strip directories and drive letters; keep a short basename only. */
export function sanitizeReportFilename(value, { fallback = 'score', maxLength = 80 } = {}) {
  if (value == null) {
    return fallback
  }
  let name = String(value)
  // Drop Windows drive / UNC and any directory segments.
  name = name.replace(/^\\\\\?\\/, '')
  name = name.replace(/^[a-zA-Z]:[\\/]/, '')
  name = name.replace(/\\/g, '/')
  const slash = name.lastIndexOf('/')
  if (slash >= 0) {
    name = name.slice(slash + 1)
  }
  name = name.replace(/[^\w.\- ()[\]]+/g, '_')
  name = name.replace(/_+/g, '_').replace(/^[_\s.]+|[_\s.]+$/g, '')
  if (!name) {
    return fallback
  }
  return name.slice(0, maxLength)
}

/** Treat user text as plain data — never executable markup. */
export function sanitizeUserReportText(value, { maxLength = 2000 } = {}) {
  if (value == null) {
    return ''
  }
  let text = String(value)
  let cleaned = ''
  for (let index = 0; index < text.length && cleaned.length < maxLength; index += 1) {
    const code = text.charCodeAt(index)
    // Keep tab (9) and newline (10/13); drop other C0 controls + DEL.
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      cleaned += text[index]
    }
  }
  return cleaned
}

export function parseOptionalPositiveInt(value) {
  if (value == null || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    return null
  }
  return Math.floor(number)
}

/**
 * Deterministic ZIP filename: corranzo-recognition-report-YYYY-MM-DD-HHMM.zip
 * Uses local wall-clock components from the provided Date.
 */
export function buildRecognitionReportZipFilename(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('-')
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`
  return `corranzo-recognition-report-${stamp}-${time}.zip`
}
