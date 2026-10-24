import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const file = process.argv[2];
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const tc = await page.getTextContent();
const out = [];
for (const it of tc.items) {
  if (!it.str) continue;
  const code = it.str.codePointAt(0);
  if (code >= 0xE0A0 && code <= 0xE0FF) {
    const tr = pdfjs.Util.transform(vp.transform, it.transform);
    out.push({ code, x: +tr[4].toFixed(1), y: +tr[5].toFixed(1),
               w: +it.width.toFixed(1), h: +it.height.toFixed(1) });
  }
}
console.log(JSON.stringify({ count: out.length, first: out }, null, 1));
