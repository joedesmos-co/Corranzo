#!/usr/bin/env python3
"""Write public/fixtures/ sample files for local smoke testing."""
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)

DIV = "        <divisions>1</divisions>\n"

MUSIC_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work>
    <work-title>Corranzo Sample</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Sample</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
{DIV}        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>120</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""

PDF = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 55>>stream
BT /F1 16 Tf 24 120 Td (Corranzo Sample) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000109 00000 n 
0000000242 00000 n 
0000000346 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
414
%%EOF"""


def write_var_len(value: int) -> bytes:
    buffer = value & 0x7F
    out = []
    while True:
        out.insert(0, buffer)
        value >>= 7
        if value == 0:
            break
        buffer = (value & 0x7F) | 0x80
    return bytes(out)


def build_midi() -> bytes:
    events = [(0, bytes([0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20]))]
    for i, note in enumerate([60, 62, 64, 65, 67, 69, 71, 72]):
        delta = 0 if i == 0 else 240
        events.append((delta, bytes([0x90, note, 0x64])))
        events.append((240, bytes([0x80, note, 0x00])))
    events.append((0, bytes([0xFF, 0x2F, 0x00])))
    track_data = b"".join(write_var_len(delta) + msg for delta, msg in events)
    mtrk = b"MTrk" + struct.pack(">I", len(track_data)) + track_data
    mthd = b"MThd" + struct.pack(">I", 6) + struct.pack(">HHH", 0, 1, 480)
    return mthd + mtrk


def main() -> None:
    (OUT / "sample.musicxml").write_text(MUSIC_XML, encoding="utf-8")
    (OUT / "sample.pdf").write_bytes(PDF)
    (OUT / "sample.mid").write_bytes(build_midi())
    (OUT / "README.md").write_text(
        """# Corranzo dev fixtures

Tiny sample files for local smoke testing. Regenerate with:

```bash
npm run fixtures
```

- `sample.pdf` — one-page placeholder score
- `sample.mid` — 8-note C-major fragment at 120 BPM
- `sample.musicxml` — 2 measures (8 quarter notes) for timing / Wait For You
""",
        encoding="utf-8",
    )
    print("Wrote fixtures to public/fixtures/")


if __name__ == "__main__":
    main()
