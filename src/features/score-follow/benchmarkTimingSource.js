/**
 * Benchmark corpus timing-source classification (tooling only).
 */

export const TIMING_SOURCE_KIND = {
  SYNTHETIC: 'synthetic',
  REAL_MUSICXML: 'real-musicxml',
  REAL_MXL: 'real-mxl',
  MIDI_DERIVED_MUSICXML: 'midi-derived-musicxml',
}

/** Mutopia PDF URL → shared base path (without -a4.pdf). */
export function inferMutopiaBaseUrl(pdfUrl) {
  if (!pdfUrl || typeof pdfUrl !== 'string') {
    return null
  }
  return pdfUrl.replace(/-a4\.pdf$/i, '').replace(/-let\.pdf$/i, '').replace(/\.pdf$/i, '')
}

/** Resolve explicit and probe timing URLs for a manifest entry. */
export function resolveMutopiaTimingUrls(entry) {
  const mutopia = entry.mutopia ?? {}
  const timing = entry.timing ?? {}
  const base = inferMutopiaBaseUrl(mutopia.pdfUrl)
  const explicitMusicXml = timing.musicxmlUrl ?? mutopia.musicxmlUrl ?? null
  const explicitMxl = timing.mxlUrl ?? mutopia.mxlUrl ?? null

  const probeUrls = []
  if (base && !explicitMusicXml && !explicitMxl) {
    probeUrls.push(`${base}.musicxml`, `${base}.xml`, `${base}.mxl`)
  }

  return {
    musicxmlUrl: explicitMusicXml,
    mxlUrl: explicitMxl,
    midiUrl: mutopia.midiUrl ?? null,
    lyUrl: mutopia.lyUrl ?? (base ? `${base}.ly` : null),
    probeUrls,
  }
}

/** Classify timing source from runner + resolved path/metadata. */
export function classifyTimingSourceKind({ runner, timingPath = null, timingMeta = null } = {}) {
  if (timingMeta?.kind) {
    return timingMeta.kind
  }
  if (runner === 'synthetic') {
    return TIMING_SOURCE_KIND.SYNTHETIC
  }
  const path = String(timingPath ?? '').toLowerCase()
  if (path.endsWith('.mxl')) {
    return TIMING_SOURCE_KIND.REAL_MXL
  }
  if (timingMeta?.derivedFrom === 'midi' || path.includes('midi-derived') || path.includes('/score.musicxml')) {
    // Cached remote score.musicxml without meta defaults to midi-derived unless marked otherwise.
    if (timingMeta?.derivedFrom === 'midi' || path.includes('midi-derived')) {
      return TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML
    }
  }
  if (path.endsWith('.musicxml') || path.endsWith('.xml')) {
    if (runner === 'local' || timingMeta?.derivedFrom === 'explicit') {
      return TIMING_SOURCE_KIND.REAL_MUSICXML
    }
    if (runner === 'remote' && path.includes('score.musicxml')) {
      return TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML
    }
    return TIMING_SOURCE_KIND.REAL_MUSICXML
  }
  if (runner === 'remote') {
    return TIMING_SOURCE_KIND.MIDI_DERIVED_MUSICXML
  }
  if (runner === 'local') {
    return TIMING_SOURCE_KIND.REAL_MUSICXML
  }
  return TIMING_SOURCE_KIND.SYNTHETIC
}

/** Summarize MusicXML layout hints for benchmark diagnostics. */
export function describeLayoutHints(timingMap) {
  const measures = timingMap?.measures ?? []
  const pageBreaks = measures.filter((m) => m.pageBreakBefore).length
  const systemBreaks = measures.filter((m) => m.systemBreakBefore && m.number !== 1).length
  const engravedWidths = measures.filter((m) => Number.isFinite(m.engravedWidth)).length
  return {
    pageBreaks,
    systemBreaks,
    engravedWidths,
    hasPageBreaks: pageBreaks > 0,
    hasSystemBreaks: systemBreaks > 0,
    hasEngravedWidths: engravedWidths > 0,
    hasLayoutHints: pageBreaks > 0 || systemBreaks > 0 || engravedWidths > 0,
  }
}
