import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMusicXmlImportError } from '../import/formatImportError.js'
import { musicXmlSourceKey } from '../import/musicXmlSource.js'
import {
  contentIdentitySync,
  pushScoreSourceContentTrace,
} from '../library/scoreSourceContentIdentity.js'
import { withTimeout } from '../../utils/asyncWithTimeout.js'
import { loadMusicXmlFile } from './loadMusicXmlFile.js'
import { parseMusicXml } from './parseMusicXml.js'
import { getDebugState } from './timingQuery.js'

const TIMING_PARSE_TIMEOUT_MS = 30_000

export default function useMusicXmlTiming(musicXmlSource, queryTime = 0) {
  const loadGenerationRef = useRef(0)
  const [timingMap, setTimingMap] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const xmlData = musicXmlSource?.data
  const xmlFileName = musicXmlSource?.fileName
  const xmlSourceKey = musicXmlSourceKey(musicXmlSource)
  const xmlContentHash = contentIdentitySync(xmlData)?.hash ?? null

  useEffect(() => {
    if (!xmlData || !xmlSourceKey) {
      setTimingMap(null)
      setError(null)
      setIsLoading(false)
      pushScoreSourceContentTrace('timing-cleared', {
        xmlSourceKey: null,
        xmlContentHash: null,
      })
      return undefined
    }

    const loadGeneration = loadGenerationRef.current + 1
    loadGenerationRef.current = loadGeneration
    const expectedHash = xmlContentHash

    async function load() {
      setIsLoading(true)
      setError(null)
      // Always drop the previous map before parsing so a missed key transition
      // cannot keep Piece A events visible while Piece B bytes are loading.
      setTimingMap(null)

      try {
        const file = new File([xmlData], xmlFileName ?? 'score.musicxml')
        const xmlString = await withTimeout(
          loadMusicXmlFile(file),
          TIMING_PARSE_TIMEOUT_MS,
          'Timing file took too long to read. It may be corrupt or very large.',
        )
        const parsedStringHash = contentIdentitySync(xmlString)?.hash ?? null
        pushScoreSourceContentTrace('timing-parser-input', {
          xmlSourceKey,
          xmlContentHash: expectedHash,
          parserInputHash: parsedStringHash,
          fileName: xmlFileName,
          ownerPdfIdentity: musicXmlSource?.ownerPdfIdentity ?? null,
          sourceType: musicXmlSource?.source ?? null,
        })
        const parsed = await withTimeout(
          Promise.resolve().then(() => parseMusicXml(xmlString, xmlFileName)),
          TIMING_PARSE_TIMEOUT_MS,
          'Timing file took too long to parse. It may be corrupt or very large.',
        )

        if (loadGenerationRef.current !== loadGeneration) {
          pushScoreSourceContentTrace('timing-parse-stale-discard', {
            expectedHash,
            parserInputHash: parsedStringHash,
            loadGeneration,
            currentGeneration: loadGenerationRef.current,
          })
          return
        }
        // Stamp content identity onto the timing map so playback can key off it.
        parsed.contentHash = parsedStringHash
        parsed.sourceContentKey = xmlSourceKey
        parsed.ownerScoreId =
          musicXmlSource?.ownerScoreId ??
          (typeof window !== 'undefined'
            ? window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ?? null
            : null)
        parsed.ownerPdfIdentity = musicXmlSource?.ownerPdfIdentity ?? null
        setTimingMap(parsed)
        pushScoreSourceContentTrace('timing-parse-applied', {
          xmlSourceKey,
          xmlContentHash: expectedHash,
          parserInputHash: parsedStringHash,
          ownerScoreId: parsed.ownerScoreId,
          measureCount: parsed.measures?.length ?? null,
          noteCount: parsed.noteCount ?? parsed.notes?.length ?? null,
          durationSeconds: parsed.durationSeconds ?? null,
          firstMidi: parsed.notes?.find((note) => note.midi != null)?.midi ?? null,
        })
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
  }, [
    xmlData,
    xmlFileName,
    xmlSourceKey,
    xmlContentHash,
    musicXmlSource?.ownerPdfIdentity,
    musicXmlSource?.source,
  ])

  const debugState = useMemo(
    () => (timingMap ? getDebugState(timingMap, queryTime) : null),
    [timingMap, queryTime],
  )

  return {
    timingMap,
    isLoading,
    error,
    debugState,
    contentHash: xmlContentHash,
    sourceKey: xmlSourceKey,
  }
}
