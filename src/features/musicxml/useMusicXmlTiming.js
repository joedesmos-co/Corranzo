import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMusicXmlImportError } from '../import/formatImportError.js'
import { musicXmlSourceKey } from '../import/musicXmlSource.js'
import { loadMusicXmlFile } from './loadMusicXmlFile.js'
import { parseMusicXml } from './parseMusicXml.js'
import { getDebugState } from './timingQuery.js'

export default function useMusicXmlTiming(musicXmlSource, queryTime = 0) {
  const loadGenerationRef = useRef(0)
  const [timingMap, setTimingMap] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const xmlData = musicXmlSource?.data
  const xmlFileName = musicXmlSource?.fileName
  const xmlSourceKey = musicXmlSourceKey(musicXmlSource)

  useEffect(() => {
    if (!xmlData || !xmlSourceKey) {
      setTimingMap(null)
      setError(null)
      setIsLoading(false)
      return undefined
    }

    const loadGeneration = loadGenerationRef.current + 1
    loadGenerationRef.current = loadGeneration

    async function load() {
      setIsLoading(true)
      setError(null)
      setTimingMap(null)

      try {
        const file = new File([xmlData], xmlFileName ?? 'score.musicxml')
        const xmlString = await loadMusicXmlFile(file)
        const parsed = parseMusicXml(xmlString, xmlFileName)

        if (loadGenerationRef.current !== loadGeneration) {
          return
        }
        setTimingMap(parsed)
      } catch (loadError) {
        if (loadGenerationRef.current === loadGeneration) {
          setTimingMap(null)
          setError(formatMusicXmlImportError(loadError))
        }
      } finally {
        if (loadGenerationRef.current === loadGeneration) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      loadGenerationRef.current += 1
    }
  }, [xmlData, xmlFileName, xmlSourceKey])

  const debugState = useMemo(
    () => (timingMap ? getDebugState(timingMap, queryTime) : null),
    [timingMap, queryTime],
  )

  return {
    timingMap,
    isLoading,
    error,
    debugState,
  }
}
