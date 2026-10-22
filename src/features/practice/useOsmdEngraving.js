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
import { ownedNoteheadGlyphs } from './ownedNoteheadGlyphs.js'

// Paint the paths themselves: VexFlow children have explicit black fills,
// which override fill inherited from the notehead's group.
const originalStyles = new WeakMap()
function paintGraphicalNote(note, color) {
  for (const head of ownedNoteheadGlyphs(note)) {
    const shapes = head.matches('path, text, ellipse') ? [head] : [...head.querySelectorAll('path, text, ellipse')]
    for (const shape of shapes) {
      if (!originalStyles.has(shape)) originalStyles.set(shape, shape.getAttribute('style'))
      if (shape.getAttribute('fill') === 'none') shape.style.stroke = color
      else shape.style.fill = color
      shape.setAttribute('data-cz-painted', color)
      shape.setAttribute('data-cz-midi', String(note.midi))
    }
  }
}
function clearGraphicalNote(note) {
  for (const head of ownedNoteheadGlyphs(note)) {
    for (const shape of [head, ...head.querySelectorAll('[data-cz-painted]')]) {
      if (!originalStyles.has(shape)) continue
      const style = originalStyles.get(shape)
      if (style == null) shape.removeAttribute('style')
      else shape.setAttribute('style', style)
      originalStyles.delete(shape)
      shape.removeAttribute('data-cz-painted')
      shape.removeAttribute('data-cz-midi')
    }
  }
}

export default function useOsmdEngraving({ xml, targetPart = null }) {
  const containerRef = useRef(null)
  const osmdRef = useRef(null)
  const paintedRef = useRef(new Set())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [noteIndex, setNoteIndex] = useState(null)

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
    setReady(false)
  }, [])

  useEffect(() => {
    if (!xml || !containerRef.current) {
      return undefined
    }
    let disposed = false
    let observer = null
    let resizeFrame = 0
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
        if (disposed || !containerRef.current) return
        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          backend: 'svg',
          autoResize: false,
          pageFormat: 'Endless',
          drawingType: 'engraving',
          followCursor: false,
          // Presence, not perfection: the score must stay readable at phone
          // widths even when the layout has to compress.
          renderSingleHorizontalStaffline: false,
          stretchLastSystemLine: false,
        })
        await osmd.load(xml)
        if (disposed) {
          try { osmd.clear() } catch { /* ignore */ }
          return
        }
        osmd.EngravingRules.LastSystemMaxScalingFactor = 1.25
        await osmd.render()
        if (disposed) {
          try { osmd.clear() } catch { /* ignore */ }
          return
        }
        osmdRef.current = osmd
        const collected = collectOsmdNotes(osmd)
        setNoteIndex({ size: buildOsmdNoteIndex(collected).size, allNotes: collected })
        setReady(true)
        let lastWidth = containerRef.current.clientWidth
        observer = new ResizeObserver(() => {
          const width = containerRef.current?.clientWidth ?? 0
          if (disposed || width <= 0 || Math.abs(width - lastWidth) < 1) return
          lastWidth = width
          cancelAnimationFrame(resizeFrame)
          resizeFrame = requestAnimationFrame(() => {
            if (disposed) return
            osmd.render()
            paintedRef.current.clear()
            const notes = collectOsmdNotes(osmd)
            setNoteIndex({ size: buildOsmdNoteIndex(notes).size, allNotes: notes })
          })
        })
        observer.observe(containerRef.current)
      } catch (loadError) {
        if (!disposed) {
          setError(loadError?.message ? String(loadError.message) : 'Engraving failed')
        }
      }
    })()
    return () => {
      disposed = true
      observer?.disconnect()
      cancelAnimationFrame(resizeFrame)
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
