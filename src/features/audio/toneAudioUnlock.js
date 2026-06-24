import * as Tone from 'tone'

let startPromise = null
let userUnlockedAudio = false

/** True after Play/Test Sound (or any explicit unlock) has started the context. */
export function hasUserUnlockedAudio() {
  try {
    return userUnlockedAudio || Tone.getContext().state === 'running'
  } catch {
    return userUnlockedAudio
  }
}

/**
 * Start / resume Tone from a user gesture (Play, Test Sound, etc.).
 * Dedupes concurrent calls and skips Tone.start when already running.
 */
export function startToneFromUserGesture() {
  userUnlockedAudio = true
  try {
    if (Tone.getContext().state === 'running') {
      return Promise.resolve()
    }
  } catch {
    // fall through to Tone.start
  }
  if (!startPromise) {
    startPromise = Promise.resolve(Tone.start()).finally(() => {
      startPromise = null
    })
  }
  return startPromise
}

/**
 * Await an unlock promise from the UI hook, or start Tone when needed.
 * Never calls Tone.start without a user gesture path calling this helper.
 */
export async function awaitToneStarted(audioContextStart) {
  if (audioContextStart) {
    userUnlockedAudio = true
    await audioContextStart
    return
  }
  if (Tone.getContext().state !== 'running') {
    await startToneFromUserGesture()
  } else {
    userUnlockedAudio = true
  }
}

/** Test-only reset. */
export function __resetToneAudioUnlockForTests() {
  userUnlockedAudio = false
  startPromise = null
}
