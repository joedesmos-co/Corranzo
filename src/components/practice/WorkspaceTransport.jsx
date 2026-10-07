import { PRACTICE_MODE, PRACTICE_MODE_LABELS } from '../../features/practice/practiceMode.js'
import { formatTime } from '../../features/playback/formatTime.js'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { workspaceStatus } from '../../features/practice/workspaceStatus.js'
import Icon from '../../design/Icon.jsx'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'

function ToolButton({ tool, onTool, id, icon, label, children }) { return <button className="workspace-tool-button" data-tour-id={id === 'input' ? 'practice-input-source' : id === 'settings' ? 'practice-advanced' : undefined} aria-label={label} title={label} aria-expanded={tool === id} aria-haspopup="dialog" onClick={() => onTool(id)}><Icon name={icon} size={20} /><span>{children || label}</span></button> }

export default function WorkspaceTransport({ session: s, scoreFollow, onTool, tool, waitDisabled }) {
  const tick = usePracticeTick()
  const p = s.playback
  const status = workspaceStatus(s, scoreFollow)
  const current = tick.practiceTime ?? s.practiceTime
  const duration = tick.playbackDuration || p.duration
  const isPlaying = tick.playbackIsPlaying
  const loop = s.loop.region
  const checkpoint = s.waitForYou.enrichedCheckpoint ?? s.waitForYou.currentCheckpoint
  const targetNotes = getExpectedMidis(checkpoint).map(midiToNoteLabel).join(' · ')
  const label = checkpoint?.displayLabel || s.waitForYou.guidance?.targetLabel || checkpoint?.noteLabel || getExpectedMidis(checkpoint).map(midiToNoteLabel).join(' · ') || 'Highlighted notes'
  function chooseMode(mode) { s.setPracticeMode(mode) }
  function modeKeys(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const modes = Object.values(PRACTICE_MODE).filter(m => !(m === PRACTICE_MODE.WAIT_FOR_YOU && waitDisabled))
    const index = modes.indexOf(s.practiceMode)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? modes.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length
    chooseMode(modes[next])
    e.currentTarget.querySelector(`[data-mode="${modes[next]}"]`)?.focus()
  }
  return <footer className="workspace-dock" data-loop-active={Boolean(s.loop.enabled && loop?.isValid)} aria-label="Score transport">
    <div className="workspace-mode-row">
      <div className="workspace-modes" data-tour-id="practice-mode" role="radiogroup" aria-label="Practice mode" onKeyDown={modeKeys}>
        {Object.values(PRACTICE_MODE).map((mode, i) => <button key={mode} data-mode={mode} role="radio" aria-checked={s.practiceMode === mode} tabIndex={s.practiceMode === mode ? 0 : -1} disabled={s.timingDisabled || (mode === PRACTICE_MODE.WAIT_FOR_YOU && waitDisabled)} title={mode === PRACTICE_MODE.WAIT_FOR_YOU && waitDisabled ? 'Score following must be ready before this mode is available.' : `${PRACTICE_MODE_LABELS[mode]} (${i + 1})`} onClick={() => chooseMode(mode)}>{PRACTICE_MODE_LABELS[mode]}</button>)}
      </div>
      <div className={`workspace-status workspace-status--${status.kind}`} data-tour-id="score-cursor" role="status" title={status.detail}><span className="workspace-status-dot" />{status.label}</div>
      {s.practiceMode !== PRACTICE_MODE.PREVIEW && <ToolButton tool={tool} onTool={onTool} id="input" icon={s.wfyInputSource === 'microphone' && s.wfyInputSourceReady ? 'mic' : 'keyboard'} label="Practice input">{s.wfyInputSourceReady && s.wfyInputSource !== 'manual' ? (s.wfyInputSource === 'microphone' ? 'Microphone' : 'MIDI keyboard') : 'Connect instrument'}</ToolButton>}
    </div>
    {s.isWaitForYou && <div className="workspace-your-turn">
      <div><span className="workspace-eyebrow">{s.waitForYou.isComplete ? 'Well played' : 'Your next notes'}</span><strong title={checkpoint?.detailsLabel}>{s.waitForYou.isComplete && <Icon name="check" size={20} />}{s.waitForYou.isComplete ? 'Passage complete' : label}</strong><span className="workspace-target-detail">{targetNotes}{checkpoint?.measureNumber ? ' · ' : ''}{checkpoint?.measureNumber ? `Bar ${checkpoint.measureNumber}` : ''}{s.waitForYou.guidance?.secondary ? ` · ${s.waitForYou.guidance.secondary}` : ''}</span></div>
      <button onClick={() => s.referencePlayback.playCheckpointReference(checkpoint)} disabled={!checkpoint || s.referencePlayback.isPlaying}><Icon name="tracks" size={16} />{s.referencePlayback.isPlaying ? 'Playing…' : 'Hear it'}</button>
      <button onClick={s.waitForYou.showHint} disabled={s.waitForYou.isComplete}>Hint</button>
      <button onClick={s.waitForYou.skipCheckpoint} disabled={s.waitForYou.isComplete}>Skip</button>
      {(s.waitForYou.guidance?.state === 'hint' || s.waitForYou.guidance?.hint) && <span className="workspace-wfy-guidance">{s.waitForYou.guidance.hint || s.waitForYou.guidance.primary}</span>}
      {s.waitForYouInput?.inputFeedback?.outcome === 'chord-partial' && <span role="status">{s.waitForYouInput.inputFeedback.message}</span>}
      {s.referencePlayback.error && <span role="alert">Reference sound unavailable.</span>}
    </div>}
    <div className="workspace-transport-row" data-tour-id="practice-playback">
      <button className="workspace-icon workspace-restart" aria-label="Restart passage" title="Restart passage" disabled={s.timingDisabled} onClick={s.isWaitForYou ? s.waitForYou.restart : s.handleMidiStop}><Icon name="prev" size={20} /></button>
      <button className={`workspace-play${isPlaying ? ' workspace-play--playing' : ''}`} aria-label={s.isWaitForYou ? (s.waitForYou.isComplete ? 'Start again' : 'Continue (Enter)') : isPlaying ? 'Pause (Space)' : 'Play (Space)'} disabled={s.isWaitForYou ? s.timingDisabled : p.controlsDisabled} onClick={s.isWaitForYou ? (s.waitForYou.isComplete ? s.waitForYou.restart : s.waitForYou.markCorrectAndContinue) : isPlaying ? p.pause : s.handlePlay}>
        <Icon name={s.isWaitForYou ? 'next' : isPlaying ? 'pause' : 'play'} size={24} className={!s.isWaitForYou && !isPlaying ? 'workspace-play-symbol' : ''} /><span>{s.isWaitForYou ? (s.waitForYou.isComplete ? 'Again' : 'Continue') : isPlaying ? 'Pause' : 'Play'}</span>
      </button>
      <div className="workspace-position">
        <div><span className="workspace-bar-reference"><span>Bar</span> <strong>{s.measure.currentMeasure?.number ?? '—'}</strong>{s.loop.enabled && loop?.isValid && <small className="workspace-passage-label">{loop.label.replace(/^Measures/, 'Bars').replace(/^Measure/, 'Bar')}</small>}</span><span>{formatTime(current)} <i>/</i> {formatTime(duration || 0)}</span></div>
        <div className="workspace-seek-wrap">
          {loop?.isValid && duration > 0 && <span className={`workspace-loop-range${s.loop.enabled ? ' workspace-loop-range--on' : ''}`} style={{ left: `${loop.startTimeSeconds / duration * 100}%`, width: `${Math.max(.5, loop.durationSeconds / duration * 100)}%` }} title={`Loop: ${loop.label}`} />}
          <input type="range" aria-label="Score position" min="0" max={duration || 1} step="0.1" value={Math.min(current, duration || 1)} disabled={s.timingDisabled} onChange={e => s.handleMidiSeek(Number(e.target.value))} />
        </div>
      </div>
      <ToolButton tool={tool} onTool={onTool} id="tempo" icon="tempo" label="Tempo"><span className="workspace-tempo-mark"><span aria-hidden="true">♩ = </span>{p.effectiveTempo ?? '—'}<span className="sr-only"> beats per minute</span></span></ToolButton>
      <button className="workspace-tool-button workspace-click" aria-label="Metronome" aria-pressed={p.metronomeEnabled} title="Metronome" disabled={p.controlsDisabled} onClick={() => p.setMetronomeEnabled(!p.metronomeEnabled)}><Icon name="metronome" size={20} /><span>Click</span></button>
      <ToolButton tool={tool} onTool={onTool} id="loop" icon="loop" label="Loop">{s.loop.enabled ? loop.label.replace(/^Measures/, 'Bars').replace(/^Measure/, 'Bar') : 'Loop'}</ToolButton>
      <ToolButton tool={tool} onTool={onTool} id="sound" icon="tracks" label="Sound & accompaniment">Sound</ToolButton>
      <ToolButton tool={tool} onTool={onTool} id="settings" icon="settings" label="Workspace settings"><span className="workspace-settings-label">Settings</span></ToolButton>
    </div>
  </footer>
}
