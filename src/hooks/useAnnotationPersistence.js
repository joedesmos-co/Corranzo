import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  getFileFingerprint,
  loadAnnotations,
  parseAnnotationsImport,
  saveAnnotations,
  serializeAnnotationsExport,
} from '../utils/annotationStorage.js'
import { buildPdfFingerprint } from '../features/score-follow/scoreFollowStorage.js'

const AUTOSAVE_MS = 600

/**
 * Annotations were briefly saved under this key for every PDF because the
 * object-URL string was passed where a File was expected. Adopt that bucket
 * once when its recorded fileName matches the current score.
 */
export const LEGACY_BROKEN_FINGERPRINT = 'undefined::undefined::undefined'

/**
 * Storage identity for a PDF's annotations. Prefers the same
 * fileName::size::lastModified fingerprint used by score-follow anchors and
 * session restore; falls back to a real File object if one is ever passed.
 * Returns null when no stable identity exists (persistence is skipped).
 */
export function resolveAnnotationFingerprint({ pdfMeta, file }) {
  const fromMeta = buildPdfFingerprint(pdfMeta)
  if (fromMeta) {
    return fromMeta
  }
  if (
    file != null &&
    typeof file === 'object' &&
    typeof file.name === 'string' &&
    file.size != null
  ) {
    return getFileFingerprint(file)
  }
  return null
}

export default function useAnnotationPersistence({
  file,
  fileName,
  pdfMeta = null,
  strokesByPage,
  toolSettings,
  replaceAnnotations,
}) {
  const fingerprintRef = useRef(null)
  const skipNextSaveRef = useRef(false)

  const fingerprint = useMemo(
    () => resolveAnnotationFingerprint({ pdfMeta, file }),
    [pdfMeta, file],
  )

  useEffect(() => {
    if (!file || !fingerprint) {
      fingerprintRef.current = null
      return
    }

    let cancelled = false

    async function restore() {
      fingerprintRef.current = fingerprint
      let saved = loadAnnotations(fingerprint)

      if (!saved?.strokesByPage) {
        const legacy = loadAnnotations(LEGACY_BROKEN_FINGERPRINT)
        if (legacy?.strokesByPage && legacy.fileName === fileName) {
          saved = legacy
          saveAnnotations(fingerprint, legacy)
        }
      }

      if (cancelled) {
        return
      }

      skipNextSaveRef.current = true
      if (saved?.strokesByPage) {
        replaceAnnotations(saved.strokesByPage, saved.toolSettings ?? null)
      } else {
        replaceAnnotations({}, null)
      }
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [file, fileName, fingerprint, replaceAnnotations])

  useEffect(() => {
    if (!file || !fingerprintRef.current) {
      return undefined
    }

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return undefined
    }

    const timer = setTimeout(() => {
      saveAnnotations(fingerprintRef.current, {
        version: 1,
        fileName,
        strokesByPage,
        toolSettings,
      })
    }, AUTOSAVE_MS)

    return () => clearTimeout(timer)
  }, [file, fileName, strokesByPage, toolSettings])

  const exportAnnotations = useCallback(() => {
    const payload = serializeAnnotationsExport(fileName, strokesByPage, toolSettings)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName || 'score'}-annotations.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [fileName, strokesByPage, toolSettings])

  const importAnnotations = useCallback(
    async (jsonFile) => {
      const text = await jsonFile.text()
      const { strokesByPage: imported, toolSettings: importedSettings } =
        parseAnnotationsImport(text)
      skipNextSaveRef.current = false
      replaceAnnotations(imported, importedSettings)
    },
    [replaceAnnotations],
  )

  return { exportAnnotations, importAnnotations }
}
