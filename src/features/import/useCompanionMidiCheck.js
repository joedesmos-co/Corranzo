import { useEffect, useState } from 'react'
import { parseMidiFile } from '../playback/parseMidiFile.js'

/** Keep import, Home and Library entry consistent for optional accompaniment. */
export default function useCompanionMidiCheck(source) {
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!source?.data) return
    let cancelled = false
    parseMidiFile(source.data).then(parsed => {
      const valid = parsed.duration > 0 && parsed.tracks.some(track => track.noteCount > 0)
      if (!cancelled) setResult({ source, valid })
    }).catch(() => { if (!cancelled) setResult({ source, valid: false }) })
    return () => { cancelled = true }
  }, [source])
  return {
    checking: Boolean(source?.data) && result?.source !== source,
    invalid: Boolean(source?.data) && result?.source === source && !result.valid,
  }
}
