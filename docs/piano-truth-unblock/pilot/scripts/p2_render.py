#!/usr/bin/env python3
"""P2/P3/P4 — render, exact-join, quarantine the selected PDMX pilot.

For each selected score:
  data/mxl/<sid>.mxl
    -> Verovio (pinned) -> MEI + SVG (per page)
    -> exact id join + semantic state join
    -> source-identity check (music21) + dropped-feature detection
    -> data/render/<sid>/{score.mei,page-XX.svg,meta.json}
    -> data/objects/<sid>.objects.json.gz
    -> data/render/status.jsonl (append-only; PASS or QUARANTINED:<reason>)

Idempotent: a score already PASS with the same source hash is skipped unless
--force is given.

Usage:
  python3 p2_render.py --limit 20                 # smoke test
  python3 p2_render.py --workers 3                # full pilot
  python3 p2_render.py --check-mxl                # fetch coverage report
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pv_pipeline as pv  # noqa: E402

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
DATA = PILOT / "data"
RENDER = DATA / "render"
OBJECTS = DATA / "objects"
STATUS = RENDER / "status.jsonl"


def load_selection():
    m = json.loads((PILOT / "manifests" / "selection.json").read_text())
    return m["scores"]


def load_status():
    done = {}
    if STATUS.is_file():
        for line in STATUS.read_text().splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
                done[rec["source_id"]] = rec
            except Exception:
                continue
    return done


def classify(result):
    if result.get("error"):
        return "QUARANTINED:" + result["error_kind"]
    if result["dropped_features"]:
        feats = ",".join(sorted(result["dropped_features"]))
        return f"QUARANTINED:{pv.Q_UNSUPPORTED}:{feats}"
    if result["id_join_missing_nonstate"]:
        missing = result["id_join_missing_nonstate"]
        if set(missing) == {"artic"} and result.get("missing_artic_types") and \
                set(result["missing_artic_types"]) <= pv.UNRENDERED_ARTIC:
            return f"QUARANTINED:{pv.Q_UNSUPPORTED}:articulation:{','.join(sorted(result['missing_artic_types']))}"
        return f"QUARANTINED:{pv.Q_ID_JOIN}"
    if result["state_mismatch"]:
        return f"QUARANTINED:{pv.Q_STATE}"
    identity = result["identity"]
    if identity.get("error"):
        return f"QUARANTINED:{pv.Q_IDENTITY_UNVERIFIABLE}"
    if not identity["ok"]:
        return f"QUARANTINED:{pv.Q_IDENTITY}"
    if result["geometry_bad"]:
        return f"QUARANTINED:{pv.Q_GEOMETRY}"
    return "PASS"


def process_one(spec, force=False):
    sid = spec["source_id"]
    mxl = DATA / "mxl" / f"{sid}.mxl"
    outdir = RENDER / sid
    result = {"source_id": sid, "title": spec.get("title", ""),
              "composer": spec.get("composer", ""), "license": spec.get("license")}
    if not mxl.is_file():
        result.update({"status": f"QUARANTINED:{pv.Q_SOURCE}:missing_mxl",
                       "error": "missing mxl", "error_kind": pv.Q_SOURCE})
        return result, None
    result["source_sha256"] = pv.sha256_file(mxl)
    result["source_bytes"] = mxl.stat().st_size

    if not force and outdir.joinpath("meta.json").is_file():
        try:
            prev = json.loads(outdir.joinpath("meta.json").read_text())
            if prev.get("source_sha256") == result["source_sha256"] and prev.get("status") == "PASS":
                result.update(prev)
                result["reused"] = True
                return result, None
        except Exception:
            pass

    try:
        xml_text = pv.musicxml_text(mxl)
    except Exception as e:
        result.update({"status": f"QUARANTINED:{pv.Q_SOURCE}", "error": str(e)[:200],
                       "error_kind": pv.Q_SOURCE})
        return result, None

    try:
        tk, mei, svgs, pages = pv.render_score(mxl)
    except Exception as e:
        result.update({"status": f"QUARANTINED:{pv.Q_IMPORT}", "error": str(e)[:200],
                       "error_kind": pv.Q_IMPORT})
        return result, None

    try:
        records, counts, missing_ids, measure_order = pv.parse_mei(mei)
        all_bbox = {}
        all_ids = set()
        for pg, svg in enumerate(svgs, 1):
            for eid, bb in pv.svg_bboxes(svg).items():
                bb["page"] = pg
                all_bbox[eid] = bb
            all_ids |= pv.svg_group_ids(svg)
        by_tag, joined, missing = pv.id_join(records, all_ids)
        state = pv.state_join(tk, svgs, records, measure_order)
        identity = pv.source_identity_check(mxl, records, counts, measure_order)
        dropped = pv.dropped_features(xml_text, mei)
        geometry = pv.svg_page_geometry(svgs, all_bbox)
    except Exception as e:
        result.update({"status": f"QUARANTINED:{pv.Q_SOURCE}:pipeline_exception",
                       "error": f"{e}\n{traceback.format_exc()[:400]}",
                       "error_kind": pv.Q_SOURCE})
        return result, None

    missing_nonstate = {t: n for t, n in missing.items()
                        if t not in pv.STATE_TAGS and t != "mRest" and n}
    missing_artic_types = sorted({r.get("artic") for r in records
                                  if r["tag"] == "artic" and r["id"] not in all_ids
                                  and r.get("artic")})
    unrendered_mrest = missing.get("mRest", 0)
    state_mismatch = sum(v["mismatch"] for v in state.values())
    state_unresolved = sum(v.get("unresolved", 0) for v in state.values())
    state_rendered = sum(v["rendered"] for v in state.values())
    state_resolved = sum(v["matched"] + v["courtesy_matched"] + v["within_measure_matched"]
                         for v in state.values())

    # geometry validity: every note bbox positive area and inside its page
    # (bboxes are in content units; page bounds must be converted to units)
    page_sizes = {p["page"]: (p["width_units"], p["height_units"]) for p in geometry}
    geometry_bad = 0
    for r in records:
        if r["tag"] != "note" or r["id"] not in all_bbox:
            continue
        bb = all_bbox[r["id"]]
        if bb["w"] <= 0 or bb["h"] <= 0:
            geometry_bad += 1
            continue
        w, h = page_sizes.get(bb["page"], (None, None))
        if w and h and (bb["x"] < -1 or bb["y"] < -1 or bb["x"] + bb["w"] > w + 1 or bb["y"] + bb["h"] > h + 1):
            geometry_bad += 1

    objects = pv.build_objects(tk, records, svgs, all_bbox, all_ids, state)
    canonical = pv.canonical_mei(mei)

    result.update({
        "pages": pages,
        "verovio_version": tk.getVersion(),
        "xml_id_seed": pv.XML_ID_SEED,
        "mei_sha256": pv.sha256_bytes(canonical.encode()),
        "mei_canonicalized": True,
        "svg_sha256": pv.sha256_bytes("".join(svgs).encode()),
        "mei_counts": dict(counts),
        "elements_without_id": len(missing_ids),
        "id_join_missing_nonstate": missing_nonstate,
        "id_join_ok_nonstate": not missing_nonstate,
        "missing_artic_types": missing_artic_types,
        "unrendered_mrest": unrendered_mrest,
        "state_join": state,
        "state_rendered": state_rendered,
        "state_resolved": state_resolved,
        "state_unresolved": state_unresolved,
        "state_mismatch": state_mismatch,
        "identity": identity,
        "dropped_features": dropped,
        "geometry_bad": geometry_bad,
        "page_geometry": geometry,
        "object_count": len(objects),
        "note_count": counts.get("note", 0),
    })
    result["status"] = classify(result)

    # write outputs
    outdir.mkdir(parents=True, exist_ok=True)
    outdir.joinpath("score.mei").write_text(mei)
    for i, svg in enumerate(svgs, 1):
        outdir.joinpath(f"page-{i:02d}.svg").write_text(svg)
    OBJECTS.mkdir(parents=True, exist_ok=True)
    obj_bytes = json.dumps(objects, separators=(",", ":")).encode()
    with gzip.open(OBJECTS / f"{sid}.objects.json.gz", "wb") as f:
        f.write(obj_bytes)
    result["objects_sha256"] = pv.sha256_bytes(obj_bytes)
    result["objects_bytes"] = len(obj_bytes)
    outdir.joinpath("meta.json").write_text(json.dumps(result, indent=1))
    return result, objects


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated source ids")
    ap.add_argument("--check-mxl", action="store_true")
    args = ap.parse_args()

    scores = load_selection()
    scores = scores[args.offset:]
    if args.only:
        want = set(args.only.split(","))
        scores = [s for s in scores if s["source_id"] in want]
    if args.limit:
        scores = scores[: args.limit]

    if args.check_mxl:
        have = sum(1 for s in scores if (DATA / "mxl" / f"{s['source_id']}.mxl").is_file())
        print(f"[p2] mxl present: {have}/{len(scores)}")
        return

    RENDER.mkdir(parents=True, exist_ok=True)
    done = load_status()
    todo = [s for s in scores if args.force or done.get(s["source_id"], {}).get("status") != "PASS"]
    print(f"[p2] selected {len(scores)}; already PASS {len(scores)-len(todo)}; to process {len(todo)}",
          file=sys.stderr)

    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process_one, s, args.force): s for s in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                res, _ = fut.result()
            except Exception as e:
                spec = futs[fut]
                res = {"source_id": spec["source_id"], "status": f"QUARANTINED:{pv.Q_SOURCE}:worker_crash",
                       "error": str(e)[:200], "error_kind": pv.Q_SOURCE}
            results.append(res)
            if i % 25 == 0 or i == len(todo):
                print(f"[p2] {i}/{len(todo)} done", file=sys.stderr)

    with open(STATUS, "a") as f:
        for res in results:
            f.write(json.dumps(res) + "\n")

    status_counts = {}
    for res in results:
        key = res["status"].split(":")[0] if res["status"].startswith("QUARANTINED") else "PASS"
        if res["status"].startswith("QUARANTINED:"):
            parts = res["status"].split(":")
            key = ":".join(parts[:3]) if len(parts) > 2 else parts[1]
        status_counts[key] = status_counts.get(key, 0) + 1
    print("[p2] batch status:", json.dumps(status_counts, indent=1), file=sys.stderr)


if __name__ == "__main__":
    main()
