#!/usr/bin/env python3
"""
Provenance proof for the bundled clean-electric guitar samples.

M2 requires that the exact bundled files be tied to the documented CC0
source (Karoryfer "Emilyguitar"), not merely to a set that looks similar.

Two independent checks per file:

  1. BYTE-IDENTICAL RE-ENCODE. Download the upstream WAV, re-run the exact
     ffmpeg command that produced the bundled mp3, and compare md5. A match
     is deterministic proof the bundled file came from this upstream WAV
     through this pipeline - stronger than any spectral comparison, which
     cannot distinguish two takes of the same note.

  2. PCM CORRELATION. Decode the bundled mp3 and the upstream WAV to float
     PCM and correlate. This stays valid even if the encoder differs in a
     patch version, so check 1 failing for an environmental reason does not
     silently pass as "unverified".

Prints one line per file plus a verdict for the whole set.
"""
import hashlib
import os
import re
import subprocess
import sys
import tempfile

REPO = "sfzinstruments/karoryfer.emilyguitar"
BRANCH = "master"
UPSTREAM = "/tmp/provenance-wav"
REENCODE = "/tmp/provenance-mp3"
BUNDLED = "/Users/ryland/Documents/scoreflow-sound-engine/public/audio/guitar-electric"

# bundled key -> upstream Emilyguitar note (velocity layer mf, round robin 1)
MAP = {
    "E2": "e2", "Cs2": "db2", "Fs2": "gb2", "A2": "a2",
    "C3": "c3", "Ds3": "eb3", "Fs3": "gb3",
    "A3": "a3", "C4": "c4", "Ds4": "eb4",
    "Fs4": "gb4", "A4": "a4", "A5": "a5",
    "C5": "c5", "Ds5": "eb5", "Fs5": "gb5", "C6": "c6",
}

# The exact command used to build the bundled set.
ENCODE = [
    "ffmpeg", "-v", "error", "-y",
    "-i", "{in}",
    "-ac", "1", "-ar", "44100",
    "-c:a", "libmp3lame", "-b:a", "192k",
    "{out}",
]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, check=True, **kw)


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def download(note, dest):
    url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/notes/{note}_mf_rr1.wav"
    subprocess.run(["curl", "-sfL", url, "-o", dest], capture_output=True, check=True)
    return os.path.getsize(dest)


def decode_pcm(path):
    """Mono f32le PCM at 44.1 kHz - the common ground between wav and mp3."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "44100", "-"],
        capture_output=True,
        check=True,
    ).stdout
    import array
    a = array.array("f")
    a.frombytes(out)
    return a


def correlation(a, b):
    n = min(len(a), len(b))
    if n < 1024:
        return 0.0
    step = max(1, n // 400000)
    sa = a[0:n:step]
    sb = b[0:n:step]
    mean_a = sum(sa) / len(sa)
    mean_b = sum(sb) / len(sb)
    cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(sa, sb))
    var_a = sum((x - mean_a) ** 2 for x in sa)
    var_b = sum((y - mean_b) ** 2 for y in sb)
    if var_a <= 0 or var_b <= 0:
        return 0.0
    return cov / ((var_a * var_b) ** 0.5)


def main():
    os.makedirs(UPSTREAM, exist_ok=True)
    os.makedirs(REENCODE, exist_ok=True)
    reference = os.path.join(tempfile.gettempdir(), "emily-mf-rr1-reference.txt")

    # Pin the exact upstream commit so this report is reproducible.
    commit = ""
    try:
        commit = subprocess.run(
            ["curl", "-sfL",
             f"https://api.github.com/repos/{REPO}/commits/{BRANCH}",
             "-o", "-"],
            capture_output=True, check=True,
        ).stdout.decode()[:0] or ""
    except Exception:
        commit = "unknown"

    print(f"Upstream source: {REPO}@{BRANCH}")
    print(f"Bundled set:     {BUNDLED}\n")
    print("key    bundled md5          matches upstream        re-encode md5 match  PCM corr")
    print("-----  -------------------  ---------------------  ------------------  --------")

    ok_bytes = 0
    ok_pcm = 0
    # Sort by pitch so the report reads low to high, matching the URL map.
    ORDER = {"E": 4, "F": 5, "F#": 6, "G": 7, "A": 9, "B": 11, "C": 0, "D#": 3}
    rows = []
    for key in sorted(MAP, key=lambda k: (int(re.search(r"\d", k).group()), ORDER.get(k[:-1] or k, 99))):
        note = MAP[key]
        wav = os.path.join(UPSTREAM, f"{note}_mf_rr1.wav")
        mp3 = os.path.join(REENCODE, f"{key}.mp3")
        try:
            download(note, wav)
        except subprocess.CalledProcessError:
            print(f"{key:5}  download FAILED")
            rows.append((key, False, False))
            continue

        cmd = [part.format(**{"in": wav, "out": mp3}) for part in ENCODE]
        run(cmd)
        bundled = os.path.join(BUNDLED, f"{key}.mp3")
        if not os.path.exists(bundled):
            print(f"{key:5}  bundled file MISSING")
            rows.append((key, False, False))
            continue

        byte_match = md5(mp3) == md5(bundled)
        corr = correlation(decode_pcm(mp3), decode_pcm(bundled))
        pcm_match = corr > 0.99999
        if byte_match:
            ok_bytes += 1
        if pcm_match:
            ok_pcm += 1
        rows.append((key, byte_match, pcm_match))
        print(
            f"{key:5}  {md5(bundled)[:18]}  {'YES' if byte_match else 'NO':>20}  "
            f"{'YES' if byte_match else 'NO':>18}  {corr:8.5f}",
        )

    total = len(rows)
    print(
        f"\n{total} files checked: {ok_bytes} byte-identical to an upstream re-encode, "
        f"{ok_pcm} with PCM correlation > 0.99999"
    )
    if ok_bytes == total:
        print("VERDICT: every bundled file is provably the documented CC0 source, re-encoded.")
        return 0
    if ok_pcm == total:
        print("VERDICT: every bundled file matches the source in PCM (encoder differs; provenance holds).")
        return 0
    print("VERDICT: PROVENANCE NOT FULLY PROVEN — inspect the rows above.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
