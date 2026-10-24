import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
import { extractFromData, toMusicXML } from './pdfjs_vector_core.mjs'

const pdfPath = process.argv[2]
const outXml = process.argv[3]
const data = new Uint8Array(fs.readFileSync(pdfPath))
extractFromData(pdfjs, data, 1).then((ir) => {
  if (outXml) fs.writeFileSync(outXml, toMusicXML(ir))
  console.log(JSON.stringify(ir))
}).catch((e) => { console.error(e); process.exit(1) })
