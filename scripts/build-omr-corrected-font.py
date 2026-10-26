import importlib.util, sys
from pathlib import Path
from fontTools.pens.ttGlyphPen import TTGlyphPen
root=Path('/Users/ryland/Documents/scoreflow-piano-unblock')
spec=importlib.util.spec_from_file_location('bf', root/'scripts/build-omr-benchmark-font.py')
bf=importlib.util.module_from_spec(spec); spec.loader.exec_module(bf)
def polygon(points):
    pen=TTGlyphPen(None); pen.moveTo(points[0])
    for p in points[1:]: pen.lineTo(p)
    pen.closePath(); return pen.glyph()
orig_glyphs=bf.glyphs
def glyphs():
    g=orig_glyphs()
    # Original geometric quarter rest (distinct from eighth/16th shapes).
    g['restQuarter']=polygon([(300,0),(470,220),(260,360),(430,560),(280,700),(380,700),(540,470),(370,310),(540,110),(400,0)])
    return g
bf.glyphs=glyphs
bf.CHARACTERS[0xE4E5]='restQuarter'
out=root/'benchmarks/omr-fixtures-corrected/font/CorranzoBenchmarkMusic.ttf'
bf.build_font(out)
print('wrote',out)
