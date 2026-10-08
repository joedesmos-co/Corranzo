#!/usr/bin/env python3
"""
Basic Pitch batch transcription for the Corranzo real-audio benchmark.

Loads the ICASSP-2022 model ONCE (CoreML on Apple Silicon, no TensorFlow
needed) and transcribes every clip, so per-clip timings reflect warmed
inference rather than model loading.

Usage:
  /tmp/corranzo-basicpitch-venv/bin/python scripts/mic-basicpitch-transcribe.py \
    --manifest benchmarks/mic-real/manifest.json \
    --clips benchmarks/mic-real/clips \
    --out tmp/basicpitch/notes.json [--only <substring>] [--extra <id=path> ...]

Output JSON: { clipId: { notes: [{start, end, midi}], inferMs, runtime } }
"""
import argparse
import json
import os
import time

from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import Model, predict


def transcribe(model, path, onset_threshold=0.5, frame_threshold=0.3):
    started = time.perf_counter()
    _model_output, _midi_data, note_events = predict(
        path, model, onset_threshold=onset_threshold, frame_threshold=frame_threshold,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    notes = [
        {"start": round(float(n[0]), 3), "end": round(float(n[1]), 3), "midi": int(n[2])}
        for n in note_events
    ]
    return notes, elapsed_ms


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--clips", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", default=None)
    parser.add_argument("--onset-threshold", type=float, default=0.5)
    parser.add_argument("--frame-threshold", type=float, default=0.3)
    parser.add_argument("--extra", nargs="*", default=[],
                        help="Additional id=path pairs (e.g. synthetic controls)")
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as handle:
        manifest = json.load(handle)

    model = Model(ICASSP_2022_MODEL_PATH)
    print(f"model loaded: {ICASSP_2022_MODEL_PATH}", flush=True)

    # One throwaway warmup so timings exclude first-compile effects.
    warmup = manifest["clips"][0]
    transcribe(model, os.path.join(args.clips, os.path.basename(warmup["audio"]["file"])))

    results = {}
    jobs = []
    for clip in manifest["clips"]:
        if args.only and args.only not in clip["id"]:
            continue
        jobs.append((clip["id"], os.path.join(args.clips, os.path.basename(clip["audio"]["file"]))))
    for extra in args.extra:
        clip_id, path = extra.split("=", 1)
        if args.only and args.only not in clip_id:
            continue
        jobs.append((clip_id, path))

    for clip_id, path in jobs:
        notes, elapsed_ms = transcribe(
            model, path,
            onset_threshold=args.onset_threshold,
            frame_threshold=args.frame_threshold,
        )
        results[clip_id] = {"notes": notes, "inferMs": round(elapsed_ms, 1)}
        print(f"{clip_id}: {len(notes)} notes, {elapsed_ms:.0f} ms", flush=True)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=1)
    print(f"wrote {args.out}", flush=True)


if __name__ == "__main__":
    main()
