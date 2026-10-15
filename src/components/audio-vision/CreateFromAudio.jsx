/**
 * A9 — Create From Audio: upload → Piano/Guitar + difficulty → progress →
 * review → Open in Corranzo Practice. Uses Corranzo visual language
 * (cz-* classes) and avoids audio-production jargon.
 */
import { useRef, useState } from 'react'
import { useAudioArrangement } from '../../features/audio-vision/useAudioArrangement.js'
import { PART_INSTRUMENTS, DIFFICULTIES } from '../../features/audio-vision/arrangementModel.js'

const TARGET_LABELS = {
  [PART_INSTRUMENTS.SOLO_PIANO]: 'Solo Piano',
  [PART_INSTRUMENTS.SOLO_GUITAR]: 'Solo Guitar',
}
const TARGET_HELP = {
  [PART_INSTRUMENTS.SOLO_PIANO]: 'Two-hand piano score from your recording.',
  [PART_INSTRUMENTS.SOLO_GUITAR]: 'One playable guitar part with standard notation + TAB.',
}
const DIFFICULTY_HELP = {
  [DIFFICULTIES.EASY]: 'Recognizable melody, simpler chords.',
  [DIFFICULTIES.INTERMEDIATE]: 'More harmony and rhythmic detail.',
  [DIFFICULTIES.ADVANCED]: 'Fullest detail that stays playable.',
}
function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '–'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function excerptCoverage(excerpt) {
  if (!excerpt) return null
  const end = excerpt.startSeconds + excerpt.durationSeconds
  return `${formatClock(excerpt.startSeconds)}–${formatClock(end)} of ${formatClock(excerpt.totalSeconds)}`
}
const STAGE_LABELS = {
  validate: 'Checking your file',
  spectrogram: 'Listening to the recording',
  onsets: 'Finding note beginnings',
  tempo: 'Finding the tempo',
  beats: 'Mapping the beats',
  harmony: 'Hearing the chords',
  'melody-bass': 'Following the melody and bass',
  sections: 'Mapping song sections',
  notes: 'Recognizing notes',
  done: 'Finishing up',
}

export default function CreateFromAudio({ onArrangementReady = null, uploadsDisabled = false }) {
  const [file, setFile] = useState(null)
  const [target, setTarget] = useState(PART_INSTRUMENTS.SOLO_PIANO)
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.INTERMEDIATE)
  const [dragOver, setDragOver] = useState(false)
  const [excerptStart, setExcerptStart] = useState(0)
  const [excerptLength, setExcerptLength] = useState(180)
  const inputRef = useRef(null)
  const flow = useAudioArrangement({ onReady: onArrangementReady })
  const busy = ['validating', 'analyzing', 'arranging'].includes(flow.phase)
  const totalDuration = flow.probe?.durationSeconds ?? null
  // Phase 7: explicit excerpt selector for recordings over ~1 minute.
  // Never silent: the review always states the covered range.
  const needsExcerpt = Number.isFinite(totalDuration) && totalDuration > 65
  const clampedStart = needsExcerpt
    ? Math.max(0, Math.min(totalDuration - Math.min(excerptLength, totalDuration), excerptStart))
    : 0

  function pickFile(next) {
    if (uploadsDisabled || flow.phase === 'analyzing') return
    if (next) {
      setFile(next)
      flow.reset()
      setExcerptStart(0)
      setExcerptLength(180)
      flow.probeFile(next)
    }
  }

  const result = flow.result?.ok ? flow.result : null

  return (
    <section className="cz-collection-card audio-vision-card" aria-label="Create from audio">
      <p className="cz-edition-label">New · Audio Vision</p>
      <h2>Create from audio</h2>
      <p className="audio-vision-sub">Upload a song. Get back one playable score — solo piano or one guitar.</p>

      {flow.phase === 'idle' || flow.phase === 'error' || flow.phase === 'refused' ? (
        <>
          <div
            className={`audio-vision-drop${dragOver ? ' audio-vision-drop--over' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Choose an audio file (MP3, WAV, M4A)"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pickFile(e.dataTransfer?.files?.[0] ?? null)
            }}
          >
            <p><strong>{file ? file.name : 'Drop your song here, or browse'}</strong></p>
            <p className="audio-vision-hint">MP3 · WAV · M4A — up to 10 minutes. Processed privately in this browser; recordings are not kept.</p>
            <input
              ref={inputRef}
              type="file"
              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="audio-vision-options">
            <fieldset>
              <legend>Arrange for</legend>
              {Object.values(PART_INSTRUMENTS).map((value) => (
                <label key={value} className="audio-vision-radio">
                  <input type="radio" name="audio-vision-target" value={value} checked={target === value} onChange={() => setTarget(value)} />
                  <span><strong>{TARGET_LABELS[value]}</strong><span>{TARGET_HELP[value]}</span></span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Difficulty</legend>
              {Object.values(DIFFICULTIES).map((value) => (
                <label key={value} className="audio-vision-radio">
                  <input type="radio" name="audio-vision-difficulty" value={value} checked={difficulty === value} onChange={() => setDifficulty(value)} />
                  <span><strong style={{ textTransform: 'capitalize' }}>{value}</strong><span>{DIFFICULTY_HELP[value]}</span></span>
                </label>
              ))}
            </fieldset>
          </div>

          {flow.phase === 'error' && flow.error && (
            <p className="audio-vision-error" role="alert">{flow.error.message}</p>
          )}
          {flow.phase === 'refused' && flow.error && (
            <div className="audio-vision-error" role="alert">
              <strong>Not enough to go on.</strong>
              <p>{flow.error.message}</p>
            </div>
          )}

          {Number.isFinite(totalDuration) && (
            <p className="audio-vision-hint" role="status">Recording length {formatClock(totalDuration)}.</p>
          )}
          {flow.probe?.error && (
            <p className="audio-vision-hint" role="note">Duration check didn&apos;t finish — arranging will validate the file.</p>
          )}
          {needsExcerpt && (
            <fieldset className="audio-vision-excerpt">
              <legend>Arrange this part <span className="audio-vision-hint">(up to 3 minutes per arrangement)</span></legend>
              <label>
                Start at {formatClock(clampedStart)}
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalDuration - 30)}
                  step={5}
                  value={clampedStart}
                  onChange={(e) => setExcerptStart(Number(e.target.value))}
                  aria-label="Excerpt start time"
                />
              </label>
              <label>
                Length
                <select value={excerptLength} onChange={(e) => setExcerptLength(Number(e.target.value))} aria-label="Excerpt length">
                  {[30, 60, 120, 180].map((s) => (
                    <option key={s} value={s}>{s >= 60 ? `${s / 60} minute${s > 60 ? 's' : ''}` : `${s} seconds`}</option>
                  ))}
                </select>
              </label>
              <p className="audio-vision-hint">Will arrange {excerptCoverage({ startSeconds: clampedStart, durationSeconds: Math.min(excerptLength, totalDuration - clampedStart), totalSeconds: totalDuration })}.</p>
            </fieldset>
          )}

          <button
            className="cz-collection-button"
            disabled={!file || busy || uploadsDisabled}
            onClick={() => flow.arrange(file, {
              targetPart: target,
              difficulty,
              excerpt: needsExcerpt
                ? { startSeconds: clampedStart, durationSeconds: Math.min(excerptLength, totalDuration - clampedStart) }
                : null,
            })}
          >
            {file ? `Arrange for ${TARGET_LABELS[target]}` : 'Choose a song first'}
          </button>
        </>
      ) : null}

      {busy && (
        <div className="audio-vision-progress" role="status" aria-live="polite">
          <p><strong>{STAGE_LABELS[flow.progress?.stage] ?? 'Working'}</strong></p>
          <div className="audio-vision-progress-bar" aria-hidden="true">
            <div style={{ width: `${Math.round((flow.progress?.fraction ?? 0) * 100)}%` }} />
          </div>
          <p className="audio-vision-hint">Analyzing your recording — this can take a minute on long songs.</p>
          <button className="cz-text-link" onClick={flow.cancel}>Cancel</button>
        </div>
      )}

      {flow.phase === 'review' && result && (
        <div className="audio-vision-review">
          <p className="cz-edition-label" role="status">Your arrangement is ready</p>
          <h3>{TARGET_LABELS[result.model.targetPart]} · <span style={{ textTransform: 'capitalize' }}>{result.model.difficulty}</span></h3>
          <ul className="audio-vision-facts">
            {flow.rememberedTempo && (
              <li className="audio-vision-hint">Using your saved correction of {flow.rememberedTempo.bpm} BPM for this recording.</li>
            )}
            <li>
              Tempo <strong>{result.transcribed.tempo.bpm} BPM</strong>
              {result.transcribed.tempo.varies ? ' (varies)' : ''}
              {result.transcribed.tempo.ambiguousTempo ? ' (approximate)' : ''}
              {result.transcribed.tempo.source === 'user-override' ? ' (your correction)' : ''}
            </li>
            {result.transcribed.tempo.source === 'user-override' && (
              <li className="audio-vision-hint">Estimated {result.transcribed.tempo.estimatedBpm} BPM — replaced by your correction.</li>
            )}
            {result.transcribed.tempo.ambiguousTempo && (
              <li className="audio-vision-hint">
                The pulse could be read differently
                {result.transcribed.tempo.alternativeTempo
                  ? ` (${result.transcribed.tempo.alternativeTempo} BPM)`
                  : result.transcribed.tempo.octaveAlternative
                    ? ` (${result.transcribed.tempo.octaveAlternative} BPM)`
                    : ''}
                {' '}— durations in this arrangement may be half or double what you expect. Check the preview before practicing.
              </li>
            )}
            {result.transcribed.tempo.ambiguousTempo && (
              <li className="audio-vision-hint">
                Tempo is approximate — the pulse could be half or double
                {result.transcribed.tempo.octaveAlternative ? ` (${result.transcribed.tempo.octaveAlternative} BPM)` : ''}.
                Listen to the preview to check the tempo before practicing.
              </li>
            )}
            <li>Notes <strong>{result.model.parts[0].events.length}</strong> · Measures <strong>{new Set(result.model.parts[0].events.map((e) => e.measureIndex)).size}</strong></li>
            <li>Recognized with <strong>{result.confidence.pitchSource === 'basic-pitch' ? 'neural pitch recognition' : 'on-device pitch analysis'}</strong></li>
            <li>Confidence <strong>{Math.round(result.confidence.overall * 100)}%</strong></li>
            {Number.isFinite(result.transcriptionAgreement) && (
              <li>Second check agreed {Math.round(result.transcriptionAgreement * 100)}% of the time</li>
            )}
          </ul>
          {result.uncertainRegions?.length > 0 && (
            <div className="audio-vision-error" role="note">
              <strong>{result.uncertainRegions.length} passage{result.uncertainRegions.length === 1 ? '' : 's'} could not be corroborated.</strong>
              <p>An independent on-device check disagreed with the transcription here — treat these moments as approximate:</p>
              <ul>
                {result.uncertainRegions.slice(0, 5).map((r, i) => (
                  <li key={i}>{formatClock(r.startSeconds)}–{formatClock(r.endSeconds)}</li>
                ))}
              </ul>
            </div>
          )}
          {result.partial && <p className="audio-vision-error" role="note">{result.message}</p>}
          {result.excerpt && (
            <p className="audio-vision-hint" role="note">
              Arranged {excerptCoverage(result.excerpt)}
              {result.excerpt.truncated ? ' — only this part becomes sheet music.' : ' (whole recording).'}
            </p>
          )}
          {result.model.parts[0].warnings?.length > 0 && (
            <details>
              <summary>Arranger notes ({result.model.parts[0].warnings.length})</summary>
              <ul>
                {result.model.parts[0].warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w.kind.replace(/-/g, ' ')}{w.detail ? ` — ${w.detail}` : ''}</li>
                ))}
              </ul>
            </details>
          )}
          {/* PRIORITY 2: tempo correction is available for EVERY arrangement, not
              only when automatic analysis flags uncertainty. A confidently wrong
              estimate must also be correctable. */}
          <div className="audio-vision-tempo-fix">
            <label htmlFor="audio-vision-tempo">
              <strong>Tempo wrong?</strong> Correct it and the whole arrangement is rebuilt —
              notes, timing, MusicXML, preview and practice checkpoints all follow the
              corrected value. Already perfect? Leave it as is.
            </label>
            <div className="audio-vision-tempo-fix-row">
              <input
                id="audio-vision-tempo"
                type="number"
                min={30}
                max={300}
                step={1}
                defaultValue={result.transcribed.tempo.bpm}
                aria-label="Corrected tempo in BPM"
              />
              <span className="audio-vision-hint">BPM</span>
              <button
                className="cz-collection-button"
                disabled={busy}
                onClick={() => {
                  const input = document.getElementById('audio-vision-tempo')
                  const value = Number(input?.value)
                  if (Number.isFinite(value) && value >= 30 && value <= 300) flow.arrangeWithTempo(value)
                }}
              >
                {busy ? 'Rebuilding…' : 'Rebuild with this tempo'}
              </button>
            </div>
          </div>
          <button className="cz-collection-button" onClick={flow.openInPractice}>Open in Corranzo Practice</button>
          <p className="audio-vision-hint">Opens as normal sheet music with Preview, Play Along and Wait For You.</p>
          <button className="cz-text-link" onClick={flow.reset}>Arrange something else</button>
        </div>
      )}
    </section>
  )
}
