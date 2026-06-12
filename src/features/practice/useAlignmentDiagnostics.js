import { useEffect, useState } from 'react'
import { extractMidiProfile } from '../playback/extractMidiProfile.js'
import { computeAlignmentDiagnostics } from './computeAlignmentDiagnostics.js'

export default function useAlignmentDiagnostics(midiSource, timingMap) {
  const [diagnostics, setDiagnostics] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!midiSource?.data || !timingMap) {
      setDiagnostics(null)
      setError(null)
      setIsLoading(false)
      return undefined
    }

    let cancelled = false

    async function run() {
      setIsLoading(true)
      setError(null)

      try {
        const midiProfile = await extractMidiProfile(midiSource.data)
        const result = computeAlignmentDiagnostics(midiProfile, timingMap)
        if (!cancelled) {
          setDiagnostics(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiagnostics(null)
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not compute alignment diagnostics.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [midiSource, timingMap])

  return { diagnostics, isLoading, error }
}
