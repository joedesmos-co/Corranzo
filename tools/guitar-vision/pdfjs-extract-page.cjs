// pdfjs-dist page extractor: text items + raster.
//
// Apache-2.0 only (pdfjs-dist). Not AGPL: this is the production text
// path for scoreflow-guitar.
//
// argv: <pdf> <png> <dpi> <page-1based> [modulesDir]
//   modulesDir  optional node_modules directory that contains
//               pdfjs-dist and @napi-rs/canvas. When omitted, normal
//               Node resolution applies (NODE_PATH / cwd / parent dirs).
//
// Writes <png> and <png>.json = { pageSize, dpi, items: [...] }.
const fs = require('fs');
const path = require('path');

const [pdfPath, pngPath, dpiArg, pageArg, modulesDir] = process.argv.slice(2);

function load(id) {
  if (modulesDir) {
    return require(path.join(modulesDir, id));
  }
  return require(id);
}

const { getDocument } = load('pdfjs-dist/legacy/build/pdf.mjs');

async function main() {
  const D = Number(dpiArg) || 150;
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const page = await doc.getPage(Number(pageArg || 1));
  const scale = D / 72;
  const viewport = page.getViewport({ scale });

  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    const t = (it.str || '').trim();
    if (!t) continue;
    const m = it.transform;
    const x0 = m[4] * scale;
    const y0 = viewport.height - (m[5] + (it.height || 0)) * scale;
    const x1 = x0 + (it.width || 0) * scale;
    const y1 = y0 + (it.height || 0) * scale;
    items.push({
      text: t,
      font: it.fontName || '',
      size: Math.round((it.height || 0) * scale * 10) / 10,
      bbox: [
        Math.round(x0 * 10) / 10,
        Math.round(y0 * 10) / 10,
        Math.round(x1 * 10) / 10,
        Math.round(y1 * 10) / 10,
      ],
    });
  }

  const { createCanvas } = load('@napi-rs/canvas');
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  fs.writeFileSync(
    pngPath + '.json',
    JSON.stringify({ pageSize: [viewport.width, viewport.height], dpi: D, items }, null, 1)
  );
  console.log(JSON.stringify({ ok: true, nitems: items.length, size: [viewport.width, viewport.height] }));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
