import { useCallback, useEffect, useRef } from 'react'

const PENDING_KINDS = ['pdf', 'musicXml', 'midi']

function emptyPending() {
  return { pdf: null, musicXml: null, midi: null }
}

/**
 * Blocks uploads while session restore runs; queues one pending upload per kind.
 */
export default function useRestoreUploadGate({ restoreGateOpen, onBlocked }) {
  const pendingRef = useRef(emptyPending())

  const wrapUpload = useCallback(
    (kind, handler) =>
      async (file) => {
        if (!restoreGateOpen) {
          pendingRef.current = { ...pendingRef.current, [kind]: { file, handler } }
          onBlocked?.(
            'Restoring your last session — your file will load as soon as that finishes.',
          )
          return
        }
        return handler(file)
      },
    [restoreGateOpen, onBlocked],
  )

  useEffect(() => {
    if (!restoreGateOpen) {
      return
    }
    const pending = pendingRef.current
    pendingRef.current = emptyPending()
    for (const kind of PENDING_KINDS) {
      const item = pending[kind]
      if (item) {
        item.handler(item.file)
      }
    }
  }, [restoreGateOpen])

  return { wrapUpload }
}
