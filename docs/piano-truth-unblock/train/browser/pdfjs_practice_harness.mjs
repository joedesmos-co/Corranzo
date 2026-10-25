import * as pdfjs from '/pdfjs/build/pdf.mjs';
import { extractFromData, toMusicXML, assessPianoVectorIr } from '/pianoVectorCore_candidate.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';
const params = new URLSearchParams(location.search);
const pdfUrl = params.get('pdf') || '/test.pdf';
try {
  const data = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer());
  const ir = await extractFromData(pdfjs, data, 1);
  const xml = toMusicXML(ir);
  const gate = assessPianoVectorIr(ir);
  const result = { version: pdfjs.version, notes: ir.notes.length, rests: ir.rests.length,
    meter: ir.meter, key: ir.key, restReconciled: ir.restReconciled,
    gate: { practiceReady: gate.practiceReady, issues: gate.issues, badMeasures: gate.badMeasures },
    xmlLength: xml.length, xmlHead: xml.slice(0, 160) };
  window.__result = result;
  document.getElementById('out').textContent = JSON.stringify(result, null, 1);
} catch (e) {
  window.__result = { error: String(e && e.stack || e) };
  document.getElementById('out').textContent = window.__result.error;
}
