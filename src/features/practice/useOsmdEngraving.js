/**
 * OSMD engraving hook: lazily loads OpenSheetMusicDisplay and renders a
 * MusicXML string as real sheet music inside a container.
 *
 * The engraver is presentation only. Nothing here schedules audio, matches
 * input, or decides practice state — the canonical PracticeSession supplies
 * every state (scoreNoteStates, practiceTime); this hook supplies glyphs
 * and paints them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildOsmdNoteIndex,
  collectOsmdNotes,
} from './osmdEngraving.js'
/** Inline style beats the VexFlow stylesheet (verified in-browser). */
function paintGraphicalNote(note, color) {
  const graphical = note.graphicalNote
  if (!graphical) return
  try {
    const heads = graphical.getNoteheadSVGs?.() ?? []
    for (const head of heads) {
      head.style.fill = color
      head.setAttribute('data-cz-painted', '1')
    }
    const stem = graphical.getStemSVG?.()
    if (stem) stem.style.stroke = color
    const gl = graphical.getSVGGElement?.()
    if (gl) gl.setAttribute('data-cz-score-note', '1')
  } catch {
    // A note OSMD could not expose glyphs for simply stays unpainted.
  }
}

function clearGraphicalNote(note) {
  const graphical = note.graphicalNote
  if (!graphical) return
  try {
    const heads = graphical.getNoteheadSVGs?.() ?? []
    for (const head of heads) {
      head.style.fill = ''
      head.style.stroke = ''
      head.removeAttribute('data-cz-painted')
    }
    const stem = graphical.getStemSVG?.()
    if (stem) stem.style.stroke = ''
  } catch {
    // ignore
  }
}

export default function useOsmdEngraving({ xml, targetPart = null }) {
  const containerRef = useRef(null)
  const osmdRef = useRef(null)
  const paintedRef = useRef(new Set())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [noteIndex, setNoteIndex] = useState(null)
  const [allNotes, setAllNotes] = useState(null)

  const dispose = useCallback(() => {
    const osmd = osmdRef.current
    if (!osmd) return
    try {
      osmd.clear()
    } catch {
      // disposing twice is fine
    }
    osmdRef.current = null
    paintedRef.current.clear()
    setNoteIndex(null)
    setAllNotes(null)
    setReady(false)
  }, [])

  useEffect(() => {
    if (!xml || !containerRef.current) {
      return undefined
    }
    let disposed = false
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
        if (disposed || !containerRef.current) return
        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          backend: 'svg',
          autoResize: true,
          pageFormat: 'Endless',
          drawingType: 'engraving',
          followCursor: false,
          // Presence, not perfection: the score must stay readable at phone
          // widths even when the layout has to compress.
          renderSingleHorizontalStaffline: targetPart === 'solo-guitar',
        })
        await osmd.load(xml)
        if (disposed) {
          try { osmd.clear() } catch { /* ignore */ }
          return
        }
        await osmd.render()
        if (disposed) {
          try { osmd.clear() } catch { /* ignore */ }
          return
        }
        osmdRef.current = osmd
        const collected = collectOsmdNotes(osmd)
        setAllNotes(collected)
        setNoteIndex({ size: buildOsmdNoteIndex(collected).size, allNotes: collected })
        setReady(true)
      } catch (loadError) {
        if (!disposed) {
          setError(loadError?.message ? String(loadError.message) : 'Engraving failed')
        }
      }
    })()
    return () => {
      disposed = true
      dispose()
    }
  }, [xml, targetPart, dispose])

  const paint = useCallback((notes, color) => {
    for (const note of notes ?? []) {
      paintGraphicalNote(note, color)
      paintedRef.current.add(note)
    }
  }, [])

  const clearAll = useCallback(() => {
    for (const note of paintedRef.current) {
      clearGraphicalNote(note)
    }
    paintedRef.current.clear()
  }, [])

  /** Graphical notes whose x is nearest a DOM viewport (for scrolling). */
  const scrollToNote = useCallback((note) => {
    const element = note?.graphicalNote?.getSVGGElement?.()
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
  }, [])

  /**
   * The engraved score's scroll container. Exposed as an accessor so callers
   * can read the live DOM node without touching a ref during render.
   */
  const getContainer = useCallback(() => containerRef.current, [])

  return { containerRef, ready, error, noteIndex, paint, clearAll, scrollToNote, osmdRef, getContainer }
}

export { paintGraphicalNote, clearGraphicalNote }
