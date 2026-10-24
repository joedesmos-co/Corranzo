import * as pdfjs from '/pdfjs/build/pdf.mjs';
import { extractFromData, toMusicXML } from '/pdfjs_vector_core.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';
const params = new URLSearchParams(location.search);
const pdfUrl = params.get('pdf') || '/test.pdf';
try {
  const data = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer());
  const ir = await extractFromData(pdfjs, data, 1);
  const xml = toMusicXML(ir);
  const result = { version: pdfjs.version, notes: ir.notes.length,
    rests: ir.rests.length, systems: ir.systems, meter: ir.meter,
    route: ir.route, xmlLength: xml.length, xmlHead: xml.slice(0, 120) };
  window.__result = result;
  document.getElementById('out').textContent = JSON.stringify(result, null, 1);
} catch (e) {
  window.__result = { error: String(e && e.stack || e) };
  document.getElementById('out').textContent = window.__result.error;
}
