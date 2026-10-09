/**
 * Reactive Neural Microphone flag (Stage 8, L2) — DEV ONLY.
 *
 * Reads the micNeural flag (default OFF) and re-renders on changes from
 * any tab/panel (storage event + local broadcast). Always false in
 * production builds: the toggle UI never mounts there, and no live path
 * consults the flag unless the session explicitly gates on it.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  isMicNeuralEnabled,
  MIC_NEURAL_STORAGE_KEY,
} from './micEngineFlag.js'

export const MIC_NEURAL_FLAGS_CHANGED = 'scoreflow:mic-neural-flag-changed'

export function setMicNeuralEnabled(enabled) {
  try {
    globalThis.localStorage?.setItem(MIC_NEURAL_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Diagnostics only.
  }
  try {
    globalThis.dispatchEvent?.(new Event(MIC_NEURAL_FLAGS_CHANGED))
  } catch {
    // Diagnostics only.
  }
}

function readFlag() {
  if (!import.meta.env?.DEV) {
    return false
  }
  return isMicNeuralEnabled()
}

export default function useMicNeuralFlag() {
  const [enabled, setEnabled] = useState(readFlag)
  useEffect(() => {
    const refresh = () => {
      setEnabled(readFlag())
    }
    try {
      globalThis.addEventListener('storage', refresh)
      globalThis.addEventListener(MIC_NEURAL_FLAGS_CHANGED, refresh)
    } catch {
      // Diagnostics only.
    }
    return () => {
      try {
        globalThis.removeEventListener('storage', refresh)
        globalThis.removeEventListener(MIC_NEURAL_FLAGS_CHANGED, refresh)
      } catch {
        // Diagnostics only.
      }
    }
  }, [])
  const set = useCallback((next) => {
    setMicNeuralEnabled(next)
    setEnabled(readFlag())
  }, [])
  return [enabled, set]
}
