/**
 * Neural Microphone (Experimental) toggle (Stage 6, N9) — DEV ONLY.
 *
 * Development-only opt-in for the pretrained-neural listening prototype.
 * Default OFF; production builds render nothing (Vite strips the mount).
 * Enabling the toggle changes NO live behavior yet — no listening path
 * consults the flag. It exists so the coming integration spike has a
 * user-visible, default-off gate with acceptance wording in place.
 */
import { useState } from 'react'
import {
  isMicNeuralEnabled,
  MIC_NEURAL_STORAGE_KEY,
} from '../../features/microphone-input/micEngineFlag.js'

function readStored() {
  try {
    return globalThis.localStorage?.getItem(MIC_NEURAL_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export default function NeuralMicFlagPanel() {
  if (!import.meta.env.DEV) {
    return null
  }
  return <NeuralMicFlagPanelDev />
}

function NeuralMicFlagPanelDev() {
  const [enabled, setEnabled] = useState(() => readStored() && isMicNeuralEnabled())

  function onToggle(event) {
    const next = event.target.checked
    try {
      globalThis.localStorage?.setItem(MIC_NEURAL_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Diagnostics only — never break practice on storage errors.
    }
    setEnabled(next && isMicNeuralEnabled())
  }

  return (
    <details className="practice-diagnostics__group">
      <summary>Neural Microphone (Experimental)</summary>
      <div className="practice-diagnostics__group-body">
        <label>
          <input type="checkbox" checked={enabled} onChange={onToggle} />{' '}
          Enable experimental neural listening
        </label>
        <p>
          {enabled
            ? 'Experimental flag is ON for this browser profile. No live listening path uses it yet.'
            : 'Off (default). The normal listening experience is unchanged.'}
        </p>
      </div>
    </details>
  )
}
