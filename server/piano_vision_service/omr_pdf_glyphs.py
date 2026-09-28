"""PDF source glyph bridge and the production vector object admission filters.

The whitelists/quorum, allocation padding, glyph-key dedupe and rest exclusion
are from processVectorOmrPage.js, vectorGlyphMeasureBounds.js,
vectorOrphanNoteheads.js and detectVectorRests.js. Embedded CFF glyph names are
read from the PDF to bridge Feta's per-document encoding to those whitelists;
no character frequency or expected score counts are used for that bridge.
"""
import io
from collections import Counter

from .omr_notehead_detection import (
    NoteheadCandidate, RestCandidate, js_round, _resolve_pitch_from_grand_staff,
    _estimate_ledger_line_count,
)

NOTEHEAD_GLYPHS = {'\ue0a2','\ue0a3','\ue0a4'}
REST_GLYPHS = {'\ue4e3','\ue4e4','\ue4e5','\ue4e6','\ue4e7'}
LEGACY_GLYPHS = dict(zip(('\ue12b','\ue12c','\ue12d','\ue107','\ue109','\ue10a'),
                       ('\ue0a2','\ue0a3','\ue0a4','\ue4e5','\ue4e6','\ue4e7')))
# Feta's named outlines carry source object identity even when PDF Unicode is
# U+FFFD. They are aliases for the same notehead/rest families admitted by JS.
CFF_GLYPHS = dict(zip(('noteheads.s0','noteheads.s1','noteheads.s2',
                      'rests.0','rests.1','rests.2','rests.3','rests.4'),
                     ('\ue0a2','\ue0a3','\ue0a4','\ue4e3','\ue4e4','\ue4e5','\ue4e6','\ue4e7')))


def extract_pdf_glyphs(page, width, height):
    """Read actual font outlines; unknown fonts remain eligible for raster OMR."""
    from fontTools.cffLib import CFFFontSet
    from fontTools.pens.boundsPen import BoundsPen
    fonts={}
    for resource in page.get_fonts(full=True):
        if resource[1] != 'cff':
            continue
        name,_,_,data=page.parent.extract_font(resource[0])
        try:
            cff=CFFFontSet(); cff.decompile(io.BytesIO(data),None)
            top=cff[cff.fontNames[0]]
            mapped={}
            for gid,glyph_name in enumerate(top.charset):
                canonical=CFF_GLYPHS.get(glyph_name)
                if canonical is None:
                    continue
                pen=BoundsPen(None)
                top.CharStrings[glyph_name].draw(pen)
                if pen.bounds is not None:
                    mapped[gid]=(canonical,pen.bounds,top.FontMatrix[0],top.CharStrings[glyph_name].width)
            fonts[name.split('+')[-1]]=mapped
        except (ValueError,KeyError,IndexError):
            continue
    sx,sy=width/page.rect.width,height/page.rect.height
    traces=page.get_texttrace()
    legacy_counts=Counter(t['font'] for t in traces for ch in t['chars'] if chr(ch[0]) in LEGACY_GLYPHS and chr(ch[0]) in {'\ue12b','\ue12c','\ue12d'})
    glyphs=[]
    for t in traces:
        mapping=fonts.get(t['font'].split('+')[-1],{})
        for unicode,gid,origin,bbox in t['chars']:
            text=chr(unicode)
            mapped=mapping.get(gid)
            if mapped is not None:
                text,bounds,matrix,advance=mapped
                x0,y0,x1,y1=bounds
                factor=t['size']*matrix
                visual=(origin[0]+x0*factor,origin[1]-y1*factor,
                        origin[0]+x1*factor,origin[1]-y0*factor)
                x=(origin[0]+advance*factor/2)*sx
                y=origin[1]*sy
            else:
                if legacy_counts[t['font']]>=12:
                    text=LEGACY_GLYPHS.get(text,text)
                if text not in NOTEHEAD_GLYPHS|REST_GLYPHS:
                    continue
                visual=bbox
                x=(bbox[0]+bbox[2])/2*sx
                y=origin[1]*sy
            glyphs.append(dict(text=text,x=x,y=y,
                bbox=dict(x0=visual[0]/page.rect.width,y0=visual[1]/page.rect.height,
                          x1=visual[2]/page.rect.width,y1=visual[3]/page.rect.height),
                font=t['font']))
    return glyphs


def has_vector_noteheads(glyphs):
    return sum(g['text'] in NOTEHEAD_GLYPHS for g in glyphs)>=12


def vector_objects_for_measure(glyphs,image_data,box,all_boxes):
    width,height=image_data['width'],image_data['height']
    gap=max(((max(lines)-min(lines))/4 for role in ('treble','bass')
             if (lines:=box.get('staffLines',{}).get(role,[]))),default=0)
    pad=max(.035,gap*8)
    system_index=box.get('systemIndex',0)
    last=not any(b.get('systemIndex',0)==system_index and b['x0']>box['x0'] for b in all_boxes)
    def distance(b,y):
        return min((abs(y-line) for role in ('treble','bass') for line in b['staffLines'].get(role,[])),default=float('inf'))
    def owned(g,rest=False):
        x,y=g['x']/width,g['y']/height
        ypad=.025 if rest else pad
        if not (box['x0']<=x<=box['x1']+(0 if rest or not last else .028) and box['y0']-ypad<=y<=box['y1']+ypad):
            return False
        # vectorGlyphInMeasure: adjacent system wins when its staff is nearer.
        if any(b.get('systemIndex',0)!=system_index and distance(b,y)<distance(box,y) for b in all_boxes):
            return False
        return True
    notes=[]; consumed=set()
    left=box.get('playableX0',box['x0'])*width
    for g in glyphs:
        if g['text'] not in NOTEHEAD_GLYPHS or not owned(g): continue
        key=(g['text'],js_round(g['x']/4),js_round(g['y']/4))
        if key in consumed: continue
        consumed.add(key)
        x,y=g['x']/width,g['y']/height
        mapping=_resolve_pitch_from_grand_staff(y,box.get('staffLines'),box.get('staffClefs'))
        if mapping['midi'] is None: continue
        notes.append(NoteheadCandidate(mapping['midi'],mapping['clef'],js_round(g['x']),js_round(g['y']),
            x,y,_estimate_ledger_line_count(y,mapping['lineYs']),mapping,
            (g['x']-left)/max(1,box['x1']*width-left),box['measureNumber'],box.get('page',1),
            dict(source='vector-glyph',glyph=g['text'],font=g['font']),source_bbox=g['bbox']))
    rests=[]
    for g in glyphs:
        if g['text'] not in REST_GLYPHS or not owned(g,True): continue
        def near(n):
            dx,dy=g['x']-n.cx,abs(g['y']-n.cy)
            if dy>10: return False
            if g['text']=='\ue4e7' and -16<=dx<-2: return abs(dx)<=3.5 and dy<=3.5
            return abs(dx)<=10
        if any(near(n) for n in notes): continue
        if any(abs(r.cx-g['x'])<=8 and abs(r.cy-g['y'])<=8 for r in rests): continue
        rests.append(RestCandidate(js_round(g['x']),js_round(g['y']),g['x']/width,g['y']/height,
            max(0,(g['x']-left)/max(1,box['x1']*width-left)),box['measureNumber'],box.get('page',1),.88,
            source_bbox=g['bbox']))
    return sorted(notes,key=lambda n:(n.cx,n.cy)),sorted(rests,key=lambda r:(r.cx,r.cy))
