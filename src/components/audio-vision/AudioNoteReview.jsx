/**
 * Audio Vision note review: remove, edit pitch/onset/duration, and add missing
 * notes. Every action is a correction record; the transcription evidence stays
 * immutable, so Undo can always restore exactly what was heard.
 */
import { useState } from 'react'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function noteName(midi) {
  const value = Math.round(Number(midi))
  if (!Number.isFinite(value)) return '?'
  return `${NOTE_NAMES[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`
}

function midiFromNoteName(text) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(text ?? '').trim())
  if (!match) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()]
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0
  const midi = (Number(match[3]) + 1) * 12 + base + accidental
  return midi >= 21 && midi <= 108 ? midi : null
}

function positionOf(event, beatsPerMeasure = 4) {
  const beats = Math.max(1, Math.round(beatsPerMeasure))
  const startBeat = Math.max(0, Number(event.startBeat) || 0)
  const bar = Math.floor((startBeat + 1e-9) / beats) + 1
  const beat = Math.round((startBeat - (bar - 1) * beats) * 100) / 100
  return { bar, beat: beat + 1 }
}

function editBadge(event, corrections) {
  if (event.isUserAdded) return 'added by you'
  return corrections?.notes?.[event.correctionKey] ? 'edited' : ''
}

export default function AudioNoteReview({ result, flow }) {
  const [selectedKey, setSelectedKey] = useState(null)
  const [newNote, setNewNote] = useState({ name: 'C4', bar: 1, beat: 1, duration: 1 })
  const [message, setMessage] = useState(null)
  if (!result?.ok) return null

  const beats = Math.max(1, Math.round(result.notation?.beatsPerMeasure ?? 4))
  const events = result.model?.parts?.[0]?.events ?? []
  const removed = [...(result.removedEvents ?? []), ...(result.removedAddedEvents ?? [])]
  const editedCount = Object.keys(result.corrections?.notes ?? {}).length
  const addedCount = events.filter((event) => event.isUserAdded).length
  if (!events.length && !removed.length && !editedCount && !addedCount) return null

  const hasCorrections = removed.length > 0 || editedCount > 0 || addedCount > 0

  function submitNewNote(event) {
    event.preventDefault()
    const midi = midiFromNoteName(newNote.name)
    if (midi == null) {
      setMessage('Use a note name such as C4, F#3 or Bb5.')
      return
    }
    const bar = Math.max(1, Math.floor(Number(newNote.bar) || 1))
    const beat = Math.min(beats, Math.max(1, Number(newNote.beat) || 1))
    const duration = Math.max(0.05, Number(newNote.duration) || 1)
    const startBeat = (bar - 1) * beats + (beat - 1)
    flow.addNote({ midi, startBeat, durBeats: duration, hand: 'RH', role: 'user' })
    setMessage(`Added ${noteName(midi)} at bar ${bar}, beat ${beat}.`)
  }

  return (
    <details className="audio-vision-note-review">
      <summary>
        Review notes ({events.length}
        {removed.length > 0 ? ` · ${removed.length} removed` : ''}
        {editedCount > 0 ? ` · ${editedCount} edited` : ''}
        {addedCount > 0 ? ` · ${addedCount} added` : ''})
      </summary>
      <p className="audio-vision-hint">
        Correct a note, move its timing or length, or add one the transcription missed.
        The score, preview and practice checkpoints rebuild from these corrections; the
        original transcription stays available for Undo.
      </p>
      {result.correctionsStale > 0 && (
        <p className="audio-vision-hint" role="note">
          {result.correctionsStale} saved correction{result.correctionsStale === 1 ? '' : 's'} no longer
          match this arrangement and {result.correctionsStale === 1 ? 'is' : 'are'} inert.
        </p>
      )}
      {result.correctionsSkipped > 0 && (
        <p className="audio-vision-hint" role="note">
          {result.correctionsSkipped} added note{result.correctionsSkipped === 1 ? '' : 's'} duplicated
          an existing pitch and beat and {result.correctionsSkipped === 1 ? 'was' : 'were'} skipped.
        </p>
      )}

      {removed.length > 0 && (
        <div className="audio-vision-note-removed">
          <p className="audio-vision-hint"><strong>Removed by you ({removed.length})</strong></p>
          <ul className="audio-vision-note-list">
            {removed.map((event) => {
              const { bar, beat } = positionOf(event, beats)
              return (
                <li key={event.correctionKey} className="audio-vision-note-row">
                  <span>
                    <strong>{noteName(event.midi)}</strong>
                    <span className="audio-vision-hint">
                      {' '}· bar {bar} · beat {beat}
                      {event.isUserAdded ? ' · added note' : ''}
                    </span>
                  </span>
                  <button
                    className="cz-text-link"
                    onClick={() => flow.undoNoteRemoval(event.correctionKey)}
                    aria-label={`Undo removal of ${noteName(event.midi)} at bar ${bar} beat ${beat}`}
                  >
                    Undo
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <ul className="audio-vision-note-list audio-vision-note-list-tall">
        {events.map((event, index) => {
          const { bar, beat } = positionOf(event, beats)
          const badge = editBadge(event, result.corrections)
          const isSelected = selectedKey === event.correctionKey
          return (
            <li key={event.correctionKey ?? `${event.midi}-${event.startBeat}-${index}`}>
              <div className="audio-vision-note-row">
                <span>
                  <strong>{noteName(event.midi)}</strong>
                  <span className="audio-vision-hint">
                    {' '}· bar {bar} · beat {beat} · {Number(event.durBeats ?? 0).toFixed(2)} beats
                    {event.hand ? ` · ${event.hand}` : ''}
                    {badge ? ` · ${badge}` : ''}
                  </span>
                </span>
                <span className="audio-vision-note-actions">
                  {!event.isUserAdded && event.correctionKey && (
                    <button
                      className="cz-text-link"
                      onClick={() => setSelectedKey(isSelected ? null : event.correctionKey)}
                      aria-expanded={isSelected}
                      aria-label={`Edit ${noteName(event.midi)} at bar ${bar} beat ${beat}`}
                    >
                      {isSelected ? 'Close' : 'Edit'}
                    </button>
                  )}
                  <button
                    className="cz-text-link"
                    onClick={() => flow.removeNote(event.correctionKey)}
                    aria-label={`Remove ${noteName(event.midi)} at bar ${bar} beat ${beat}`}
                    disabled={!event.correctionKey}
                  >
                    Remove
                  </button>
                </span>
              </div>
              {isSelected && (
                <div className="audio-vision-note-editor" role="group" aria-label={`Edit ${noteName(event.midi)}`}>
                  <span className="audio-vision-note-editor-label">Pitch</span>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { pitchDelta: -1 })}>−1</button>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { pitchDelta: 1 })}>+1</button>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { pitchDelta: -12 })}>−8va</button>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { pitchDelta: 12 })}>+8va</button>
                  <span className="audio-vision-note-editor-label">Onset</span>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { onsetDeltaBeats: -0.25 })}>−0.25</button>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { onsetDeltaBeats: 0.25 })}>+0.25</button>
                  <span className="audio-vision-note-editor-label">Length</span>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { durationDeltaBeats: -0.25 })}>−0.25</button>
                  <button className="cz-text-link" onClick={() => flow.editNote(event.correctionKey, { durationDeltaBeats: 0.25 })}>+0.25</button>
                  <button
                    className="cz-text-link"
                    onClick={() => flow.resetNoteEdits(event.correctionKey)}
                    aria-label={`Reset edits of ${noteName(event.midi)}`}
                  >
                    Reset edits
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {hasCorrections && (
        <div className="audio-vision-note-actions">
          <button className="cz-text-link" onClick={flow.undoLastNoteRemoval}>Undo last correction</button>
          <button className="cz-text-link" onClick={flow.clearNoteCorrections}>Clear all corrections</button>
        </div>
      )}

      <form className="audio-vision-note-add" onSubmit={submitNewNote}>
        <strong>Add a missing note</strong>
        <label>
          Pitch
          <input
            value={newNote.name}
            onChange={(event) => setNewNote((previous) => ({ ...previous, name: event.target.value }))}
            aria-label="New note pitch"
            placeholder="C4"
            size={4}
          />
        </label>
        <label>
          Bar
          <input
            type="number"
            min={1}
            value={newNote.bar}
            onChange={(event) => setNewNote((previous) => ({ ...previous, bar: event.target.value }))}
            aria-label="New note bar"
            style={{ width: '4.5em' }}
          />
        </label>
        <label>
          Beat
          <input
            type="number"
            min={1}
            max={beats}
            step={0.25}
            value={newNote.beat}
            onChange={(event) => setNewNote((previous) => ({ ...previous, beat: event.target.value }))}
            aria-label="New note beat"
            style={{ width: '4.5em' }}
          />
        </label>
        <label>
          Beats long
          <input
            type="number"
            min={0.05}
            step={0.25}
            value={newNote.duration}
            onChange={(event) => setNewNote((previous) => ({ ...previous, duration: event.target.value }))}
            aria-label="New note duration in beats"
            style={{ width: '5em' }}
          />
        </label>
        <button className="cz-text-link" type="button" onClick={submitNewNote}>Add note</button>
        {message && <span className="audio-vision-hint" role="status">{message}</span>}
      </form>
    </details>
  )
}
