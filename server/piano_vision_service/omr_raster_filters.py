"""Production JS raster morphology and stem ownership, without rhythm inference.

Sources: detectRasterNoteheadInstances.js, detectNoteRhythmFeatures.js and
assembleOmrMeasureRhythm.js under src/features/omr. Thresholds match those files.
"""
from dataclasses import replace
import math
import numpy as np

from .omr_notehead_detection import (
    NoteheadCandidate, content_pixel_bounds, ink_mask, js_round, staff_space_px,
    detect_noteheads_in_measure, _resolve_pitch_from_grand_staff,
    _estimate_ledger_line_count,
)


def build_ink_runs(image_data, bounds, threshold):
    ink = ink_mask(image_data, threshold)[bounds['top']:bounds['bottom']+1,
                                          bounds['left']:bounds['right']+1]
    horizontal = np.zeros(ink.shape, dtype=np.int32)
    vertical = np.zeros(ink.shape, dtype=np.int32)
    for rows, dest in ((ink, horizontal), (ink.T, vertical.T)):
        for i, row in enumerate(rows):
            edges = np.diff(np.r_[False, row, False].astype(np.int8))
            for start, end in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
                dest[i, start:end] = end-start
    return ink, horizontal, vertical


def core_components(runs, bounds, staff_space):
    ink, horizontal, vertical = runs
    core = (ink & (horizontal >= max(4, js_round(staff_space*.34))) &
            (horizontal <= max(18, js_round(staff_space*2.6))) &
            (vertical >= max(2, js_round(staff_space*.16))))
    seen = np.zeros(core.shape, dtype=bool)
    height, width = core.shape
    components = []
    for seed_y, seed_x in zip(*np.nonzero(core)):
        if seen[seed_y, seed_x]:
            continue
        queue = [(int(seed_x), int(seed_y))]
        seen[seed_y, seed_x] = True
        for x, y in queue:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x+dx, y+dy
                    if (dx or dy) and 0 <= nx < width and 0 <= ny < height and core[ny,nx] and not seen[ny,nx]:
                        seen[ny,nx] = True
                        queue.append((nx,ny))
        count = len(queue)
        if count < max(5, js_round(staff_space*.3)):
            continue
        xs, ys = zip(*queue)
        components.append(dict(cx=bounds['left']+sum(xs)/count,
                               cy=bounds['top']+sum(ys)/count,
                               width=max(xs)-min(xs)+1, height=max(ys)-min(ys)+1,
                               count=count))
    return components


def components_to_instances(components, ss):
    sized = [c for c in components if ss*.42 <= c['width'] <= ss*1.38]
    full = [dict(cx=c['cx'], cy=c['cy'], componentCount=1,
                 morphologyKind='compact-core', corePixelCount=c['count'])
            for c in sized if ss*.42 <= c['height'] <= ss*.9]
    lobes = sorted([c for c in sized if 2 <= c['height'] < ss*.42],
                   key=lambda c: (c['cy'],c['cx']))
    used, paired = set(), []
    for i, upper in enumerate(lobes):
        if i in used:
            continue
        best = None
        for j in range(i+1,len(lobes)):
            if j in used:
                continue
            lower = lobes[j]
            dy, dx = lower['cy']-upper['cy'], abs(lower['cx']-upper['cx'])
            if dy > ss*.5:
                break
            if dy >= ss*.18 and dx <= ss*.3:
                score = dy+dx*.5
                if best is None or score < best[0]:
                    best = (score,j,lower)
        if best is None:
            continue
        _,j,lower = best
        used.update((i,j))
        total = upper['count']+lower['count']
        paired.append(dict(cx=(upper['cx']*upper['count']+lower['cx']*lower['count'])/total,
                           cy=(upper['cy']*upper['count']+lower['cy']*lower['count'])/total,
                           componentCount=2, morphologyKind='staff-line-split-core', corePixelCount=total))
    kept = []
    for c in sorted(full+paired, key=lambda c: (-c['componentCount'],-c['corePixelCount'])):
        if not any(abs(e['cx']-c['cx']) <= ss*.28 and abs(e['cy']-c['cy']) <= ss*.28 for e in kept):
            kept.append(c)
    return sorted(kept,key=lambda c:(c['cx'],c['cy']))


def detect_raster_notehead_instances(image_data, box, threshold=170):
    ss = staff_space_px(box, image_data['height'])
    margin = ss*2.75/image_data['height']
    bounds = content_pixel_bounds(image_data, dict(x0=box.get('playableX0',box['x0']), x1=box['x1'],
        y0=max(0,box['y0']-margin), y1=min(1,box['y1']+margin)))
    instances = components_to_instances(core_components(build_ink_runs(image_data,bounds,threshold), bounds,ss),ss)
    notes = []
    for c in instances:
        if c['cx'] > bounds['right']-max(3,ss*.62) or (c['morphologyKind']=='compact-core' and c['corePixelCount'] < ss*3):
            continue
        x, y = c['cx']/image_data['width'],c['cy']/image_data['height']
        mapping = _resolve_pitch_from_grand_staff(y,box.get('staffLines'),box.get('staffClefs'))
        if mapping['midi'] is None:
            continue
        notes.append(NoteheadCandidate(mapping['midi'],mapping['clef'],js_round(c['cx']),js_round(c['cy']),
            x,y,_estimate_ledger_line_count(y,mapping['lineYs']),mapping,
            (c['cx']-bounds['left'])/max(1,bounds['right']-bounds['left']+1),box.get('measureNumber',1),
            box.get('page',1),dict(source='raster-morphology-core',staffSpace=ss,
                                 **{k:v for k,v in c.items() if k not in ('cx','cy')})))
    return notes


def note_staff_space_px(notes, image_height):
    samples = []
    for note in notes:
        lines = note.pitch_mapping.get('lineYs',[])
        gap = (max(lines)-min(lines))*image_height/(len(lines)-1) if len(lines)>=2 else 0
        if math.isfinite(gap) and gap >= 3:
            samples.append(gap)
    return sum(samples)/len(samples) if samples else 8


def merge_raster_detection_passes(normal, dense, image_height):
    ss = note_staff_space_px(normal+dense,image_height)
    output = list(normal)
    for candidate in dense:
        if any(n.clef == candidate.clef and abs(n.cx-candidate.cx)<=ss*.45 and abs(n.cy-candidate.cy)<=ss*.45 for n in normal):
            continue
        output.append(replace(candidate,detection_evidence={**candidate.detection_evidence,'densePassOnly':True}))
    return sorted(output,key=lambda n:(n.cx,n.cy))


def fuse_raster_notehead_instances(legacy, morphology, image_height):
    if not morphology:
        return legacy
    ss = note_staff_space_px(morphology,image_height)
    def owned(n):
        return any(m.clef==n.clef and abs(m.cx-n.cx)<=ss*.72 and abs(m.cy-n.cy)<=ss*.68 for m in morphology)
    ordinary = [n for n in legacy if not n.detection_evidence.get('densePassOnly')]
    coherent = len(ordinary)>=3 and sum(owned(n) for n in ordinary)/len(ordinary)<.5
    def shape(n, rows, fill, residual, run):
        e=n.detection_evidence
        return (e.get('wideRows',0)>=rows and e.get('midFill',0)>=fill and
                e.get('staffStepResidual',math.inf)<=residual and e.get('verticalRun',math.inf)<=run)
    output = list(morphology)
    for n in legacy:
        e=n.detection_evidence
        dense=e.get('densePassOnly',False)
        near_morph = any(m.clef==n.clef and abs(m.cx-n.cx)<=ss*.48 and ss*.55<=abs(m.cy-n.cy)<=ss*3.2 for m in morphology)
        near_legacy = any(m is not n and m.clef==n.clef and abs(m.cx-n.cx)<=ss*.48 and
            ss*(1.5 if dense or m.detection_evidence.get('densePassOnly') else .55)<=abs(m.cy-n.cy)<=ss*3.2 and
            shape(m,max(7,js_round(ss*.55)),.27,.32,ss*1.25) for m in legacy)
        near_compact = any(m is not n and m.clef==n.clef and abs(m.cx-n.cx)<=ss*.48 and ss*1.5<=abs(m.cy-n.cy)<=ss*3.2 and
            shape(m,max(4,js_round(ss*.3)),.3,.5,ss*1.25) for m in legacy)
        strong = not dense and shape(n,max(7,js_round(ss*.55)),.3,.22,ss*1.25)
        precision = coherent and not dense and shape(n,max(4,js_round(ss*.3)),.3,.5,max(7,ss*1.35))
        chord = ((near_morph or near_legacy) and shape(n,max(7,js_round(ss*.55)),.27,.32,ss*1.25) or
                 near_compact and shape(n,max(4,js_round(ss*.3)),.3,.5,ss*1.25))
        if not owned(n) and (strong or precision or chord):
            recovered = ('morphology-chord-column-raster-shape' if chord else
                         'morphology-gap-strong-raster-shape' if strong else 'morphology-gap-coherent-precision-pass')
            output.append(replace(n,detection_evidence={**e,'recoveredBy':recovered}))
    return sorted(output,key=lambda n:(n.cx,n.cy))


def _ink_at(ink,x,y):
    x,y=js_round(x),js_round(y)
    return 0<=y<ink.shape[0] and 0<=x<ink.shape[1] and bool(ink[y,x])


def detect_stem(image_data,cx,cy,threshold,staff_mid_y,staff_space=8):
    ink=ink_mask(image_data,threshold)
    scale=staff_space if math.isfinite(staff_space) and staff_space>=3 else 8
    start=max(2,js_round(scale*.18))
    maximum=max(18,js_round(scale*4.5))
    minimum=max(5,js_round(scale*.55))
    expected=-1 if cy<=staff_mid_y else 1
    offsets=list(dict.fromkeys(max(lo,js_round(scale*r)) for lo,r in ((3,.34),(3,.42),(4,.5),(4,.58),(4,.66),(5,.74))))
    candidates=[]
    for offset in offsets:
        for side in (-1,1):
            x=js_round(cx+side*offset)
            for direction in (-1,1):
                last=count=misses=0
                for step in range(start,maximum+1):
                    y=cy+direction*step
                    if _ink_at(ink,x,y) or _ink_at(ink,x-side,y):
                        last=step; count+=1; misses=0
                    elif last>0 and misses<1:
                        misses+=1
                    elif last>0:
                        break
                run=last-start+1 if last else 0
                if run<minimum or count/max(1,run)<.72:
                    continue
                score=run+(scale*.18 if side==(1 if direction<0 else -1) else 0)+(scale*.04 if direction==expected else 0)
                candidates.append(dict(x=x,tipY=cy+direction*last,length=last,
                    direction='up' if direction<0 else 'down',side='right' if side>0 else 'left',
                    inkRatio=count/max(1,run),score=score))
    if not candidates:
        return None
    best=max(candidates,key=lambda c:(c['score'],c['inkRatio']))
    return {k:v for k,v in best.items() if k!='score'}


def measure_beam_strength_at_y(image_data,stem,threshold,y):
    if stem is None or not math.isfinite(y):
        return 0
    ink=ink_mask(image_data,threshold)
    run=0
    for x in range(stem['x'],stem['x']+29):
        if _ink_at(ink,x,y): run+=1
        elif run: break
    return run


def associate_stems_and_beams(image_data,notes,box,threshold):
    """enrichNoteheadRhythm geometry only; V2.5 retains duration ownership."""
    mid=js_round((box['y0']+box['y1'])/2*image_data['height'])
    for n in notes:
        ss=note_staff_space_px([n],image_data['height'])
        stem=detect_stem(image_data,n.cx,n.cy,threshold,mid,ss)
        on_line=stem is not None and any(abs(y*image_data['height']-stem['tipY'])<=max(1,ss*.14) for y in n.pitch_mapping['lineYs'])
        strength=0 if stem is None or on_line else measure_beam_strength_at_y(image_data,stem,threshold,stem['tipY'])
        beams=0
        if strength>=8:
            direction=1 if stem['direction']=='up' else -1
            secondary=any(measure_beam_strength_at_y(image_data,stem,threshold,stem['tipY']+direction*d)>=8 for d in (3,4,5,6,7))
            beams=2 if secondary else 1
        n.detection_evidence.update(stem=stem,beamStrength=strength,beams=beams)
    return notes


def filter_recovered_stem_fragments(notes,image_height):
    kept=[]
    for c in notes:
        stem=c.detection_evidence.get('stem')
        if not c.detection_evidence.get('recoveredBy') or stem is None:
            kept.append(c); continue
        ss=note_staff_space_px([c],image_height)
        def owns(n):
            other=n.detection_evidence.get('stem')
            return (n is not c and n.clef==c.clef and n.detection_evidence.get('source')=='raster-morphology-core' and
                other and other['direction']!=stem['direction'] and ss*.55<=abs(n.cx-c.cx)<=ss*1.5 and
                abs(other['x']-stem['x'])<=1 and abs(stem['tipY']-n.cy)<=ss*.28)
        if not any(owns(n) for n in notes): kept.append(c)
    return kept


def detect_filtered_noteheads(image_data,box,threshold=170):
    normal=detect_noteheads_in_measure(image_data,box,threshold,{'dense':False})
    dense=detect_noteheads_in_measure(image_data,box,threshold,{'dense':True})
    merged=merge_raster_detection_passes(normal,dense,image_data['height'])
    morphology=detect_raster_notehead_instances(image_data,box,threshold)
    fused=fuse_raster_notehead_instances(merged,morphology,image_data['height'])
    associated=associate_stems_and_beams(image_data,fused,box,threshold)
    return filter_recovered_stem_fragments(associated,image_data['height'])
