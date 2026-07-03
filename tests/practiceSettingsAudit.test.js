import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WFY_MATCH_DEFAULTS } from '../src/features/practice/waitForYouMatchSettings.js'
import { WFY_INPUT_SOURCE_LABELS } from '../src/features/microphone-input/micInputConstants.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('practice settings audit', () => {
  it('uses forgiving note-matching defaults', () => {
    expect(WFY_MATCH_DEFAULTS.chordWindowMs).toBe(500)
    expect(WFY_MATCH_DEFAULTS.micCentsTolerance).toBe(35)
    expect(WFY_MATCH_DEFAULTS.exactPitch).toBe(true)
  })

  it('labels input sources in plain language', () => {
    expect(WFY_INPUT_SOURCE_LABELS.manual).toBe('Continue button')
    expect(readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')).toContain(
      'Continue with',
    )
  })

  it('groups Advanced settings into files, playback, setup, and help', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')

    expect(panel).toContain('summary="Files, playback, setup"')
    expect(panel).toContain('aria-label="Practice setup"')
    expect(panel).toContain('aria-label="Help"')
    expect(panel).not.toContain('aria-label="Troubleshooting"')

    const playbackGroup = panel.slice(
      panel.indexOf('aria-label="Playback options"'),
      panel.indexOf('aria-label="Practice setup"'),
    )
    expect(playbackGroup.indexOf('PracticeMetronomeAdvancedSettings')).toBeLessThan(
      playbackGroup.indexOf('PracticeTracksCompactSection'),
    )
    expect(playbackGroup.indexOf('PracticeTracksCompactSection')).toBeLessThan(
      playbackGroup.indexOf('PracticePositionTick'),
    )
  })

  it('groups note matching settings by pitch, transpose, and chords', () => {
    const matchPanel = readSrc('components', 'practice', 'WaitForYouMatchSettingsPanel.jsx')

    expect(matchPanel).toContain('<legend>Pitch</legend>')
    expect(matchPanel).toContain('Require exact pitch')
    expect(matchPanel).toContain('Ignore wrong octave')
    expect(matchPanel).toContain('<legend>Keyboard transpose</legend>')
    expect(matchPanel).toContain('<legend>Chords</legend>')
    expect(matchPanel).toContain('Chord timing (ms)')
    expect(matchPanel).toContain('Reset to defaults')
  })

  it('restores saved checkpoint mode from practice prefs', () => {
    const session = readSrc('features', 'practice', 'usePracticeSession.js')

    expect(session).toContain('prefs.checkpointMode === WFY_CHECKPOINT_MODE.BEAT')
  })

  it('replaces timing-file jargon with actionable copy', () => {
    const mode = readSrc('components', 'practice', 'PracticeModeSection.jsx')
    const transport = readSrc('components', 'practice', 'PracticeTransportSection.jsx')

    expect(mode).toContain('Add a timing file in Library to enable practice.')
    expect(transport).toContain('Add a timing file in Library to enable practice.')
    expect(mode).not.toContain('Timing file required.')
  })
})
