export const GUIDED_TUTORIAL_STORAGE_KEY = 'scoreflow-guided-tutorial-v1'

export const GUIDED_TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: 'Corranzo helps you practice sheet music with playback, a score cursor, and Wait For You.',
  },
  {
    id: 'library',
    title: 'Library',
    body: 'Add sheet music plus a timing file. PDF-only playback is experimental.',
    targetId: 'library-upload',
    view: 'library',
  },
  {
    id: 'practice-tab',
    title: 'Practice',
    body: 'Practice is where you play, follow the score, and work in loops.',
    targetId: 'topbar-practice',
  },
  {
    id: 'play-controls',
    title: 'Play Controls',
    body: 'Use Play/Pause and Tempo to control the built-in piano.',
    targetId: 'practice-playback',
    view: 'practice',
  },
  {
    id: 'practice-mode',
    title: 'Practice Mode',
    body: 'Play Along runs normally. Wait For You pauses until you continue.',
    targetId: 'practice-mode',
    view: 'practice',
  },
  {
    id: 'input-source',
    title: 'Input Source',
    body: 'Use Manual, Mic, or MIDI. MIDI is best for chords.',
    targetId: 'practice-input-source',
    view: 'practice',
  },
  {
    id: 'score-cursor',
    title: 'Score Cursor',
    body: 'Turn the cursor on to follow the current place in the score.',
    targetId: 'score-cursor',
    view: 'practice',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    body: 'Advanced is optional: files, playback options, and troubleshooting live here.',
    targetId: 'practice-advanced',
    view: 'practice',
  },
  {
    id: 'finish',
    title: 'You are Ready',
    body: 'You are ready to practice.',
  },
]

function resolveStorage(storage = globalThis.localStorage) {
  return storage
}

export function isGuidedTutorialCompleted(storage = resolveStorage()) {
  try {
    const raw = storage?.getItem?.(GUIDED_TUTORIAL_STORAGE_KEY)
    if (!raw) {
      return false
    }
    if (raw === 'complete') {
      return true
    }
    return JSON.parse(raw)?.status === 'complete'
  } catch {
    return false
  }
}

export function completeGuidedTutorial(reason = 'done', storage = resolveStorage()) {
  try {
    storage?.setItem?.(
      GUIDED_TUTORIAL_STORAGE_KEY,
      JSON.stringify({ status: 'complete', reason, completedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

export function shouldOpenGuidedTutorial({
  completed = false,
  replayRequested = false,
} = {}) {
  return Boolean(replayRequested || !completed)
}

export function isTutorialStepAvailable(step, targetAvailable) {
  if (!step?.targetId) {
    return true
  }
  return Boolean(targetAvailable?.(step.targetId))
}

export function resolveNextAvailableTutorialIndex(
  steps,
  startIndex,
  targetAvailable,
) {
  for (let index = Math.max(0, startIndex); index < steps.length; index += 1) {
    if (isTutorialStepAvailable(steps[index], targetAvailable)) {
      return index
    }
  }
  return Math.max(0, steps.length - 1)
}
