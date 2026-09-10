"""Deterministic, non-generative page normalization and recoverability signals.

Thresholds are explicitly uncalibrated engineering defaults. Passing this gate
permits recognition; it is not a guarantee of readable or complete music.
"""
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

VERSION = "canonical-page/2.0"


@dataclass(frozen=True)
class QualityPolicy:
    min_short_side: int = 300
    min_contrast: float = 35
    min_laplacian_variance: float = 18
    max_pixels: int = 40_000_000
    calibrated: bool = False


def read_pages(path, dpi=180, max_pixels=40_000_000):
    """Lazy PDF page rasterization; image EXIF and transparency are honored."""
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        import pypdfium2 as pdfium
        if not 72 <= dpi <= 600:
            raise ValueError("PDF raster DPI must be 72..600")
        with pdfium.PdfDocument(str(path)) as document:
            for index in range(len(document)):
                page = document[index]
                try:
                    width, height = page.get_size()
                    if width * height * (dpi / 72) ** 2 > max_pixels:
                        raise ValueError("PAGE_PIXEL_LIMIT")
                    bitmap = page.render(scale=dpi / 72)
                    try:
                        yield index, bitmap.to_pil().convert("L").copy()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
    else:
        with Image.open(path) as image:
            if image.width * image.height > max_pixels:
                raise ValueError("PAGE_PIXEL_LIMIT")
            image = ImageOps.exif_transpose(image).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            yield 0, background.convert("L")


def _ordered_quad(points):
    p = np.asarray(points,dtype=np.float32).reshape(4,2)
    if not np.isfinite(p).all() or len(np.unique(p,axis=0)) != 4:
        raise ValueError("INVALID_PAGE_CORNERS")
    center = p.mean(0)
    p = p[np.argsort(np.arctan2(p[:,1]-center[1],p[:,0]-center[0]))]
    p = np.roll(p,-int(np.argmin(p.sum(1))),axis=0)
    if cv2.contourArea(p,oriented=True) < 0:
        p = p[[0,3,2,1]]
    if not cv2.isContourConvex(p):
        raise ValueError("INVALID_PAGE_CORNERS")
    return p


def detect_page_quad(gray):
    scale = min(1,1000/max(gray.shape))
    thumb = cv2.resize(gray,None,fx=scale,fy=scale) if scale<1 else gray
    _, light = cv2.threshold(cv2.GaussianBlur(thumb,(5,5),0),0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    contours,_ = cv2.findContours(light,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours,key=cv2.contourArea,reverse=True)[:5]:
        area = cv2.contourArea(contour)/thumb.size
        if not .35 < area < .985:
            continue
        polygon = cv2.approxPolyDP(contour,.02*cv2.arcLength(contour,True),True)
        if len(polygon)==4 and cv2.isContourConvex(polygon):
            return _ordered_quad(polygon.reshape(4,2)/scale)
    return None


def rectify(gray, corners):
    p = _ordered_quad(corners)
    if (p<0).any() or (p[:,0]>=gray.shape[1]).any() or (p[:,1]>=gray.shape[0]).any():
        raise ValueError("INVALID_PAGE_CORNERS")
    widths = [np.linalg.norm(p[1]-p[0]),np.linalg.norm(p[2]-p[3])]
    heights = [np.linalg.norm(p[3]-p[0]),np.linalg.norm(p[2]-p[1])]
    if min(widths+heights)<32 or max(widths)/min(widths)>5 or max(heights)/min(heights)>5:
        raise ValueError("UNRECOVERABLE_PERSPECTIVE")
    width,height = int(round(max(widths))),int(round(max(heights)))
    destination = np.array([[0,0],[width-1,0],[width-1,height-1],[0,height-1]],np.float32)
    matrix = cv2.getPerspectiveTransform(p,destination)
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix))<1e-10:
        raise ValueError("UNRECOVERABLE_PERSPECTIVE")
    return cv2.warpPerspective(gray,matrix,(width,height),flags=cv2.INTER_LINEAR,borderValue=255),matrix


def line_orientation(gray):
    edges = cv2.Canny(gray,50,150)
    lines = cv2.HoughLinesP(edges,1,np.pi/1800,threshold=50,
                            minLineLength=max(50,min(gray.shape)//5),maxLineGap=15)
    if lines is None:
        return None,0
    angles, weights = [],[]
    for x0,y0,x1,y1 in np.asarray(lines).reshape(-1,4):
        angle = np.degrees(np.arctan2(float(y1-y0),float(x1-x0)))
        angle = (angle+90)%180-90
        angles.append(angle); weights.append(np.hypot(x1-x0,y1-y0))
    angles=np.asarray(angles);weights=np.asarray(weights)
    # Robust dominant axis handles a photographed page rotated by 90 degrees.
    bins=np.arange(-90,91,1)
    histogram,_=np.histogram(angles,bins=bins,weights=weights)
    center=bins[int(histogram.argmax())]+.5
    select=np.abs(angles-center)<3
    return float(np.median(angles[select])),int(select.sum())


def rotate_expand(gray, angle):
    h,w=gray.shape
    matrix=cv2.getRotationMatrix2D(((w-1)/2,(h-1)/2),angle,1)
    c,s=abs(matrix[0,0]),abs(matrix[0,1])
    nw,nh=int(np.ceil(h*s+w*c)),int(np.ceil(h*c+w*s))
    matrix[0,2]+=(nw-w)/2; matrix[1,2]+=(nh-h)/2
    return cv2.warpAffine(gray,matrix,(nw,nh),borderValue=255),np.vstack((matrix,[0,0,1]))


def normalize_page(image, corners=None, policy=None, orientation_degrees=None):
    policy=policy or QualityPolicy()
    gray=np.asarray(image.convert("L") if isinstance(image,Image.Image) else image)
    if gray.ndim!=2 or gray.dtype!=np.uint8:
        raise ValueError("Expected an 8-bit grayscale canonical input")
    if gray.size>policy.max_pixels:
        raise ValueError("PAGE_PIXEL_LIMIT")
    gray=gray.copy(); original_shape=gray.shape
    matrix=np.eye(3); applied=[]; reasons=[]; warnings=[]
    candidate = corners if corners is not None else detect_page_quad(gray)
    if candidate is not None:
        try:
            gray,h=rectify(gray,candidate);matrix=h@matrix;applied.append("perspective_rectification")
        except ValueError as error:
            reasons.append(str(error))
    recoverable_short_side=min(original_shape+gray.shape)
    if orientation_degrees is not None:
        if orientation_degrees not in (0,90,180,270):
            raise ValueError("Orientation must be 0, 90, 180 or 270")
        if orientation_degrees:
            gray,h=rotate_expand(gray,orientation_degrees);matrix=h@matrix;applied.append("explicit_orientation")
    angle,line_count=line_orientation(gray)
    if angle is not None and line_count>=4 and abs(angle)>.15:
        gray,h=rotate_expand(gray,angle);matrix=h@matrix;applied.append("staff_deskew")
    # Conservative background division; no binary output or generative recovery.
    background=cv2.GaussianBlur(gray,(0,0),max(5,min(gray.shape)/35))
    foreground=gray[gray < np.minimum(background.astype(float)-15,220)]
    contrast=float(np.median(background)-np.percentile(foreground,25)) if len(foreground) else 0
    if contrast>=policy.min_contrast and float(np.percentile(background,90)-np.percentile(background,10))>25:
        normalized=np.clip(gray.astype(float)*245/np.maximum(background,80),0,255).astype(np.uint8)
        gray=normalized;applied.append("lighting_normalization")
    ink=gray<200
    tiles=[]
    for y in range(0,gray.shape[0],96):
        for x in range(0,gray.shape[1],96):
            tile=gray[y:y+96,x:x+96]
            if min(tile.shape)>=16 and .01<(tile<200).mean()<.8:
                tiles.append(float(cv2.Laplacian(tile,cv2.CV_32F).var()))
    sharpness=float(np.median(tiles)) if tiles else 0
    if recoverable_short_side<policy.min_short_side: reasons.append("INSUFFICIENT_RESOLUTION")
    if contrast<policy.min_contrast: reasons.append("LOW_RECOVERABLE_CONTRAST")
    if not ink.any(): reasons.append("NO_RECOVERABLE_NOTATION")
    if tiles and sharpness<policy.min_laplacian_variance: reasons.append("SEVERE_BLUR")
    border=np.concatenate((ink[:2].ravel(),ink[-2:].ravel(),ink[:,:2].ravel(),ink[:,-2:].ravel()))
    if border.mean()>.015: warnings.append("POSSIBLE_CROPPED_NOTATION")
    if line_count<4: warnings.append("STAFF_GEOMETRY_UNCERTAIN")
    if orientation_degrees is None: warnings.append("SEMANTIC_ORIENTATION_CHECK_REQUIRED")
    warnings.append("LOCAL_OCCLUSION_CHECK_REQUIRED")
    return {"image":gray,"source_to_canonical":matrix,"canonical_to_source":np.linalg.inv(matrix),
            "quality":{"version":VERSION,"recognition_allowed":not reasons,"calibrated":policy.calibrated,
                       "complete_eligible":policy.calibrated and not reasons and not warnings,
                       "reasons":sorted(set(reasons)),"warnings":sorted(set(warnings)),"applied":applied,
                       "orientation_hypotheses":[0,180] if orientation_degrees is None else [0],
                       "original_shape":list(original_shape),"canonical_shape":list(gray.shape),
                       "measurements":{"contrast":contrast,"ink_tile_laplacian_median":sharpness,
                                       "recoverable_short_side":recoverable_short_side,
                                       "staff_line_support":line_count,"estimated_angle":angle},
                       "user_message":None if not reasons else "Unable to transcribe reliably — please provide a clearer image"}}
