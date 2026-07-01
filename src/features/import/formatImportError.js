/**
 * Turn thrown import/parse errors into short, musician-friendly messages.
 */
export function formatMusicXmlImportError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const lower = raw.toLowerCase()

  if (raw.startsWith('MUSESCORE_PLANNED:')) {
    return raw.replace(/^MUSESCORE_PLANNED:\s*/, '')
  }

  if (raw.startsWith('MXL_')) {
    return raw.replace(/^MXL_[A-Z_]+:\s*/, '')
  }

  if (lower.includes('mxl archive') || lower.includes('does not contain a musicxml')) {
    return 'This MXL file does not contain readable MusicXML. Try “Export MusicXML” (uncompressed) from your notation app, or re-save the MXL.'
  }

  if (
    lower.includes('end of central directory') ||
    lower.includes('corrupted') ||
    lower.includes('invalid zip') ||
    lower.includes("can't find end")
  ) {
    return 'This MXL file looks damaged or incomplete. Re-export it from your notation app, or upload an uncompressed .musicxml file instead.'
  }

  if (lower.includes('unsupported file type')) {
    return 'Unsupported timing file. Upload .musicxml, .xml, .mxl, or MuseScore source (.mscz, .mscx — export a timing file for now).'
  }

  if (lower.includes('score-timewise') || lower.includes('timewise')) {
    return 'Score-timewise MusicXML is not supported yet. In your notation app, export as “partwise” MusicXML instead.'
  }

  if (lower.includes('no parts') || lower.includes('part')) {
    return 'No instrument parts were found in this MusicXML file. Check the export settings in your notation app.'
  }

  if (lower.includes('unsupported') && lower.includes('root')) {
    return 'This file does not look like standard MusicXML. Export again as MusicXML 3.1 (partwise) from your notation app.'
  }

  if (lower.includes('xml') || lower.includes('parse')) {
    return 'Could not read this MusicXML file. The file may be damaged or use features Corranzo does not support yet.'
  }

  return raw || 'Could not load this timing file.'
}

export function formatMidiImportError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (!raw) {
    return 'Could not load this MIDI file.'
  }
  if (raw.toLowerCase().includes('midi')) {
    return raw
  }
  return `Could not load this MIDI file. ${raw}`
}

export function formatPdfImportError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw || 'Could not open this PDF.'
}
