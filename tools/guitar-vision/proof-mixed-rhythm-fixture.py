"""Generate a mixed-rhythm paired notation+TAB fixture (PDF + MusicXML).

4/4, 4 measures, chords, quarters/eighths/sixteenths, beamed groups.
SMuFL noteheads and time signature are real text glyphs (so the browser
text path sees them); stems/beams are vector strokes. The MusicXML is
generated from the same event model, so it is an independent reference.

Run:
  python3 tools/guitar-vision/proof-mixed-rhythm-fixture.py --out DIR
"""
import argparse
from pathlib import Path
import xml.etree.ElementTree as ET

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / 'benchmarks/omr-fixtures/font/CorranzoBenchmarkMusic.ttf'
PAGE_W, PAGE_H = 612.0, 792.0          # letter points
DPI = 150.0
PX = 72.0 / DPI                         # image px -> points
NOTE = chr(0xE0A4)                      # SMuFL noteheadBlack
TS4 = chr(0xE084)                       # SMuFL timeSig4
NOTE_H = chr(0xE0A2)                    # SMuFL noteheadHalf
TUNING = [64, 59, 55, 50, 45, 40]

# durations in quarters
Q, E, S, H = 1.0, 0.5, 0.25, 2.0
# (duration, [string,fret pairs]); sums must be 4.0 per measure
MEASURES = [
    [(Q, [(1, 0), (2, 1), (3, 0)]),
     (E, [(1, 3), (2, 3), (3, 2)]),
     (E, [(1, 3), (2, 3), (3, 2)]),
     (Q, [(2, 1), (3, 0)]),
     (Q, [(1, 0), (2, 1)])],
    [(E, [(1, 5), (2, 5), (3, 5)]),
     (E, [(1, 5), (2, 5), (3, 5)]),
     (E, [(1, 7), (2, 8)]),
     (E, [(1, 7), (2, 8)]),
     (H, [(1, 10), (2, 10), (3, 9), (4, 12)])],
    [(S, [(1, 12), (2, 12)]),
     (S, [(1, 12), (2, 12)]),
     (S, [(1, 12), (2, 12)]),
     (S, [(1, 12), (2, 12)]),
     (Q, [(1, 2), (2, 3), (3, 2)]),
     (H, [(1, 0), (2, 1), (3, 0), (4, 2), (5, 3)])],
    [(Q, [(1, 7), (2, 8), (3, 7)]),
     (E, [(1, 10), (2, 10)]),
     (E, [(1, 10), (2, 10)]),
     (Q, [(1, 2), (2, 3), (3, 2), (4, 4)]),
     (Q, [(1, 0), (2, 1), (3, 0), (4, 2), (5, 3), (6, 3)])],
]


def y(px):
    return PAGE_H - px * PX


def x(px):
    return px * PX


def draw(c):
    pdfmetrics.registerFont(TTFont('CorranzoMusic', str(FONT)))
    c.setTitle('CC0 Mixed Rhythm TAB Study')
    for si in range(2):
        ntop = 300 + si * 500
        ttop = 500 + si * 500
        # 5-line notation staff
        for k in range(5):
            c.setLineWidth(0.7)
            c.setStrokeGray(0.35)
            c.line(x(80), y(ntop + k * 16.8), x(1195), y(ntop + k * 16.8))
        # 6-line TAB staff
        for k in range(6):
            c.setLineWidth(0.8)
            c.setStrokeGray(0.28)
            c.line(x(80), y(ttop + k * 16.8), x(1195), y(ttop + k * 16.8))
        c.setFillGray(0.1)
        c.setFont('Helvetica-Bold', 6.5)
        c.drawString(x(95), y(ttop + 55), 'T')
        c.drawString(x(95), y(ttop + 38), 'A')
        c.drawString(x(95), y(ttop + 21), 'B')
        # time signature (SMuFL text)
        c.setFont('CorranzoMusic', 13.5)
        c.drawString(x(115), y(ntop + 12), TS4)
        c.drawString(x(115), y(ntop + 30), TS4)

        mw = (1120 - 80) / 2.0
        # barlines
        for b in range(3):
            c.setLineWidth(1.1)
            c.setStrokeGray(0.1)
            c.line(x(80 + b * mw), y(ntop), x(80 + b * mw), y(ttop + 5 * 16.8))
        for mi, events in enumerate(MEASURES[si * 2:si * 2 + 2]):
            base = 80 + mi * mw
            # onset positions by cumulative duration
            pos = 0.0
            onsets = []
            for dur, notes in events:
                # center the onset in its rhythmic slot
                px = base + (pos + dur / 2) * mw / 4.0
                onsets.append((px, dur, notes))
                pos += dur
            # notation: one notehead per onset, stems up; beams within
            # runs of duration < 1
            for i, (px, dur, notes) in enumerate(onsets):
                c.setFillGray(0.05)
                c.setFont('CorranzoMusic', 15.0)
                glyph = NOTE_H if dur >= 2 else NOTE
                c.drawCentredString(x(px), y(ntop + 2 * 16.8 + 9), glyph)
                stem_x = px + 7
                c.setLineWidth(1.0)
                c.setStrokeGray(0.05)
                c.line(x(stem_x), y(ntop + 2 * 16.8 + 5),
                       x(stem_x), y(ntop + 2 * 16.8 - 36))
            # beams: contiguous runs of sub-quarter values
            i = 0
            while i < len(onsets):
                if onsets[i][1] >= 1:
                    i += 1
                    continue
                j = i
                while j + 1 < len(onsets) and onsets[j + 1][1] < 1 and \
                        abs(onsets[j + 1][1] - onsets[i][1]) < 1e-9:
                    j += 1
                if j > i:
                    levels = 2 if onsets[i][1] <= 0.25 else 1
                    x0 = onsets[i][0] + 7
                    x1 = onsets[j][0] + 7
                    for lev in range(levels):
                        yy = ntop + 2 * 16.8 - 33 - lev * 9
                        c.setLineWidth(2.0)
                        c.setStrokeGray(0.05)
                        c.line(x(x0), y(yy), x(x1), y(yy))
                i = j + 1
            # TAB digits centered at the onset
            c.setFont('Helvetica', 8.0)
            c.setFillGray(0.05)
            for px, dur, notes in onsets:
                for s, f in notes:
                    txt = str(f)
                    tw = pdfmetrics.stringWidth(txt, 'Helvetica', 8.0)
                    c.drawString(x(px) - tw / 2,
                                 y(ttop + (s - 1) * 16.8 + 3), txt)


def musicxml():
    root = ET.Element('score-partwise', version='4.0')
    pl = ET.SubElement(root, 'part-list')
    sp = ET.SubElement(pl, 'score-part', id='P1')
    ET.SubElement(sp, 'part-name').text = 'Guitar'
    part = ET.SubElement(root, 'part', id='P1')
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    for mi, events in enumerate(MEASURES):
        m = ET.SubElement(part, 'measure', number=str(mi + 1))
        attrs = ET.SubElement(m, 'attributes')
        ET.SubElement(attrs, 'divisions').text = '12'
        if mi == 0:
            key = ET.SubElement(attrs, 'key')
            ET.SubElement(key, 'fifths').text = '0'
            t = ET.SubElement(attrs, 'time')
            ET.SubElement(t, 'beats').text = '4'
            ET.SubElement(t, 'beat-type').text = '4'
            clef = ET.SubElement(attrs, 'clef')
            ET.SubElement(clef, 'sign').text = 'TAB'
            ET.SubElement(clef, 'line').text = '5'
            sd = ET.SubElement(attrs, 'staff-details')
            ET.SubElement(sd, 'staff-lines').text = '6'
        for dur, notes in events:
            for k, (s, f) in enumerate(notes):
                n = ET.SubElement(m, 'note')
                if k:
                    ET.SubElement(n, 'chord')
                pitch = ET.SubElement(n, 'pitch')
                midi = TUNING[s - 1] + f
                name = names[midi % 12]
                ET.SubElement(pitch, 'step').text = name[0]
                if '#' in name:
                    ET.SubElement(pitch, 'alter').text = '1'
                ET.SubElement(pitch, 'octave').text = str(midi // 12 - 1)
                ET.SubElement(n, 'duration').text = str(int(dur * 12))
                ET.SubElement(n, 'voice').text = '1'
                typ = {4.0: 'whole', 2.0: 'half', 1.0: 'quarter',
                       0.5: 'eighth', 0.25: '16th'}[dur]
                ET.SubElement(n, 'type').text = typ
                tech = ET.SubElement(n, 'notations')
                te = ET.SubElement(tech, 'technical')
                ET.SubElement(te, 'string').text = str(s)
                ET.SubElement(te, 'fret').text = str(f)
    return root


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='/tmp/proof/mixed-rhythm')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pdf = out / 'mixed-rhythm.pdf'
    c = canvas.Canvas(str(pdf), pagesize=(PAGE_W, PAGE_H))
    draw(c)
    c.save()
    ET.ElementTree(musicxml()).write(out / 'mixed-rhythm.musicxml',
                                     encoding='utf-8', xml_declaration=True)
    print(pdf)
    print(out / 'mixed-rhythm.musicxml')


if __name__ == '__main__':
    main()
