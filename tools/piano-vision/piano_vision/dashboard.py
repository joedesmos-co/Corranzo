"""Persisted training dashboard state and independent local web server."""

from __future__ import annotations

import json
import os
import resource
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def process_memory_bytes():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def device_memory(device):
    if device.type == "mps" and hasattr(torch, "mps"):
        try:
            return {
                "allocated_bytes": int(torch.mps.current_allocated_memory()),
                "driver_bytes": int(torch.mps.driver_allocated_memory()),
            }
        except RuntimeError:
            pass
    if device.type == "cuda":
        return {
            "allocated_bytes": int(torch.cuda.memory_allocated(device)),
            "reserved_bytes": int(torch.cuda.memory_reserved(device)),
        }
    return {"process_peak_bytes": process_memory_bytes()}


class DashboardStore:
    def __init__(self, run_dir: Path, run_id=None):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.run_dir / "dashboard-state.json"
        self.history_path = self.run_dir / "metric-history.jsonl"
        self.lock = threading.Lock()
        if not self.state_path.is_file():
            self.write({
                "schema_version": 1,
                "title": "PIANO VISION TRAINING",
                "run_id": run_id or self.run_dir.name,
                "state": "INITIALIZING",
                "epoch": 0,
                "epochs": 0,
                "overall_percent": 0.0,
                "examples_seen": 0,
                "examples_total": None,
                "train_loss": None,
                "validation_loss": None,
                "learning_rate": None,
                "metrics": {},
                "epoch_time_seconds": None,
                "elapsed_seconds": 0.0,
                "eta_seconds": None,
                "best_checkpoint": None,
                "latest_checkpoint": None,
                "device": None,
                "memory": {},
                "full_training": "BLOCKED — DATASET BUILD IN PROGRESS",
                "native_batch": None,
                "accumulation": None,
                "precision": None,
                "rolling_ex_per_s": None,
                "sustained_ex_per_s": None,
                "step_seconds": None,
                "milestones": [],
                "next_milestone": None,
                "time_to_next_milestone_seconds": None,
                "updated_at": utc_now(),
            })

    def read(self):
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def write(self, state):
        with self.lock:
            value = dict(state)
            value["updated_at"] = utc_now()
            partial = self.state_path.with_suffix(".json.partial")
            partial.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            os.replace(partial, self.state_path)
        return value

    def update(self, **changes):
        state = self.read()
        state.update(changes)
        return self.write(state)

    def append_history(self, record):
        with self.lock:
            with self.history_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({**record, "recorded_at": utc_now()}, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())


def serve_dashboard(run_dir: Path, html_path: Path, host="127.0.0.1", port=8774):
    store = DashboardStore(run_dir)
    html = Path(html_path).read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path in {"/", "/index.html"}:
                payload, content_type = html, "text/html; charset=utf-8"
            elif self.path == "/api/state":
                payload, content_type = json.dumps(store.read(), sort_keys=True).encode(), "application/json"
            elif self.path == "/api/history":
                payload = store.history_path.read_bytes() if store.history_path.is_file() else b""
                content_type = "application/x-ndjson"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer((host, int(port)), Handler)
    print(f"Piano Vision dashboard: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
