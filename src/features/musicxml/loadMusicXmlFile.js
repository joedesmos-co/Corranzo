import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

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

  const xmlEntries = Object.keys(zip.files).filter(
    (path) =>
      path.toLowerCase().endsWith('.xml') &&
      !path.startsWith('__MACOSX') &&
      !/META-INF\/container\.xml/i.test(path),
  )

  if (xmlEntries.length === 0) {
    throw new Error('MXL archive does not contain a MusicXML file.')
  }

  return xmlEntries[0]
}

async function readMxlXml(file) {
  let zip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
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
  if (isMxlFile(file)) {
    return readMxlXml(file)
  }
  if (isXmlFile(file)) {
    return file.text()
  }
  throw new Error('Unsupported file type. Upload .musicxml, .xml, or .mxl.')
}
