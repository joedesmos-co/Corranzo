#!/usr/bin/env python3
"""Local path setup, launch control, and persisted factory dashboard."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from factory import Factory
from input_setup import INPUT_NAMES, InputSetup, native_choose_file


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--work-dir", type=Path, required=True)
    result.add_argument("--csv", type=Path)
    result.add_argument("--pdf-archive", type=Path)
    result.add_argument("--mxl-archive", type=Path)
    result.add_argument("--subset-paths", type=Path)
    result.add_argument("--model-contract", type=Path,
                        default=Path("tmp/campaign/piano-vision-phase212y/factory-model-contract.json"))
    result.add_argument("--disk-floor-gib", type=float, default=20.0)
    result.add_argument("--host", default="127.0.0.1")
    result.add_argument("--port", type=int, default=8765)
    return result


def make_handler(args):
    html_path = Path(__file__).with_name("dashboard") / "index.html"
    setup = InputSetup(args.work_dir, getattr(args, "model_contract", None), getattr(args, "disk_floor_gib", 20.0))
    initial = setup.load().get("paths", {})
    cli_paths = {
        "metadata": getattr(args, "csv", None),
        "pdfArchive": getattr(args, "pdf_archive", None),
        "mxlArchive": getattr(args, "mxl_archive", None),
        "subsetPaths": getattr(args, "subset_paths", None),
    }
    if any(cli_paths.values()):
        initial = setup.save({key: value or initial.get(key, "") for key, value in cli_paths.items()})["paths"]
    launched = {"process": None, "log": None, "preflight": None, "preflightLog": None}

    def factory_from_setup():
        paths = setup.load().get("paths", {})
        placeholder = Path(args.work_dir) / ".input-not-configured"
        return Factory(
            args.work_dir,
            paths.get("metadata") or placeholder,
            paths.get("pdfArchive") or placeholder,
            paths.get("mxlArchive") or placeholder,
            free_floor_gib=getattr(args, "disk_floor_gib", 20.0),
        )

    def persist_input_validation(report):
        factory = factory_from_setup()
        try:
            factory.set_state("input_validation", json.dumps(report, sort_keys=True))
            if report.get("metadataRows") is not None:
                factory.set_state("metadata_total_rows", str(report["metadataRows"]))
        finally:
            factory.close()
        return report

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/status":
                factory = factory_from_setup()
                try:
                    payload = json.dumps(factory.status(), sort_keys=True).encode()
                finally:
                    factory.close()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
            elif self.path == "/api/setup":
                payload = json.dumps({"config": setup.load(), "modelContract": setup.model_status(), "expected": INPUT_NAMES}, sort_keys=True).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
            elif self.path in {"/", "/index.html"}:
                payload = html_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(payload)
            else:
                self.send_error(404)

        def _json_body(self):
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length) or b"{}")

        def _send_json(self, value, status=200):
            payload = json.dumps(value, sort_keys=True).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            route = urlparse(self.path)
            if route.path == "/api/inputs":
                self._send_json(setup.save(self._json_body().get("paths", {})))
            elif route.path == "/api/validate-inputs":
                self._send_json(persist_input_validation(setup.validate(include_fingerprint=True)))
            elif route.path == "/api/choose":
                key = parse_qs(route.query).get("kind", [""])[0]
                if key not in INPUT_NAMES:
                    self._send_json({"error": "INVALID_INPUT_KIND"}, 400)
                    return
                chosen = native_choose_file(f"Choose {INPUT_NAMES[key]}")
                if not chosen:
                    self._send_json({"cancelled": True})
                    return
                paths = setup.load().get("paths", {})
                paths[key] = chosen
                setup.save(paths)
                self._send_json({"cancelled": False, "kind": key, "path": chosen})
            elif route.path == "/api/preflight":
                admission = persist_input_validation(setup.validate(include_fingerprint=False))
                inputs_ready = admission["state"] == "READY" and admission["modelContract"]["valid"]
                if not inputs_ready:
                    self._send_json({"launched": False, "reason": "INPUTS_OR_MODEL_NOT_READY"}, 409)
                    return
                running = launched["preflight"]
                if running is not None and running.poll() is None:
                    self._send_json({"launched": False, "reason": "PREFLIGHT_ALREADY_RUNNING", "pid": running.pid}, 409)
                    return
                paths = setup.load()["paths"]
                log_path = Path(args.work_dir).resolve() / "preflight.log"
                log_stream = open(log_path, "ab", buffering=0)
                command = [
                    sys.executable, str(Path(__file__).with_name("cli.py")),
                    "--work-dir", str(Path(args.work_dir).resolve()),
                    "--csv", paths["metadata"], "--pdf-archive", paths["pdfArchive"],
                    "--mxl-archive", paths["mxlArchive"], "--subset-paths", paths["subsetPaths"],
                    "--model-contract", str(Path(args.model_contract).resolve()),
                    "--free-floor-gib", str(getattr(args, "disk_floor_gib", 20.0)), "preflight",
                ]
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log_stream,
                                           stderr=subprocess.STDOUT, start_new_session=True)
                if launched["preflightLog"] is not None:
                    launched["preflightLog"].close()
                launched.update(preflight=process, preflightLog=log_stream)
                self._send_json({"launched": True, "pid": process.pid, "log": str(log_path)})
            elif route.path in {"/api/pause", "/api/resume"}:
                factory = factory_from_setup()
                try:
                    self._send_json(factory.pause() if route.path.endswith("pause") else factory.resume())
                finally:
                    factory.close()
            elif route.path == "/api/build":
                admission = setup.validate(include_fingerprint=False)
                factory = factory_from_setup()
                try:
                    preflight_ready = factory.get_state("preflight_state") == "COMPLETE" and factory.db.execute("SELECT COUNT(*) FROM build_plan").fetchone()[0] > 0
                finally:
                    factory.close()
                reasons = list(admission["buildDisabledReasons"])
                if not preflight_ready:
                    reasons.append("CORPUS_PREFLIGHT_REQUIRED")
                if reasons:
                    self._send_json({"launched": False, "reasons": reasons}, 409)
                    return
                running = launched["process"]
                if running is not None and running.poll() is None:
                    self._send_json({"launched": False, "reason": "BUILD_ALREADY_RUNNING", "pid": running.pid}, 409)
                    return
                paths = setup.load()["paths"]
                log_path = Path(args.work_dir).resolve() / "full-build.log"
                log_stream = open(log_path, "ab", buffering=0)
                command = [
                    sys.executable, str(Path(__file__).with_name("full_pipeline.py")),
                    "--work-dir", str(Path(args.work_dir).resolve()),
                    "--csv", paths["metadata"],
                    "--pdf-archive", paths["pdfArchive"],
                    "--mxl-archive", paths["mxlArchive"],
                    "--subset-paths", paths["subsetPaths"],
                    "--model-contract", str(Path(args.model_contract).resolve()),
                    "--disk-floor-gib", str(getattr(args, "disk_floor_gib", 20.0)),
                ]
                process = subprocess.Popen(
                    command, stdin=subprocess.DEVNULL, stdout=log_stream,
                    stderr=subprocess.STDOUT, start_new_session=True,
                )
                if launched["log"] is not None:
                    launched["log"].close()
                launched.update(process=process, log=log_stream)
                self._send_json({"launched": True, "pid": process.pid, "log": str(log_path)})
            else:
                self.send_error(404)

        def log_message(self, *_):
            return

    return Handler


def main():
    args = parser().parse_args()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(args))
    print(f"Factory dashboard: http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
