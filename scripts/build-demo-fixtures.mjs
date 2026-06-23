/**
 * Builds public-domain demo fixtures (Minuet in G, BWV Anh. 114) for dev demos.
 * Run: npm run fixtures
 *
 * Sources (Mutopia Project, public domain):
 * https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=75
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'fixtures')
const venvPython = join(root, '.venv-fixtures', 'bin', 'python3')

const MUTOPIA_BASE =
  'https://www.mutopiaproject.org/ftp/BachJS/BWVAnh114/anna-magdalena-04'

const OUT = {
  pdf: 'demo-minuet-in-g.pdf',
  midi: 'demo-minuet-in-g.mid',
  musicXml: 'demo-minuet-in-g.musicxml',
}

async function fetchBuffer(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function patchMusicXmlMetadata(xml) {
  let patched = xml
  patched = patched.replace(
    /<work-title>[^<]*<\/work-title>/,
    '<work-title>Minuet in G (Demo)</work-title>',
  )
  if (!patched.includes('<work-title>')) {
    patched = patched.replace(
      '<score-partwise',
      '<score-partwise><work><work-title>Minuet in G (Demo)</work-title></work>',
    )
  }
  patched = patched.replace(
    /<creator[^>]*>music21[^<]*<\/creator>/,
    '<creator type="software">Corranzo demo fixture</creator>',
  )
  patched = patched.replace(/<part-name>one:<\/part-name>/, '<part-name>Piano (treble)</part-name>')
  patched = patched.replace(/<part-name>two:<\/part-name>/, '<part-name>Piano (bass)</part-name>')
  return patched
}

function ensureMusicXmlFromMidi(midiPath, xmlPath) {
  if (!existsSync(venvPython)) {
    console.error(
      'Missing .venv-fixtures — run: python3 -m venv .venv-fixtures && .venv-fixtures/bin/pip install music21',
    )
    process.exit(1)
  }
  const script = `
from music21 import converter
s = converter.parse(${JSON.stringify(midiPath)})
s.write('musicxml', ${JSON.stringify(xmlPath)})
`
  const result = spawnSync(venvPython, ['-c', script], { encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })

  console.log('Downloading Mutopia PDF and MIDI…')
  const [pdfBuf, midiBuf] = await Promise.all([
    fetchBuffer(`${MUTOPIA_BASE}/anna-magdalena-04-a4.pdf`),
    fetchBuffer(`${MUTOPIA_BASE}/anna-magdalena-04.mid`),
  ])

  const midiPath = join(outDir, OUT.midi)
  const xmlPath = join(outDir, OUT.musicXml)
  const pdfPath = join(outDir, OUT.pdf)

  writeFileSync(midiPath, midiBuf)
  writeFileSync(pdfPath, pdfBuf)

  console.log('Generating MusicXML from MIDI (music21)…')
  ensureMusicXmlFromMidi(midiPath, xmlPath)
  const xml = patchMusicXmlMetadata(readFileSync(xmlPath, 'utf8'))
  writeFileSync(xmlPath, xml)

  console.log('Generating bundled score-follow anchors…')
  const anchorResult = spawnSync('node', ['scripts/generate-demo-anchors.mjs'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (anchorResult.status !== 0) {
    process.exit(anchorResult.status ?? 1)
  }

  writeFileSync(
    join(outDir, 'README.md'),
    `# Corranzo demo fixtures

Public-domain **Minuet in G** (BWV Anh. 114, Notebook for Anna Magdalena Bach; often attributed to Christian Petzold).

Regenerate with:

\`\`\`bash
npm run fixtures
\`\`\`

Requires a one-time Python venv:

\`\`\`bash
python3 -m venv .venv-fixtures
.venv-fixtures/bin/pip install music21
\`\`\`

## Files

| File | Role |
|------|------|
| \`${OUT.pdf}\` | Sheet music (Mutopia PDF) |
| \`${OUT.musicXml}\` | Score timing — treble + bass parts |
| \`${OUT.midi}\` | Optional playback (Mutopia MIDI) |
| \`demo-minuet-in-g.anchors.json\` | Pre-aligned score-follow (demo only) |

## License

Mutopia Project — [public domain](https://www.mutopiaproject.org/legal.html#publicdomain).
`,
    'utf8',
  )

  const pdfKb = Math.round(pdfBuf.length / 1024)
  const midiKb = Math.round(midiBuf.length / 1024)
  const xmlKb = Math.round(readFileSync(xmlPath).length / 1024)
  console.log(`Wrote demo fixtures (${pdfKb} KB PDF, ${xmlKb} KB MusicXML, ${midiKb} KB MIDI)`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
