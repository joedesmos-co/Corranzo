/**
 * Engraved score surface for MusicXML-only practice (arrangements).
 *
 * Presentation of the canonical PracticeSession: it paints engine per-note
 * states onto real OSMD noteheads and moves the OSMD cursor with the
 * canonical practice clock. It contains no evaluator, no matching and no
 * scheduling.
 *
 * States come from the same pure engine helpers the PDF overlay uses
 * (resolveWfyScoreNoteStates / play along lane outcomes) — never from
 * geometry, so this surface works without a PDF or source visual map.
 */
import { useEffect, useMemo, useRef } from 'react'
import useOsmdEngraving from '../../features/practice/useOsmdEngraving.js'
import {
  OSMD_NOTE_COLORS,
  matchCheckpointNotes,
  pairOsmdNotes,
} from '../../features/practice/osmdEngraving.js'
import {
  engravedCursorNotes,
  engravedNoteheadBox,
  noteheadPositionInContainer,
  soundingEngravedNote,
} from '../../features/practice/engravedScoreCursor.js'
import { buildNoteCheckpoints } from '../../features/practice/waitForYouCheckpoints.js'
import {
  SCORE_NOTE_STATE,
  findScoreEventIndexAtTime,
  mapPlayAlongOutcomeToScoreState,
  resolveChordToneStates,
  resolveWfyScoreNoteStates,
} from '../../features/practice/scoreNoteStates.js'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { usePracticeSessionContext, usePracticeVisualSession } from '../../context/PracticeSessionContext.jsx'

function stateColor(state) {
  switch (state) {
    case SCORE_NOTE_STATE.COMPLETED:
      return OSMD_NOTE_COLORS.completed
    case SCORE_NOTE_STATE.WRONG:
      return OSMD_NOTE_COLORS.wrong
    case SCORE_NOTE_STATE.MISSED:
      return OSMD_NOTE_COLORS.missed
    default:
      return OSMD_NOTE_COLORS.current
  }
}

/** Group whose onset is within 11 ms of a checkpoint (same rule as the PDF lane). */
function groupAtOnset(groups, timeSeconds) {
  let best = null
  let bestDelta = 0.011
  for (const group of groups ?? []) {
    const delta = Math.abs(Number(group.timeSeconds) - Number(timeSeconds))
    if (delta < bestDelta) {
      best = group
      bestDelta = delta
    }
  }
  return best
}

export default function OsmdScoreView({ musicXmlSource = null }) {
  // Notation bytes are stored decompressed (readScoreTimingBytes in App), so
  // any source kind — upload, .mxl archive, or audio arrangement — engraves
  // from the same plain-XML payload.
  const xml = musicXmlSource?.data ? new TextDecoder().decode(musicXmlSource.data) : null
  const targetPart = musicXmlSource?.omrMeta?.arrangement?.targetPart ?? null
  const { session } = usePracticeSessionContext()
  const visual = usePracticeVisualSession()
  const timingMap = session?.timing?.timingMap ?? null
  const tick = usePracticeTick()
  const cursorRef = useRef(null)
  const { containerRef, ready, error, noteIndex, paint, clearAll, scrollToNote, osmdRef, getContainer } =
    useOsmdEngraving({ xml, targetPart })

  // Ordered pairing between canonical notes and engraved notes, rebuilt only
  // when either side changes (score render / new timing map).
  const pairs = useMemo(
    () => (timingMap && noteIndex ? pairOsmdNotes(timingMap, noteIndex.allNotes) : null),
    [timingMap, noteIndex],
  )
  // Engine states, geometry-free: [{ checkpoint, state, toneStates }].
  const scoreStates = useMemo(() => {
    if (!timingMap) return []
    const loopRegion = session.isWaitForYou && session.loop?.enabled ? session.loop.region : null
    const checkpoints = session.isWaitForYou
      ? session.waitForYou.checkpoints ?? []
      : buildNoteCheckpoints(timingMap, loopRegion, { practiceScope: session.practiceScope })
    const practiceTime = Number(tick?.practiceTime ?? 0)

    if (session.isWaitForYou) {
      const states = resolveWfyScoreNoteStates({
        checkpoints,
        checkpointIndex: session.waitForYou.checkpointIndex ?? -1,
        status: session.waitForYou.status,
        inputFeedback: session.waitForYouInput?.inputFeedback ?? null,
      })
      const currentIndex = session.waitForYou.checkpointIndex ?? -1
      const currentCheckpoint = checkpoints[currentIndex] ?? null
      const matched = session.waitForYouInput?.inputFeedback?.matchedIndices
      const toneStates =
        currentCheckpoint?.isChord && matched != null
          ? resolveChordToneStates(currentCheckpoint, matched)
          : null
      const ordered = [...states.keys()].sort((a, b) => a - b).slice(-101)
      return ordered.map((index) => ({
        checkpoint: checkpoints[index] ?? null,
        state: states.get(index),
        toneStates: index === currentIndex ? toneStates : null,
      }))
    }

    const index = findScoreEventIndexAtTime(checkpoints, practiceTime)
    if (session.isPlayAlong) {
      const groups = session.playAlongLaneGroups ?? []
      const outcomes = session.playAlongFeedback?.outcomes ?? new Map()
      const entries = []
      if (index >= 0 && checkpoints[index]) {
        const group = groupAtOnset(groups, checkpoints[index].timeSeconds)
        const outcome = group ? outcomes.get(group.id) ?? null : null
        entries.push({
          checkpoint: checkpoints[index],
          state: outcome ? mapPlayAlongOutcomeToScoreState(outcome) : SCORE_NOTE_STATE.CURRENT,
          toneStates: null,
        })
        // Decided trail (bounded) so past misses stay visible but muted.
        let resolved = 0
        for (let i = index - 1; i >= 0 && resolved < 48; i -= 1) {
          const checkpoint = checkpoints[i]
          if (!checkpoint) continue
          const groupAt = groupAtOnset(groups, checkpoint.timeSeconds)
          const outcomeAt = groupAt ? outcomes.get(groupAt.id) ?? null : null
          if (!outcomeAt) continue
          entries.push({
            checkpoint,
            state: mapPlayAlongOutcomeToScoreState(outcomeAt),
            toneStates: null,
          })
          resolved += 1
        }
      }
      return entries
    }

    // Preview is a clean read of the score: the red cursor and the black
    // engraving are the whole presentation, so no notehead is painted there.
    return []
  }, [
    timingMap,
    session.isWaitForYou,
    session.isPlayAlong,
    session.waitForYou,
    session.waitForYouInput,
    session.playAlongLaneGroups,
    session.playAlongFeedback,
    session.loop?.enabled,
    session.loop?.region,
    session.practiceScope,
    tick?.practiceTime,
  ])

  // Paint canonical per-note states. Repaint only when the state signature
  // changes so the score is not touched on every clock tick.
  const lastSignatureRef = useRef('')
  const resolvedRef = useRef(new Map())
  useEffect(() => {
    if (!ready || !pairs) return
    const signature = scoreStates
      .map((entry) => {
        const tones = Array.isArray(entry.toneStates)
          ? entry.toneStates.map((tone) => `${tone.midi}:${tone.completed ? 1 : 0}`).join(',')
          : ''
        return `${entry.checkpoint?.id ?? 'none'}:${entry.state}:${tones}`
      })
      .join('|')
    if (signature === lastSignatureRef.current) return
    lastSignatureRef.current = signature
    clearAll()
    for (const entry of scoreStates) {
      const matched = matchCheckpointNotes(pairs, entry.checkpoint)
      if (matched.notes.length === 0) continue
      resolvedRef.current.set(entry.checkpoint?.id ?? '', matched)
      if (Array.isArray(entry.toneStates) && entry.toneStates.length > 0) {
        // Partial chords split per tone: each notehead carries its own state.
        const colorFor = new Map()
        for (const tone of entry.toneStates) {
          colorFor.set(
            Number(tone.midi),
            tone.completed ? OSMD_NOTE_COLORS.toneDone : OSMD_NOTE_COLORS.toneNeeded,
          )
        }
        for (const note of matched.notes) {
          paint([note], colorFor.get(note.midi) ?? stateColor(entry.state))
        }
      } else {
        paint(matched.notes, stateColor(entry.state))
      }
    }
  }, [ready, noteIndex, scoreStates, pairs, clearAll, paint])

  if (typeof window !== 'undefined') {
  }

  // Cursor: in Wait For You it LOCKs to the required checkpoint's own
  // musical position (the engine's source of truth for what to play next);
  // elsewhere it follows the canonical practice clock, converted from
  // seconds to written quarters via note-onset interpolation.
  const practiceTime = Number(tick?.practiceTime ?? 0)
  const cursorTime = useMemo(() => {
    if (!session.isWaitForYou) return practiceTime
    const checkpoint = scoreStates[0]?.checkpoint
    return Number.isFinite(checkpoint?.timeSeconds) ? checkpoint.timeSeconds : practiceTime
  }, [session.isWaitForYou, scoreStates, practiceTime])
  // OSMD's own cursor is hidden: the practice surface shows ONE cursor - the
  // red line, positioned from the engraved noteheads. Two cursors on one score
  // would be ambiguous about which one is the truth.
  useEffect(() => {
    if (!ready) return
    try {
      osmdRef.current?.cursor?.hide?.()
    } catch {
      // A cursor-less OSMD build simply has no second cursor.
    }
  }, [ready, osmdRef])

  // Keep the current musical position visible while playing.
  const isPlaying = Boolean(tick?.playbackIsPlaying)
  useEffect(() => {
    if (!ready || !isPlaying || !resolvedRef.current.size) return
    const entry = scoreStates[0]
    const matched = entry ? resolvedRef.current.get(entry.checkpoint?.id ?? '') : null
    if (matched?.notes?.length) scrollToNote(matched.notes[0])
  }, [isPlaying, practiceTime, ready, scoreStates, scrollToNote])

  // Engraved cursor: the same red line the PDF surface shows, positioned from
  // the engraved noteheads instead of PDF geometry. It reads the canonical
  // clock (the audio clock while playing) - there is no second practice clock.
  const cursorNotes = useMemo(() => (pairs ? engravedCursorNotes(pairs) : []), [pairs])
  const cursorTickRef = useRef(tick)
  const getScoreTimeRef = useRef(null)
  const cursorTimeRef = useRef(cursorTime)
  const isWaitForYouRef = useRef(session.isWaitForYou)
  useEffect(() => {
    cursorTickRef.current = tick
  }, [tick])
  useEffect(() => {
    getScoreTimeRef.current = visual.getScoreTime ?? null
  }, [visual.getScoreTime])
  useEffect(() => {
    cursorTimeRef.current = cursorTime
    isWaitForYouRef.current = session.isWaitForYou
  }, [cursorTime, session.isWaitForYou])
  useEffect(() => {
    if (!ready || !cursorNotes.length) return undefined
    const container = getContainer()
    const element = cursorRef.current
    if (!container || !element) return undefined
    let frameId = 0
    let lastSignature = ''

    const paint = () => {
      const svg = container.querySelector('svg')
      const currentTick = cursorTickRef.current
      const playing = Boolean(currentTick?.playbackIsPlaying)
      const getScoreTime = getScoreTimeRef.current
      // Wait For You locks the line to the note the engine is waiting for;
      // otherwise the line follows the canonical clock (the audio clock while
      // the music plays).
      const seconds = isWaitForYouRef.current
        ? cursorTimeRef.current
        : playing && typeof getScoreTime === 'function'
          ? getScoreTime()
          : Number(currentTick?.practiceTime ?? 0)
      const { current, previous, ratio } = soundingEngravedNote(cursorNotes, seconds)
      if (!svg || !current) {
        element.style.display = 'none'
        frameId = requestAnimationFrame(paint)
        return
      }
      const box = engravedNoteheadBox(current.engraving)
      const previousBox = previous ? engravedNoteheadBox(previous.engraving) : null
      const position = box ? noteheadPositionInContainer(box, svg, container) : null
      if (!position) {
        element.style.display = 'none'
        frameId = requestAnimationFrame(paint)
        return
      }
      const previousPosition = previousBox
        ? noteheadPositionInContainer(previousBox, svg, container)
        : null
      const left = previousPosition
        ? previousPosition.left + (position.left - previousPosition.left) * ratio
        : position.left
      const centerY = position.top + position.height / 2
      // The bar spans the staff the note is written on: a notehead is about one
      // staff space tall, so five of them cover the staff it sits in.
      const barHeight = Math.max(position.height * 5, 20)
      const signature = `${Math.round(left * 2)}:${Math.round(centerY * 2)}:${Math.round(barHeight * 2)}`
      if (signature !== lastSignature) {
        lastSignature = signature
        // The cursor is hidden by default in CSS, so it must be shown
        // explicitly (an empty inline display would fall back to the rule).
        element.style.display = 'block'
        element.style.left = `${left}px`
        element.style.top = `${centerY - barHeight / 2}px`
        element.style.height = `${barHeight}px`
        element.setAttribute('data-engraved-cursor-measure', String(current.note.measureNumber ?? ''))
        element.setAttribute('data-engraved-cursor-midi', String(current.note.midi ?? ''))
      }
      frameId = requestAnimationFrame(paint)
    }

    frameId = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frameId)
  }, [ready, cursorNotes, getContainer])


  if (!xml) return null
  if (error) {
    return (
      <div className="osmd-score osmd-score--error" role="status">
        <p>This arrangement could not be engraved on this device.</p>
        <p className="audio-vision-hint">Timing, sound and practice still work from the notation.</p>
      </div>
    )
  }
  return (
    <div className="osmd-score">
      <div
        ref={containerRef}
        className={`osmd-score__container${ready ? ' osmd-score__container--ready' : ''}`}
        data-osmd-ready={ready ? 'true' : 'false'}
        data-osmd-target={targetPart ?? 'unknown'}
        role="img"
        aria-label={ready ? 'Engraved sheet music with practice highlights. The target list below states every note.' : 'Engraving sheet music…'}
      >
        <div ref={cursorRef} className="engraved-score-cursor" data-engraved-cursor="true" aria-hidden>
          <span className="score-follow-bar__line engraved-score-cursor__line" />
        </div>
      </div>
      {pairs?.approximate && (
        <p className="audio-vision-hint osmd-score__approx" role="note">
          Highlight position is approximate on this score (repeats). Timing and practice are exact.
        </p>
      )}
    </div>
  )
}
