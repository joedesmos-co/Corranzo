import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

/** Local-file header signature; the archive's own container.xml is the source
 *  of truth for the root member once this matches. */
function startsWithZipMagic(bytes) {
  return Boolean(bytes) && bytes.byteLength >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/**
 * True when the file's BYTES are a compressed MusicXML archive. Content, not
 * extension: a compressor/decompressor may legitimately leave a `.mxl` name
 * on uncompressed XML, and the engraver gets the same plain-XML payload
 * either way.
 */
export async function isCompressedScoreFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer(), 0, Math.min(file.size, 4))
    return startsWithZipMagic(bytes)
  } catch {
    return false
  }
}

function isMxlFile(file) {
  const name = file.name.toLowerCase()
  return name.endsWith('.mxl') || file.type === 'application/vnd.recordare.musicxml+xml'
}

function isXmlFile(file) {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.musicxml') ||
    name.endsWith('.xml') ||
    file.type === 'application/vnd.recordare.musicxml+xml' ||
    file.type === 'application/xml' ||
    file.type === 'text/xml'
  )
}

async function resolveMxlRootPath(zip) {
  const containerFile = zip.file('META-INF/container.xml')
  if (containerFile) {
    const containerXml = await containerFile.async('string')
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    })
    const container = parser.parse(containerXml)
    const rootfiles = container?.container?.rootfiles?.rootfile
    const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles
    const fullPath = rootfile?.['@_full-path']
    if (fullPath && zip.file(fullPath)) {
      return fullPath
    }
  }

  // `endsWith('.xml')` is not enough: the canonical extension is `.musicxml`,
  // whose last four characters are "cxml", so a container-less archive whose
  // root member is "score.musicxml" would otherwise look empty.
  const xmlEntries = Object.keys(zip.files).filter(
    (path) => {
      const lower = path.toLowerCase()
      return (
        (lower.endsWith('.xml') || lower.endsWith('.musicxml')) &&
        !path.startsWith('__MACOSX') &&
        !/META-INF\/container\.xml/i.test(path)
      )
    },
  )

  if (xmlEntries.length === 0) {
    throw new Error('MXL archive does not contain a MusicXML file.')
  }

  return xmlEntries[0]
}

async function readMxlXml(file, bytes = null) {
  let zip
  try {
    zip = await JSZip.loadAsync(bytes ?? (await file.arrayBuffer()))
  } catch (zipError) {
    const message =
      zipError instanceof Error ? zipError.message.toLowerCase() : ''
    if (
      message.includes('corrupt') ||
      message.includes('invalid zip') ||
      message.includes("can't find end") ||
      message.includes('end of central directory')
    ) {
      throw new Error(
        'MXL_ZIP_DAMAGED: This compressed score file could not be opened. Try exporting uncompressed MusicXML (.musicxml) from your notation app.',
      )
    }
    throw new Error(
      `MXL_ZIP_READ_FAILED: ${zipError instanceof Error ? zipError.message : 'Could not read MXL archive.'}`,
    )
  }

  const rootPath = await resolveMxlRootPath(zip)
  const entry = zip.file(rootPath)
  if (!entry) {
    throw new Error(
      'MXL_NO_ENTRY: The MusicXML inside this MXL file could not be read. Re-export from your notation app.',
    )
  }

  try {
    return await entry.async('string')
  } catch (readError) {
    throw new Error(
      `MXL_XML_READ_FAILED: ${readError instanceof Error ? readError.message : 'Could not read MusicXML from MXL.'}`,
    )
  }
}

export function isMusicXmlFile(file) {
  return isMxlFile(file) || isXmlFile(file)
}

export async function loadMusicXmlFile(file) {
  if (await isCompressedScoreFile(file)) {
    return readMxlXml(file)
  }
  if (isXmlFile(file) || isMxlFile(file)) {
    return file.text()
  }
  throw new Error('Unsupported file type. Upload .musicxml, .xml, or .mxl.')
}
