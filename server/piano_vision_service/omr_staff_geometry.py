"""Staff-line inputs for the JS detector ports.

Ports detectStaffLines.js: adaptive thresholds, row scores, five-line lattice
selection and the consistent two-staff chunk test. Coordinates stay on source.
"""
import math
import numpy as np


def longest_run(row):
    edges=np.diff(np.r_[False,row,False].astype(np.int8))
    lengths=np.flatnonzero(edges == -1)-np.flatnonzero(edges == 1)
    return int(lengths.max()) if len(lengths) else 0


def detect_staff_line_staves(gray, content_bounds):
    height,width=gray.shape
    left=max(0,math.floor(content_bounds[0]*width))
    right=min(width-1,math.ceil(content_bounds[2]*width))
    samples=np.sort(gray[::max(1,height//320),left:right+1:max(1,(right-left+1)//320)].ravel())
    if not len(samples):
        return []
    background=samples[math.floor(len(samples)*.9)]
    ink_pixels=samples[samples<background-15]
    adaptive=170 if len(ink_pixels)<len(samples)*.002 else min(235,max(150,(background+ink_pixels[len(ink_pixels)//2])/2))
    paper=samples[math.floor(len(samples)*.92)]
    faint_band=samples[(samples<paper-5)&(samples>paper-75)]
    faint=None if len(faint_band)<len(samples)*.003 else min(235,max(178,faint_band[math.floor(len(faint_band)*.55)]+10))
    passes=[(adaptive,.5,.85,False),(adaptive,.35,.6,False),(min(235,adaptive+25),.3,.55,False)]
    if faint is not None and faint>adaptive+8:
        passes.append((faint,.1,.55,True))
    for pi,(threshold,run_cov,dark_cov,run_only) in enumerate(passes):
        ink=gray[:,left:right+1]<threshold
        run=np.array([longest_run(row)/ink.shape[1] for row in ink],dtype=np.float32)
        dark=ink.mean(axis=1).astype(np.float32)
        rows=np.flatnonzero((run>run_cov) if run_only else ((run>run_cov)|(dark>dark_cov)))
        clusters=np.split(rows,np.flatnonzero(np.diff(rows)>max(3,math.floor(height*.018)))+1)
        staves=[]
        for rows in clusters:
            if len(rows)<2: continue
            bands=np.split(rows,np.flatnonzero(np.diff(rows)>1)+1)
            centers=[float((b[0]+b[-1])/2) for b in bands]
            strengths=[float(np.max(run[b]*.8+dark[b]*.2)) for b in bands]
            best=None
            for i in range(len(centers)-4):
                lines=centers[i:i+5]
                gaps=np.diff(lines)
                if max(gaps)<=0 or min(gaps)/max(gaps)<.75: continue
                score=float(np.var(gaps)/max(1,np.mean(gaps)**2)*4+1-np.mean(strengths[i:i+5]))
                if best is None or score<best[0]: best=(score,[y/height for y in lines])
            staves.append(dict(y0=float(rows[0]/height),y1=float(rows[-1]/height),
                               center=float((rows[0]+rows[-1])/2/height),lineYs=best[1] if best else None))
        defer=faint is not None and not run_only and 0<len(staves)<max(2,math.floor(height*.006))
        if staves and (not defer or pi==len(passes)-1): return staves
    return []


def group_staves_into_systems(staves):
    """tryChunkStaves/chunkingIsConsistent for the piano two-staff case."""
    if len(staves)>2 and len(staves)%2==0:
        intra=[staves[i]['center']-staves[i-1]['center'] for i in range(1,len(staves),2)]
        inter=[staves[i]['center']-staves[i-1]['center'] for i in range(2,len(staves),2)]
        median=lambda v:sorted(v)[len(v)//2]
        if median(inter)>median(intra)*1.04 and sum(g>max(intra)*.9 for g in inter)/len(inter)>=.7:
            return [staves[i:i+2] for i in range(0,len(staves),2)]
    return [[s] for s in staves]


def continuous_grand_staff_barlines(gray,content_bounds,upper,lower):
    """detectBarlineCandidates' continuous grand-staff acceptance branch.

    Only used when both five-line staves are resolved. The existing adapter
    fallback still handles bands without this independent staff evidence.
    """
    height,width=gray.shape
    top,bottom=math.floor(upper[0]*height),math.ceil(lower[-1]*height)
    # splitGrandStaffVerticalBands searches the least dense middle-third row.
    left=max(0,math.floor(content_bounds[0]*width));right=min(width-1,math.ceil(content_bounds[2]*width))
    band_height=bottom-top+1
    # computeRowDensityInContent uses its fixed 185 luminance threshold.
    from_start=top+math.floor(band_height*.32);to_end=top+math.floor(band_height*.68)
    density=(gray[:,left:right+1]<185).mean(axis=1)
    split=from_start+int(np.argmin(density[from_start:to_end+1]))
    half=max(2,math.floor(band_height*.06))
    bands=[(top,max(top,split-half)),(max(top,split-half),min(bottom,split+half)),(min(bottom,split+half),bottom)]
    ink=gray<150
    full=np.array([longest_run(ink[top:bottom+1,x])/band_height for x in range(width)])
    positions=[]
    for x in range(left,right+1):
        strength=[longest_run(ink[a:b+1,x])/max(1,b-a+1) for a,b in bands]
        if max(full[max(0,x-1):min(width,x+2)])>=.78 and strength[0]>=.52 and strength[1]>=.28 and strength[2]>=.52:
            positions.append(x/width)
    # detectBarlineCandidates merges nearby columns; continuous barline centers
    # with equal scores keep the first pixel, as in the JS implementation.
    merged=[]
    for x in positions:
        if not merged or (x-merged[-1])*width>max(2,math.floor(width*.012)):
            merged.append(x)
    return merged
