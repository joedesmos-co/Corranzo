import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { loadMusicXmlFile } from '../src/features/musicxml/loadMusicXmlFile.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Compressed Import Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

/** Build a real compressed .mxl the way MuseScore/Sibelius write one. */
async function buildMxl(innerName = 'score.musicxml') {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
      + `<rootfile full-path="${innerName}" media-type="application/vnd.recordare.musicxml+xml"/>`
      + '</rootfiles></container>',
  )
  zip.file(innerName, sampleXml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('MXL (compressed MusicXML) notation', () => {
  it('unzips a container-referenced rootfile into engraving-grade XML', async () => {
    const buffer = await buildMxl()
    const file = new File([buffer], 'study.mxl', {
      type: 'application/vnd.recordare.musicxml+xml',
    })
    const xml = await loadMusicXmlFile(file)
    // OSMD receives this string; it must be XML, never zip bytes.
    expect(xml).toContain('<score-partwise')
    expect(xml).not.toContain('PK')
    const timingMap = parseMusicXml(xml, 'study.mxl')
    expect(timingMap.title).toBe('Compressed Import Study')
    expect(timingMap.noteCount).toBe(2)
  })

  it('falls back to the first XML member when container.xml is absent', async () => {
    const zip = new JSZip()
    zip.file('score.musicxml', sampleXml)
    const file = new File([await zip.generateAsync({ type: 'nodebuffer' })], 'no-container.mxl')
    const xml = await loadMusicXmlFile(file)
    expect(xml).toContain('<score-partwise')
    expect(xml).toContain('Compressed Import Study')
  })

  it('reports a damaged archive instead of handing OSMD zip bytes', async () => {
    const truncated = Buffer.from('PK\u0003\u0004 truncated and incomplete')
    const file = new File([truncated], 'broken.mxl', {
      type: 'application/vnd.recordare.musicxml+xml',
    })
    await expect(loadMusicXmlFile(file)).rejects.toThrow()
  })
})
