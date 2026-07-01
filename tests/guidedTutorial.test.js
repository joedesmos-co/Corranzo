import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GUIDED_TUTORIAL_STORAGE_KEY,
  GUIDED_TUTORIAL_STEPS,
  completeGuidedTutorial,
  isGuidedTutorialCompleted,
  resolveNextAvailableTutorialIndex,
  shouldOpenGuidedTutorial,
} from '../src/features/onboarding/guidedTutorial.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

describe('guided tutorial storage', () => {
  it('opens on first run when completion is missing', () => {
    const storage = createStorage()

    expect(isGuidedTutorialCompleted(storage)).toBe(false)
    expect(shouldOpenGuidedTutorial({
      completed: isGuidedTutorialCompleted(storage),
    })).toBe(true)
  })

  it('Done marks the tutorial complete', () => {
    const storage = createStorage()

    expect(completeGuidedTutorial('done', storage)).toBe(true)
    expect(isGuidedTutorialCompleted(storage)).toBe(true)
    expect(JSON.parse(storage.getItem(GUIDED_TUTORIAL_STORAGE_KEY)).reason).toBe('done')
  })

  it('Skip also marks the tutorial complete', () => {
    const storage = createStorage()

    completeGuidedTutorial('skipped', storage)
    expect(isGuidedTutorialCompleted(storage)).toBe(true)
    expect(JSON.parse(storage.getItem(GUIDED_TUTORIAL_STORAGE_KEY)).reason).toBe('skipped')
  })

  it('Replay can open even after completion', () => {
    expect(shouldOpenGuidedTutorial({ completed: true })).toBe(false)
    expect(shouldOpenGuidedTutorial({ completed: true, replayRequested: true })).toBe(true)
  })
})

describe('guided tutorial missing targets', () => {
  it('skips missing target steps and keeps going', () => {
    const steps = [
      { id: 'welcome' },
      { id: 'missing', targetId: 'missing-target' },
      { id: 'present', targetId: 'present-target' },
      { id: 'finish' },
    ]
    const next = resolveNextAvailableTutorialIndex(
      steps,
      1,
      (targetId) => targetId === 'present-target',
    )

    expect(next).toBe(2)
  })

  it('falls through to the final step when every target is missing', () => {
    const steps = [
      { id: 'missing-a', targetId: 'a' },
      { id: 'missing-b', targetId: 'b' },
      { id: 'finish' },
    ]

    expect(resolveNextAvailableTutorialIndex(steps, 0, () => false)).toBe(2)
  })
})

describe('guided tutorial UI wiring', () => {
  it('defines beginner-friendly steps for Library, Practice, controls, cursor, Advanced, and finish', () => {
    expect(GUIDED_TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'library',
      'practice-tab',
      'play-controls',
      'practice-mode',
      'input-source',
      'score-cursor',
      'advanced',
      'finish',
    ])
  })

  it('wires replay and real UI targets without visible extra setup clutter', () => {
    expect(readSrc('App.jsx')).toMatch(/GuidedTutorial/)
    expect(readSrc('components', 'TopBar.jsx')).toMatch(/onReplayTutorial/)
    expect(readSrc('components', 'TopBar.jsx')).toMatch(/data-tour-id=\{id === 'practice' \? 'topbar-practice'/)
    expect(readSrc('components', 'MultiFileUpload.jsx')).toMatch(/data-tour-id="library-upload"/)
    expect(readSrc('components', 'practice', 'PracticeTransportSection.jsx')).toMatch(/data-tour-id="practice-playback"/)
    expect(readSrc('components', 'practice', 'PracticeModeSection.jsx')).toMatch(/data-tour-id="practice-mode"/)
    expect(readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')).toMatch(/data-tour-id="practice-input-source"/)
    expect(readSrc('components', 'practice', 'PracticeScoreCursorSection.jsx')).toMatch(/data-tour-id="score-cursor"/)
    expect(readSrc('components', 'practice', 'PracticeControlPanel.jsx')).toMatch(/dataTourId="practice-advanced"/)
  })

  it('keeps the added Help control from overflowing tablet top bars', () => {
    const css = readSrc('App.css')

    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.topbar__actions[\s\S]*min-width: 0/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.topbar__nav-btn[\s\S]*padding: 8px var\(--sf-space-md\)/)
  })
})
