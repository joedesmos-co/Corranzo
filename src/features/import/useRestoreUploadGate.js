import { useCallback, useEffect, useRef } from 'react'

/**
 * Blocks uploads while session restore runs; queues one pending upload per kind.
 */
export default function useRestoreUploadGate({ restoreGateOpen, onBlocked }) {
  const pendingRef = useRef(null)

  const wrapUpload = useCallback(
    (kind, handler) =>
      async (file) => {
        if (!restoreGateOpen) {
          pendingRef.current = { kind, file, handler }
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
    if (!restoreGateOpen || !pendingRef.current) {
      return
    }
    const pending = pendingRef.current
    pendingRef.current = null
    pending.handler(pending.file)
  }, [restoreGateOpen])

  return { wrapUpload }
}
