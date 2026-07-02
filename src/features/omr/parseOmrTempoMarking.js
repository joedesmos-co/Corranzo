import { TEMPO_WORD_BPM, OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { OMR_DEFAULT_TEMPO } from './omrConstants.js'

const BPM_RANGE = { min: 40, max: 220 }

function clampBpm(value) {
  return Math.max(BPM_RANGE.min, Math.min(BPM_RANGE.max, Math.round(value)))
}

/**
 * Parse tempo from locally extracted PDF text (no cloud OCR).
 * Conservative: prefer explicit metronome marks; ignore stray numbers on later pages.
 */
export function parseTempoFromTextItems(items = [], { pageNumber = 1 } = {}) {
  const text = items
    .map((item) => String(item.text ?? '').trim())
    .filter(Boolean)
    .join(' ')

  if (!text) {
    return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
  }

  // Accept the plain quarter note character, SMuFL metronome note glyphs
  // (U+ECA0-U+ECB6, e.g. Bravura metNoteQuarterUp U+ECA5 in musescore.com
  // exports), or a bare q before the equals sign.
  const equalsMatch = text.match(/(?:\u2669|[\ueca0-\uecb6]|q|Q)\s*=\s*(\d{2,3})/i)
  if (equalsMatch) {
    const bpm = clampBpm(Number(equalsMatch[1]))
    return { bpm, confidence: 0.88, fromDefault: false, source: 'metronome-mark' }
  }

  const bpmMatch = text.match(/\b(\d{2,3})\s*bpm\b/i)
  if (bpmMatch) {
    const bpm = clampBpm(Number(bpmMatch[1]))
    return { bpm, confidence: 0.86, fromDefault: false, source: 'bpm-text' }
  }

  if (pageNumber > 1) {
    return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
  }

  const headerText = text.slice(0, 600)
  const wordMatch = headerText.match(
    /\b(grave|largo|lent|lento|adagio|andante|moderato|allegretto|allegro|vivace|presto)\b/i,
  )
  if (wordMatch) {
    const word = wordMatch[1].toLowerCase()
    const bpm = TEMPO_WORD_BPM[word] ?? OMR_DEFAULT_TEMPO
    return { bpm, confidence: 0.74, fromDefault: false, source: `word:${word}` }
  }

  return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
}

export function shouldEmitTempo(tempo) {
  return !tempo?.fromDefault && (tempo?.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.TEMPO
}
