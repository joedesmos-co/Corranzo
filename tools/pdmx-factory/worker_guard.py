"""Non-invasive legacy-worker guard, plus a lock for new full-pipeline runs."""

import fcntl
import os
import shlex
import sqlite3
import subprocess
from contextlib import contextmanager, closing
from pathlib import Path


def assert_no_legacy_worker(work_dir):
    root = Path(work_dir).resolve()
    probe = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True, text=True, check=True)
    for line in probe.stdout.splitlines():
        try:
            pid, command = line.strip().split(None, 1)
            args = shlex.split(command)
        except ValueError:
            continue
        if int(pid) == os.getpid():
            continue
        if not any(arg.endswith('/full_pipeline.py') or arg == 'full_pipeline.py' for arg in args[:3]):
            continue
        if '--work-dir' in args:
            other = args[args.index('--work-dir') + 1]
            if Path(other).resolve() == root or Path(other).name == root.name:
                raise RuntimeError(f'FACTORY_WORKER_STILL_PRESENT: PID {pid}; let the old worker exit before resuming')


def physical_complete(work_dir):
    path = Path(work_dir).resolve() / 'factory.sqlite3'
    if not path.is_file():
        return False
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        state = dict(db.execute('SELECT key,value FROM state'))
        total = db.execute('SELECT COUNT(*) FROM build_plan').fetchone()[0]
        unfinished = db.execute("""SELECT COUNT(*) FROM build_plan p LEFT JOIN scores s USING(score_id)
            WHERE s.score_id IS NULL OR s.job_state NOT IN ('COMPLETE','REVIEW','REJECTED')""").fetchone()[0]
        canonical = db.execute('SELECT COUNT(*) FROM canonical').fetchone()[0]
        expected = db.execute("SELECT COUNT(*) FROM build_plan p JOIN scores s USING(score_id) WHERE s.job_state IN ('COMPLETE','REVIEW')").fetchone()[0]
        return bool(total and not unfinished and canonical == expected
                    and state.get('preflight_state') == 'COMPLETE'
                    and int(state.get('metadata_cursor', 0)) >= int(state.get('metadata_total_rows', 1)))


@contextmanager
def pipeline_guard(work_dir):
    assert_no_legacy_worker(work_dir)
    root = Path(work_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'full-pipeline.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
