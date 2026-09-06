"""Deterministic, label-safe image augmentation pipeline for sheet music.

Transformations are grouped into GEOMETRIC, PHOTOMETRIC, QUALITY, and
DOCUMENT categories.  Every geometric transform that affects pixel layout
must also be applied to all associated supervision coordinates (object boxes,
centers, relation geometry, crop-relative positions).

Three presets are provided:
  CLEAN  — high-quality digital PDF training (minimal degradation)
  ROBUST — realistic scan/screenshot/photo degradation
  HARD   — aggressive evaluation-only degradation

The pipeline operates on numpy float32 images in [0, 1] range and PIL
images.  All transforms are deterministic given a numpy RandomState.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

from .geometry_hardening import (compose_homographies,
                                 make_rotation_homography_px,
                                 make_scale_homography, make_translate_homography)


# ---------------------------------------------------------------------------
# Transform primitives
# ---------------------------------------------------------------------------

def rotate_image(image: np.ndarray, angle_deg: float, rng: np.random.RandomState) -> np.ndarray:
    """Small rotation around image center. Returns float32 [0,1]."""
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    rotated = pil.rotate(float(angle_deg), resample=Image.BILINEAR, fillcolor=255)
    return np.asarray(rotated, dtype=np.float32) / 255.0


def apply_perspective_warp(image: np.ndarray, strength: float, rng: np.random.RandomState) -> tuple:
    """Mild perspective warp using four corner displacements.

    Returns (warped_image, homography, pixel_coeffs). The 3x3 `homography`
    maps normalized [0,1] supervision coordinates in the SAME way `pixel_coeffs`
    (PIL PERSPECTIVE 8-tuple, pixel space) warp the pixels. Together they
    guarantee perspective label safety and permit reference verification at
    interior points.
    """
    h, w = image.shape[:2]
    corner_shift = max(2, int(min(h, w) * strength))
    dx = rng.randint(-corner_shift, corner_shift + 1, size=(4, 2)).astype(np.float32)
    corners = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    dst = corners + dx
    coeffs = _perspective_coeffs(corners, dst, w, h)
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    warped = pil.transform((w, h), Image.PERSPECTIVE, coeffs, resample=Image.BILINEAR, fillcolor=255)
    warped = np.asarray(warped, dtype=np.float32) / 255.0

    c0, c1, c2, c3, c4, c5, c6, c7 = coeffs

    # PIL's PERSPECTIVE coefficients map OUTPUT pixels back to INPUT pixels
    # (inverse map). The forward-coeffs evaluation below therefore yields the
    # INVERSE of the true content motion; the true supervision homography is
    # its matrix inverse (fixed in Phase 2.16; previously the non-inverted
    # matrix was returned, mirroring labels the wrong way by ~2x displacement).
    # Build the normalized [0,1] homography from the SAME pixel coefficients.
    # PIL PERSPECTIVE maps pixel (u,v) ->
    #   (c0u+c1v+c2)/(c6u+c7v+1), (c3u+c4v+c5)/(c6u+c7v+1).
    def _pixel_to_norm(px, py):
        return px / w, py / h

    def _norm_to_pixel(nx, ny):
        return nx * w, ny * h

    # Evaluate at 4 unit-square corners in normalized space and solve for H.
    src = [[0, 0], [1, 0], [1, 1], [0, 1]]
    samples = []
    for (nx, ny) in src:
        u, v = _norm_to_pixel(nx, ny)
        denom = c6 * u + c7 * v + 1.0
        u2 = (c0 * u + c1 * v + c2) / denom
        v2 = (c3 * u + c4 * v + c5) / denom
        nx2, ny2 = _pixel_to_norm(u2, v2)
        samples.append((nx, ny, nx2, ny2))

    A = np.zeros((8, 8), dtype=np.float64)
    b = np.zeros(8, dtype=np.float64)
    for i, (sx, sy, dx_, dy_) in enumerate(samples):
        A[2 * i] = [sx, sy, 1, 0, 0, 0, -dx_ * sx, -dx_ * sy]
        A[2 * i + 1] = [0, 0, 0, sx, sy, 1, -dy_ * sx, -dy_ * sy]
        b[2 * i] = dx_
        b[2 * i + 1] = dy_
    Hvec = np.linalg.solve(A, b)
    homography_fwd = np.array([
        [Hvec[0], Hvec[1], Hvec[2]],
        [Hvec[3], Hvec[4], Hvec[5]],
        [Hvec[6], Hvec[7], 1.0],
    ], dtype=np.float64)
    # Invert: PIL consumed `coeffs` as an output->input map, so the fitted
    # forward matrix is the inverse of the true content motion.
    homography = np.linalg.inv(homography_fwd)
    homography = homography / homography[2, 2]
    return warped, homography, coeffs


def _perspective_coeffs(src, dst, w, h):
    """Compute 8-coefficient perspective transform from src to dst."""
    A = np.zeros((8, 8), dtype=np.float64)
    b = np.zeros(8, dtype=np.float64)
    for i in range(4):
        sx, sy = src[i]
        dx, dy = dst[i]
        A[2 * i] = [sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]
        A[2 * i + 1] = [0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]
        b[2 * i] = dx
        b[2 * i + 1] = dy
    coeffs = np.linalg.solve(A, b)
    return tuple(coeffs.tolist())


def scale_translate(image: np.ndarray, scale: float, tx: float, ty: float) -> np.ndarray:
    """Scale and translate with white fill. Coordinates in normalized space."""
    h, w = image.shape[:2]
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    resized = pil.resize((new_w, new_h), Image.BILINEAR)
    canvas = Image.new("L", (w, h), 255)
    ox = int(tx * w + (w - new_w) / 2)
    oy = int(ty * h + (h - new_h) / 2)
    canvas.paste(resized, (ox, oy))
    return np.asarray(canvas, dtype=np.float32) / 255.0


def brightness_adjust(image: np.ndarray, factor: float) -> np.ndarray:
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    enhanced = ImageEnhance.Brightness(pil).enhance(factor)
    return np.asarray(enhanced, dtype=np.float32) / 255.0


def contrast_adjust(image: np.ndarray, factor: float) -> np.ndarray:
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    enhanced = ImageEnhance.Contrast(pil).enhance(factor)
    return np.asarray(enhanced, dtype=np.float32) / 255.0


def gamma_adjust(image: np.ndarray, gamma: float) -> np.ndarray:
    inv_gamma = 1.0 / max(1e-6, gamma)
    table = np.array([(i / 255.0) ** inv_gamma * 255 for i in range(256)], dtype=np.uint8)
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    return np.asarray(pil.point(table), dtype=np.float32) / 255.0


def gaussian_blur(image: np.ndarray, radius: float) -> np.ndarray:
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    blurred = pil.filter(ImageFilter.GaussianBlur(radius=float(radius)))
    return np.asarray(blurred, dtype=np.float32) / 255.0


def gaussian_noise(image: np.ndarray, sigma: float, rng: np.random.RandomState) -> np.ndarray:
    noise = rng.normal(0, sigma, image.shape).astype(np.float32)
    return np.clip(image + noise, 0, 1).astype(np.float32)


def add_shadows(image: np.ndarray, rng: np.random.RandomState) -> np.ndarray:
    """Simulate uneven illumination / shadow across the page."""
    h, w = image.shape[:2]
    y_grid, x_grid = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = rng.uniform(0.2, 0.8) * w
    cy = rng.uniform(0.2, 0.8) * h
    radius = rng.uniform(0.3, 0.7) * max(h, w)
    dist = np.sqrt((x_grid - cx) ** 2 + (y_grid - cy) ** 2)
    shadow = np.clip(dist / radius, 0, 1) ** 1.5
    factor = 1.0 - rng.uniform(0.05, 0.2) * shadow
    return np.clip(image * factor, 0, 1).astype(np.float32)


def add_local_illumination(image: np.ndarray, rng: np.random.RandomState) -> np.ndarray:
    """Gradient illumination simulating uneven scan lighting."""
    h, w = image.shape[:2]
    angle = rng.uniform(0, 2 * math.pi)
    y_grid, x_grid = np.mgrid[0:h, 0:w].astype(np.float32)
    gradient = (x_grid * math.cos(angle) + y_grid * math.sin(angle))
    gradient = gradient / (np.abs(gradient).max() + 1e-6)
    strength = rng.uniform(0.02, 0.1)
    modifier = 1.0 + strength * gradient
    return np.clip(image * modifier, 0, 1).astype(np.float32)


def jpeg_compress_artifacts(image: np.ndarray, quality: int) -> np.ndarray:
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    import io
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=int(quality))
    buf.seek(0)
    return np.asarray(Image.open(buf), dtype=np.float32) / 255.0


def downsample_upsample(image: np.ndarray, scale: float) -> np.ndarray:
    h, w = image.shape[:2]
    small_h = max(1, int(h * scale))
    small_w = max(1, int(w * scale))
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    small = pil.resize((small_w, small_h), Image.BILINEAR)
    return np.asarray(small.resize((w, h), Image.BILINEAR), dtype=np.float32) / 255.0


def motion_blur(image: np.ndarray, kernel_size: int, rng: np.random.RandomState) -> np.ndarray:
    """Simple directional motion blur.

    PIL's ImageFilter.Kernel only supports 3x3 and 5x5 kernels; even or larger
    sizes raise "bad kernel size". Clamp to the nearest supported odd size in
    {3, 5} so the transform degrades gracefully instead of crashing.
    """
    kernel_size = max(3, min(5, int(kernel_size)))
    if kernel_size % 2 == 0:
        kernel_size -= 1
    angle = rng.uniform(0, math.pi)
    kernel = np.zeros((kernel_size, kernel_size), dtype=np.float32)
    cx, cy = kernel_size // 2, kernel_size // 2
    dx, dy = math.cos(angle), math.sin(angle)
    for t in np.linspace(-kernel_size / 2, kernel_size / 2, kernel_size):
        x = int(round(cx + t * dx))
        y = int(round(cy + t * dy))
        if 0 <= x < kernel_size and 0 <= y < kernel_size:
            kernel[y, x] = 1.0
    kernel = kernel / max(1, kernel.sum())
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    return np.asarray(pil.filter(ImageFilter.Kernel(
        (kernel_size, kernel_size), kernel.flatten().tolist(), scale=1, offset=0
    )), dtype=np.float32) / 255.0


def mild_sharpen(image: np.ndarray, factor: float = 1.5) -> np.ndarray:
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    enhancer = ImageEnhance.Sharpness(pil)
    return np.asarray(enhancer.enhance(factor), dtype=np.float32) / 255.0


def crop_jitter(image: np.ndarray, margin_frac: float, rng: np.random.RandomState) -> np.ndarray:
    """Randomly crop and resize back to original dimensions."""
    h, w = image.shape[:2]
    crop_x = int(w * margin_frac)
    crop_y = int(h * margin_frac)
    x0 = rng.randint(0, crop_x + 1)
    y0 = rng.randint(0, crop_y + 1)
    x1 = w - rng.randint(0, crop_x + 1)
    y1 = h - rng.randint(0, crop_y + 1)
    pil = Image.fromarray((image * 255).astype(np.uint8), mode="L")
    cropped = pil.crop((x0, y0, x1, y1))
    return np.asarray(cropped.resize((w, h), Image.BILINEAR), dtype=np.float32) / 255.0


def add_paper_texture(image: np.ndarray, rng: np.random.RandomState, strength: float = 0.02) -> np.ndarray:
    """Faint paper texture noise."""
    h, w = image.shape[:2]
    texture = rng.normal(0, strength, (h, w)).astype(np.float32)
    low_freq = np.kron(
        rng.normal(0, strength * 3, (max(1, h // 8), max(1, w // 8))).astype(np.float32),
        np.ones((8, 8), dtype=np.float32)
    )[:h, :w]
    return np.clip(image + texture + low_freq, 0, 1).astype(np.float32)


def grayscale_variation(image: np.ndarray, rng: np.random.RandomState) -> np.ndarray:
    """Slight warm/cool tint before grayscale conversion."""
    shift = rng.uniform(-0.03, 0.03)
    return np.clip(image + shift, 0, 1).astype(np.float32)


def page_curvature_shadow(image: np.ndarray, rng: np.random.RandomState) -> np.ndarray:
    """Simulate page curvature near binding."""
    h, w = image.shape[:2]
    y_grid = np.mgrid[0:h, 0:w].astype(np.float32)[0]
    edge_distance = np.minimum(y_grid / h, (h - 1 - y_grid) / h)
    shadow = 1.0 - rng.uniform(0.03, 0.12) * (1.0 - edge_distance * 2).clip(0, 1) ** 2
    return np.clip(image * shadow, 0, 1).astype(np.float32)


def edge_vignette(image: np.ndarray, strength: float = 0.15) -> np.ndarray:
    h, w = image.shape[:2]
    y_grid, x_grid = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    max_dist = math.sqrt(cx ** 2 + cy ** 2)
    dist = np.sqrt((x_grid - cx) ** 2 + (y_grid - cy) ** 2) / max_dist
    vignette = 1.0 - strength * dist ** 2
    return np.clip(image * vignette, 0, 1).astype(np.float32)


# ---------------------------------------------------------------------------
# Coordinate transform helpers
# ---------------------------------------------------------------------------

def transform_point(px: float, py: float, transform: dict, img_w: int, img_h: int) -> tuple[float, float]:
    """Apply a geometric transform to a single (normalized) point.

    The rotation branch replicates ``PIL.Image.rotate`` pixel motion
    (counter-clockwise-as-viewed about the pixel center), i.e. the same
    aspect-conjugated convention as
    :func:`geometry_hardening.make_rotation_homography_px`. ``img_w``/``img_h``
    are required because a pixel rotation is aspect-dependent in normalized
    space. Fixed in Phase 2.16 (previously wrong sign and missing aspect).
    """
    if "rotation" in transform:
        angle = math.radians(transform["rotation"])
        aspect = float(img_w) / max(1e-9, float(img_h))
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        dx, dy = px - 0.5, py - 0.5
        px = 0.5 + cos_a * dx + (sin_a / aspect) * dy
        py = 0.5 + (-sin_a * aspect) * dx + cos_a * dy
    if "scale" in transform:
        s = transform["scale"]
        cx, cy = 0.5, 0.5
        px = cx + (px - cx) * s
        py = cy + (py - cy) * s
    if "translate" in transform:
        px += transform["translate"][0]
        py += transform["translate"][1]
    px = max(0.0, min(1.0, px))
    py = max(0.0, min(1.0, py))
    return px, py


def transform_bounds(x0, y0, x1, y1, transform: dict, img_w: int, img_h: int):
    """Transform a bounding box through the same geometric transform as the image."""
    points = [
        transform_point(x0, y0, transform, img_w, img_h),
        transform_point(x1, y0, transform, img_w, img_h),
        transform_point(x0, y1, transform, img_w, img_h),
        transform_point(x1, y1, transform, img_w, img_h),
    ]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------------------
# Transform specification
# ---------------------------------------------------------------------------

@dataclass
class TransformSpec:
    name: str
    probability: float
    params: dict = field(default_factory=dict)
    geometric: bool = False
    category: str = "photometric"


CLEAN_PRESET = [
    TransformSpec("brightness", probability=0.30, params={"factor_range": (0.94, 1.06)}),
    TransformSpec("contrast", probability=0.25, params={"factor_range": (0.92, 1.08)}),
    TransformSpec("gaussian_noise", probability=0.15, params={"sigma": 0.006}),
]

ROBUST_PRESET = [
    TransformSpec("rotation", probability=0.35, params={"angle_range": (-2.0, 2.0)}, geometric=True, category="geometric"),
    TransformSpec("crop_jitter", probability=0.20, params={"margin_frac": 0.02}, geometric=True, category="geometric"),
    TransformSpec("scale_translate", probability=0.15, params={"scale_range": (0.96, 1.04), "translate_range": 0.01}, geometric=True, category="geometric"),
    TransformSpec("perspective_warp", probability=0.10, params={"strength": 0.02}, geometric=True, category="geometric"),
    TransformSpec("brightness", probability=0.35, params={"factor_range": (0.88, 1.12)}),
    TransformSpec("contrast", probability=0.30, params={"factor_range": (0.85, 1.15)}),
    TransformSpec("gamma", probability=0.15, params={"gamma_range": (0.9, 1.1)}),
    TransformSpec("shadow", probability=0.20, params={}),
    TransformSpec("local_illumination", probability=0.15, params={}),
    TransformSpec("gaussian_blur", probability=0.20, params={"radius_range": (0.3, 1.2)}),
    TransformSpec("gaussian_noise", probability=0.25, params={"sigma": 0.012}),
    TransformSpec("jpeg_compress", probability=0.20, params={"quality_range": (60, 85)}),
    TransformSpec("downsample_upsample", probability=0.15, params={"scale_range": (0.5, 0.8)}),
    TransformSpec("paper_texture", probability=0.15, params={"strength": 0.015}),
    TransformSpec("page_curvature", probability=0.10, params={}),
    TransformSpec("edge_vignette", probability=0.10, params={"strength": 0.12}),
    TransformSpec("grayscale_variation", probability=0.10, params={}),
]

HARD_PRESET = [
    TransformSpec("rotation", probability=0.50, params={"angle_range": (-4.0, 4.0)}, geometric=True, category="geometric"),
    TransformSpec("crop_jitter", probability=0.35, params={"margin_frac": 0.04}, geometric=True, category="geometric"),
    TransformSpec("scale_translate", probability=0.25, params={"scale_range": (0.90, 1.10), "translate_range": 0.02}, geometric=True, category="geometric"),
    TransformSpec("perspective_warp", probability=0.25, params={"strength": 0.04}, geometric=True, category="geometric"),
    TransformSpec("brightness", probability=0.50, params={"factor_range": (0.75, 1.25)}),
    TransformSpec("contrast", probability=0.45, params={"factor_range": (0.70, 1.30)}),
    TransformSpec("gamma", probability=0.30, params={"gamma_range": (0.7, 1.3)}),
    TransformSpec("shadow", probability=0.35, params={}),
    TransformSpec("local_illumination", probability=0.30, params={}),
    TransformSpec("gaussian_blur", probability=0.35, params={"radius_range": (0.5, 2.0)}),
    TransformSpec("motion_blur", probability=0.15, params={"kernel_range": (3, 7)}),
    TransformSpec("gaussian_noise", probability=0.40, params={"sigma": 0.025}),
    TransformSpec("jpeg_compress", probability=0.35, params={"quality_range": (30, 70)}),
    TransformSpec("downsample_upsample", probability=0.25, params={"scale_range": (0.3, 0.7)}),
    TransformSpec("paper_texture", probability=0.25, params={"strength": 0.03}),
    TransformSpec("page_curvature", probability=0.20, params={}),
    TransformSpec("edge_vignette", probability=0.20, params={"strength": 0.20}),
    TransformSpec("grayscale_variation", probability=0.20, params={}),
    TransformSpec("mild_sharpen", probability=0.10, params={"factor": 2.0}),
]

PRESETS = {
    "clean": CLEAN_PRESET,
    "robust": ROBUST_PRESET,
    "hard": HARD_PRESET,
}


def _sample_range(spec, param_name, rng):
    lo, hi = spec.params[param_name]
    return rng.uniform(lo, hi)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_augmentation(
    image: np.ndarray,
    transforms: list[TransformSpec],
    rng: np.random.RandomState,
    geometric_context: dict | None = None,
) -> tuple[np.ndarray, dict]:
    """Apply a list of transforms to an image, returning the result and a
    geometric transform summary for coordinate propagation.

    Args:
        image: float32 [0,1] image of shape (H, W)
        transforms: list of TransformSpec to apply
        rng: numpy RandomState for reproducibility
        geometric_context: optional dict with img_w, img_h for coordinate transform tracking

    Returns:
        (augmented_image, transform_record)
    """
    result = image.copy()
    transform_record = {
        "rotation": 0.0,
        "scale": 1.0,
        "translate": (0.0, 0.0),
        "applied": [],
    }

    for spec in transforms:
        if rng.random() >= spec.probability:
            continue

        if spec.name == "rotation":
            angle = _sample_range(spec, "angle_range", rng)
            rh, rw = result.shape[:2]
            result = rotate_image(result, angle, rng)
            transform_record["rotation"] += angle
            # Per-step H replicates the TRUE PIL pixel motion (Phase 2.16:
            # screen-CCW about the pixel center, aspect-conjugated).
            rot_H = make_rotation_homography_px(angle, rw, rh)
            transform_record["applied"].append({
                "name": "rotation", "angle": angle,
                "H": rot_H.tolist(),
            })

        elif spec.name == "perspective_warp":
            strength = spec.params.get("strength", 0.02)
            result, _homography, _coeffs = apply_perspective_warp(result, strength, rng)
            transform_record["perspective"] = _homography.tolist()
            transform_record["applied"].append({
                "name": "perspective_warp", "strength": strength,
                "homography": _homography.tolist(), "H": _homography.tolist(),
            })

        elif spec.name == "scale_translate":
            scale = _sample_range(spec, "scale_range", rng)
            tx = rng.uniform(-spec.params["translate_range"], spec.params["translate_range"])
            ty = rng.uniform(-spec.params["translate_range"], spec.params["translate_range"])
            result = scale_translate(result, scale, tx, ty)
            transform_record["scale"] *= scale
            transform_record["translate"] = (
                transform_record["translate"][0] + tx,
                transform_record["translate"][1] + ty,
            )
            H = compose_homographies([
                make_scale_homography(scale, 0.5, 0.5),
                make_translate_homography(tx, ty),
            ])
            transform_record["applied"].append({
                "name": "scale_translate", "scale": scale, "tx": tx, "ty": ty, "H": H.tolist(),
            })

        elif spec.name == "brightness":
            factor = _sample_range(spec, "factor_range", rng)
            result = brightness_adjust(result, factor)

        elif spec.name == "contrast":
            factor = _sample_range(spec, "factor_range", rng)
            result = contrast_adjust(result, factor)

        elif spec.name == "gamma":
            gamma = _sample_range(spec, "gamma_range", rng)
            result = gamma_adjust(result, gamma)

        elif spec.name == "shadow":
            result = add_shadows(result, rng)

        elif spec.name == "local_illumination":
            result = add_local_illumination(result, rng)

        elif spec.name == "gaussian_blur":
            radius = _sample_range(spec, "radius_range", rng)
            result = gaussian_blur(result, radius)

        elif spec.name == "motion_blur":
            kmin, kmax = spec.params.get("kernel_range", (3, 7))
            ks = rng.randint(kmin, kmax + 1)
            result = motion_blur(result, int(ks), rng)

        elif spec.name == "gaussian_noise":
            result = gaussian_noise(result, spec.params["sigma"], rng)

        elif spec.name == "jpeg_compress":
            lo, hi = spec.params["quality_range"]
            q = rng.randint(lo, hi + 1)
            result = jpeg_compress_artifacts(result, int(q))

        elif spec.name == "downsample_upsample":
            scale = _sample_range(spec, "scale_range", rng)
            result = downsample_upsample(result, scale)

        elif spec.name == "paper_texture":
            result = add_paper_texture(result, rng, spec.params.get("strength", 0.02))

        elif spec.name == "page_curvature":
            result = page_curvature_shadow(result, rng)

        elif spec.name == "edge_vignette":
            result = edge_vignette(result, spec.params.get("strength", 0.15))

        elif spec.name == "grayscale_variation":
            result = grayscale_variation(result, rng)

        elif spec.name == "mild_sharpen":
            result = mild_sharpen(result, spec.params.get("factor", 1.5))

        elif spec.name == "crop_jitter":
            margin = spec.params["margin_frac"]
            h, w = result.shape[:2]
            crop_x = int(w * margin)
            crop_y = int(h * margin)
            x0 = rng.randint(0, crop_x + 1)
            y0 = rng.randint(0, crop_y + 1)
            x1 = w - rng.randint(0, crop_x + 1)
            y1 = h - rng.randint(0, crop_y + 1)
            # Normalized crop box (source space)
            crop_box = {
                "x0": x0 / float(w),
                "y0": y0 / float(h),
                "x1": x1 / float(w),
                "y1": y1 / float(h),
            }
            # Apply THIS box to the pixels (Phase 2.16 fix: previously a
            # second, independently drawn box inside crop_jitter() was applied
            # while this box was recorded, so supervision tracked the wrong
            # crop). Pixel steps replicate crop_jitter() exactly.
            pil_box = Image.fromarray((result * 255).astype(np.uint8), mode="L")
            result = np.asarray(
                pil_box.crop((x0, y0, x1, y1)).resize((w, h), Image.BILINEAR),
                dtype=np.float32) / 255.0
            # Crop-then-resize-to-full is scale + translate in normalized space:
            #   x' = (x - x0_pix / w) / (x1_pix/w - x0_pix/w)
            scale_x = 1.0 / max(1e-6, crop_box["x1"] - crop_box["x0"])
            scale_y = 1.0 / max(1e-6, crop_box["y1"] - crop_box["y0"])
            tx = -crop_box["x0"] * scale_x
            ty = -crop_box["y0"] * scale_y
            # Apply anisotropic scale+translate on top of accumulated transform
            transform_record["scale"] *= (scale_x + scale_y) / 2.0
            transform_record["translate"] = (
                transform_record["translate"][0] + tx,
                transform_record["translate"][1] + ty,
            )
            transform_record["crop"] = crop_box
            transform_record["crop_homography"] = [
                [scale_x, 0.0, tx],
                [0.0, scale_y, ty],
                [0.0, 0.0, 1.0],
            ]
            transform_record["applied"].append({
                "name": "crop_jitter", "margin": margin,
                "crop": crop_box, "scale_x": scale_x, "scale_y": scale_y,
                "tx": tx, "ty": ty,
                "H": transform_record["crop_homography"],
            })

    result = np.clip(result, 0, 1).astype(np.float32)
    return result, transform_record


def get_preset(name: str) -> list[TransformSpec]:
    if name not in PRESETS:
        raise ValueError(f"Unknown preset: {name}. Choose from {list(PRESETS.keys())}")
    return PRESETS[name]


def describe_preset(name: str) -> dict:
    specs = get_preset(name)
    return {
        "name": name,
        "transforms": [
            {
                "name": s.name,
                "probability": s.probability,
                "geometric": s.geometric,
                "category": s.category,
                "params": s.params,
            }
            for s in specs
        ],
        "total_transforms": len(specs),
        "geometric_transforms": sum(1 for s in specs if s.geometric),
    }
