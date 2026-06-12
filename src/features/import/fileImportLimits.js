const MB = 1024 * 1024

export const FILE_IMPORT_LIMITS = {
  pdf: {
    label: 'PDF',
    softMaxBytes: 25 * MB,
    hardMaxBytes: 80 * MB,
    acceptMime: ['application/pdf'],
    acceptExtensions: ['.pdf'],
  },
  midi: {
    label: 'MIDI',
    softMaxBytes: 15 * MB,
    hardMaxBytes: 50 * MB,
    acceptMime: ['audio/midi', 'audio/mid'],
    acceptExtensions: ['.mid', '.midi'],
  },
  musicXml: {
    label: 'MusicXML',
    softMaxBytes: 10 * MB,
    hardMaxBytes: 30 * MB,
    acceptMime: [
      'application/vnd.recordare.musicxml+xml',
      'application/xml',
      'text/xml',
    ],
    acceptExtensions: ['.musicxml', '.xml', '.mxl', '.mscz', '.mscx'],
  },
}

function matchesExtension(fileName, extensions) {
  const lower = fileName.toLowerCase()
  return extensions.some((ext) => lower.endsWith(ext))
}

export function isAcceptedFileType(file, kind) {
  const limits = FILE_IMPORT_LIMITS[kind]
  if (!file) {
    return false
  }
  if (limits.acceptMime.includes(file.type)) {
    return true
  }
  return matchesExtension(file.name, limits.acceptExtensions)
}

function formatMegabytes(bytes) {
  return `${(bytes / MB).toFixed(1)} MB`
}

export function validateFileForImport(file, kind) {
  const limits = FILE_IMPORT_LIMITS[kind]

  if (!file) {
    return { ok: false, message: `Choose a ${limits.label} file to upload.` }
  }

  if (!isAcceptedFileType(file, kind)) {
    const hint =
      kind === 'pdf'
        ? 'Please choose a PDF file (.pdf).'
        : kind === 'midi'
          ? 'Please choose a MIDI file (.mid or .midi).'
          : 'Please choose MusicXML (.musicxml, .xml, .mxl) or MuseScore source (.mscz, .mscx — export MusicXML/MXL for now).'
    return { ok: false, message: hint }
  }

  if (file.size > limits.hardMaxBytes) {
    return {
      ok: false,
      message: `This ${limits.label} is ${formatMegabytes(file.size)} — the limit is ${formatMegabytes(limits.hardMaxBytes)}. Try exporting a smaller file from your notation app.`,
    }
  }

  const softWarning =
    file.size > limits.softMaxBytes
      ? `Large ${limits.label} (${formatMegabytes(file.size)}). Loading may take a moment on slower devices.`
      : null

  return { ok: true, softWarning }
}

export async function readFileArrayBuffer(file, kind) {
  const validation = validateFileForImport(file, kind)
  if (!validation.ok) {
    throw new Error(validation.message)
  }
  return file.arrayBuffer()
}
