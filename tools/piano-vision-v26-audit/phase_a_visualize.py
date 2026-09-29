"""Phase A / P5: visualise what the pitch head actually receives.

Dumps, for one source and one production record:
  - the 192x512 view tensor as PNG
  - the object boxes drawn on it
  - the 9 region-sampler grid points drawn on it
  - a magnified crop of the 3x-expanded sampled region
  - the same region after the 5 backbone scales

This is the check the prior investigation never did: nobody has looked at the
sampled pixels.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

H.add_runtime_to_path()
from piano_vision.v2.data import build_inputs, attach_targets, collate  # noqa: E402
from piano_vision.v25.data import attach_object_page_geo  # noqa: E402
from piano_vision.v25.performance import prepare_batch  # noqa: E402

OUTDIR = H.V26_ROOT / "out/visual"
OUTDIR.mkdir(parents=True, exist_ok=True)
QW, QH = 512, 192


def to_img(t):
    a = (t.detach().cpu().numpy().squeeze() * 255).clip(0, 255).astype(np.uint8)
    return Image.fromarray(a, mode="L").convert("RGB")


def draw_view(view, boxes, grid_points, title, path):
    im = to_img(view).resize((QW, QH), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for i, (x0, y0, x1, y1) in enumerate(boxes[:40]):
        d.rectangle([x0 * QW, y0 * QH, x1 * QW, y1 * QH], outline=(255, 0, 0), width=1)
    for (px, py) in grid_points[:120]:
        d.ellipse([px * QW - 1, py * QH - 1, px * QW + 1, py * QH + 1], fill=(0, 90, 255))
    d.text((4, 4), title, fill=(0, 160, 0))
    im.save(path)
    return im


def zoom_region(view, box, scale=6, path=None):
    x0, y0, x1, y1 = box
    px0, py0 = max(0, int(x0 * QW)), max(0, int(y0 * QH))
    px1, py1 = min(QW, int(x1 * QW) + 1), min(QH, int(y1 * QH) + 1)
    crop = to_img(view).crop((px0, py0, px1, py1))
    big = crop.resize(((px1 - px0) * scale, (py1 - py0) * scale), Image.NEAREST)
    if path:
        big.save(path)
    return big, (px1 - px0, py1 - py0)


def dump(runtime, resolver, ordered, tag, take=2):
    made = []
    n = 0
    for rec in ordered:
        if n >= take:
            break
        try:
            sample, selected, lookup, relations, nodes = build_inputs(
                rec, ordered, resolver, runtime.config)
            sample = attach_targets(sample, rec, selected, lookup, relations, nodes)
            sample = attach_object_page_geo(sample, selected)
            batch = prepare_batch(collate([sample]), consistency=False)
        except Exception as exc:
            print(f"  {tag}: skip {type(exc).__name__}: {exc}")
            continue
        views = batch["images"][0]
        obox = batch["object_boxes"][0]
        oview = batch["object_view"][0]
        nviews = views.shape[0]
        # the sampler grid
        g = runtime.model.sampler.grid
        pts = []
        for i in range(min(len(obox), 60)):
            v = int(oview[i])
            b = obox[i].numpy()
            for gp in g.numpy():
                pts.append((float(b[0] + gp[0] * (b[2] - b[0])),
                            float(b[1] + gp[1] * (b[3] - b[1]))))
        draw_view(views[0], obox.numpy(), pts,
                  f"{tag} view0 (page) nviews={nviews}", OUTDIR / f"{tag}_view0.png")
        if nviews > 1:
            v = int(oview[0])
            draw_view(views[v], obox[oview == v].numpy(),
                      [(p[0], p[1]) for i, p in enumerate(pts) if int(oview[i // len(g)]) == v],
                      f"{tag} view{v} (measure) objs={int((oview==v).sum())}",
                      OUTDIR / f"{tag}_view{v}.png")
            big, size = zoom_region(views[v], obox[0].numpy(),
                                    path=OUTDIR / f"{tag}_region0.png")
            made.append((str(OUTDIR / f"{tag}_region0.png"), size))
            print(f"  {tag}: sampled region is {size[0]}x{size[1]} VIEW px")
        n += 1
    return made


def main():
    runtime = H.load_runtime("cpu")
    print("=== PRODUCTION ===", flush=True)
    prod = H.realpdf_scores("validation")
    dump(runtime, H.realpdf_resolver(), prod[0][1], "prod", take=2)
    print("=== SOURCE ===", flush=True)
    src = H.source_scores(2, split="validation")
    dump(runtime, H.source_resolver(), src[0], "src", take=2)
    print("wrote", OUTDIR)


if __name__ == "__main__":
    main()
