"""Re-render a production PDF through the FACTORY raster convention.

Byte-for-byte the path the PDMX factory used to build the training pages:

    scripts/lib/renderPdfPages.mjs :: renderPdfToPages
        pdfjs-dist -> @napi-rs/canvas, analysisWidth = 1000 page px
        (white background fill, default canvas antialiasing)

Production uses PyMuPDF at 150 DPI instead. This lets the audit hold geometry,
objects and labels byte-identical while swapping ONLY the raster, which is the
arm the prior DIAGNOSIS never ran.
"""
import json
import subprocess
import sys
from pathlib import Path

NODE_SRC = r"""
import { renderPdfToPages } from 'process.env.RENDER_MODULE';
import { writeFileSync } from 'node:fs';
const [pdf, out] = process.argv.slice(2);
const pages = await renderPdfToPages(pdf, { rootDir: process.env.SCORE_FLOW_ROOT });
for (const p of pages) {
  const { createCanvas, loadCanvasImageData } = globalThis.__pvCanvas;
  const c = createCanvas(p.width, p.height);
  const ctx = c.getContext('2d');
  const img = new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
  ctx.putImageData(img, 0, 0);
  writeFileSync(out.replace('{n}', String(p.pageNumber)), c.toBuffer('image/png'));
}
process.stdout.write(String(pages.length));
"""

# The shared module already builds a canvas; we only need the image data out.
WRAPPER = r"""
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { renderPdfToPages } = await import(pathToFileURL(process.env.RENDER_MODULE).href);
const { createCanvas } = await import(pathToFileURL(process.env.CANVAS_MODULE).href);
const [pdf, out, countWanted] = process.argv.slice(2);
const rendered = await renderPdfToPages(pdf, { rootDir: process.env.SCORE_FLOW_ROOT });
const pages = rendered.pages;
let n = 0;
for (const p of pages) {
  if (n >= Number(countWanted || '9999')) break;
  const c = createCanvas(p.width, p.height);
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  writeFileSync(out.replace('{n}', String(p.pageNumber)), c.toBuffer('image/png'));
  n += 1;
}
process.stdout.write(String(pages.length));
"""


def render_factory_raster(pdf_path, out_dir, root, count=3):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    script = Path("/tmp/pv_factory_render.mjs")
    script.write_text(WRAPPER)
    env_prefix = {
        "RENDER_MODULE": str(Path(root) / "scripts/lib/renderPdfPages.mjs"),
        "CANVAS_MODULE": str(Path(root) / "node_modules/@napi-rs/canvas/index.js"),
        "SCORE_FLOW_ROOT": str(root),
    }
    import os
    env = dict(os.environ)
    env.update(env_prefix)
    res = subprocess.run(
        ["node", str(script), str(Path(pdf_path).resolve()),
         str((out_dir / "page-{n}.png").resolve()), str(count)],
        capture_output=True, text=True, env=env, cwd=str(root))
    if res.returncode != 0:
        raise RuntimeError(f"node render failed: {res.stderr[-2000:]}")
    return res.stdout.strip()


if __name__ == "__main__":
    print(render_factory_raster(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])))
