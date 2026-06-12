import { useCallback, useEffect, useRef } from 'react'
import {
  getFileFingerprint,
  loadAnnotations,
  parseAnnotationsImport,
  saveAnnotations,
  serializeAnnotationsExport,
} from '../utils/annotationStorage.js'

const AUTOSAVE_MS = 600

export default function useAnnotationPersistence({
  file,
  fileName,
  strokesByPage,
  toolSettings,
  replaceAnnotations,
}) {
  const fingerprintRef = useRef(null)
  const skipNextSaveRef = useRef(false)

  useEffect(() => {
    if (!file) {
      fingerprintRef.current = null
      return
    }

    let cancelled = false

    async function restore() {
      const fingerprint = getFileFingerprint(file)
      fingerprintRef.current = fingerprint
      const saved = loadAnnotations(fingerprint)

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
  }, [file, replaceAnnotations])

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
