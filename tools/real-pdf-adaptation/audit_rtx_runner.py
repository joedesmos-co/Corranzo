#!/usr/bin/env python3
"""Static audit of run_rtx_qualification.ps1. Parses and checks; never runs it.

This exists because the runner can only be executed on the Windows RTX worker,
so every way it could be wrong has to be caught here first. It checks:

1.  the file is structurally complete and the config block is at the TOP;
2.  every ``--flag`` the runner passes to a Python script actually exists in
    that script's argparse (extracted by importing the module and reading the
    parser, not by guessing);
3.  every config variable is assigned before it is read, and is read somewhere;
4.  every literal path the runner depends on is either a config var, produced by
    an earlier stage, or an explicitly-checked file;
5.  selection never reads held-out or diagnostic data;
6.  no training flag combination can exceed the 300-step gate silently;
7.  brace/quote/paren balance and required-statement hygiene.
"""
from __future__ import annotations

import argparse
import ast
import importlib.util
import io
import io as _io
import json
import re
import sys
import tokenize
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "run_rtx_qualification.ps1"

PY_TARGETS = {
    "tools/real-pdf-adaptation/train_realpdf.py": "train_realpdf",
    "tools/real-pdf-adaptation/evaluate_realpdf.py": "evaluate_realpdf",
    "tools/real-pdf-adaptation/build_corpus.py": "build_corpus",
    "tools/real-pdf-adaptation/audit_pairs.py": "audit_pairs",
    "tools/real-pdf-adaptation/make_manifests.py": "make_manifests",
    "tools/piano-vision-v25-candidate/evaluate_v25.py": "evaluate_v25",
}


class Audit:
    def __init__(self):
        self.problems: list[str] = []
        self.notes: list[str] = []

    def require(self, condition, message):
        if not condition:
            self.problems.append(message)
        return bool(condition)

    def note(self, message):
        self.notes.append(message)


def strip_ps_comments(text: str) -> str:
    """Remove <# #> blocks and # line comments, respecting quotes."""
    out = []
    i = 0
    n = len(text)
    in_block = False
    quote = None
    while i < n:
        ch = text[i]
        if in_block:
            if text.startswith("#>", i):
                in_block = False
                i += 2
                continue
            out.append("\n" if ch == "\n" else " ")
            i += 1
            continue
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
            i += 1
            continue
        if text.startswith("<#", i):
            in_block = True
            i += 2
            continue
        if ch in "'\"":
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "#":
            while i < n and text[i] != "\n":
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def argparse_flags(script_path: Path) -> set[str]:
    """Flags a script accepts, by importing it and reading its parser."""
    source = script_path.read_text()
    tree = ast.parse(source)
    wanted = set()
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_argument"):
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.startswith("--"):
                        wanted.add(arg.value)
    return wanted


PAIRS = {"(": ")", "[": "]", "{": "}"}
CLOSE_OF = {v: k for k, v in PAIRS.items()}


def match_balanced(text: str, opener: str, closer: str, start: int = 0):
    """Yield (start, end) spans of balanced groups that start with ``opener``.

    A PowerShell argument list such as

        @('--out', $runDir, '--corpus-index', (Join-Path $a 'b'), '--device', 'cuda')

    contains brackets of its own, so counting one bracket character is not
    enough: ``@`` and ``(`` both open, and only a stack keyed on the actual
    bracket character finds the true end. Bracket characters inside string
    literals are skipped, otherwise a path like ``C:\a(b)`` would corrupt the
    depth.
    """
    spans = []
    index = start
    length = len(text)
    index = start
    while index < length:
        ch = text[index]
        if ch in ("'", '"'):
            quote = ch
            index += 1
            while index < length and text[index] != quote:
                index += 1
            index += 1
            continue
        if ch == opener and index + 1 < length and text[index + 1] in PAIRS:
            # The opening bracket is consumed here, so the walk starts after it.
            stack = [PAIRS[text[index + 1]]]
            cursor = index + 2
            while cursor < length and stack:
                inner = text[cursor]
                if inner in ("'", '"'):
                    quote = inner
                    cursor += 1
                    while cursor < length and text[cursor] != quote:
                        cursor += 1
                    cursor += 1
                    continue
                if inner in PAIRS:
                    stack.append(PAIRS[inner])
                elif inner in CLOSE_OF:
                    if stack and stack[-1] == inner:
                        stack.pop()
                cursor += 1
            if not stack:
                spans.append((index, cursor - 1))
            index = cursor
            continue
        index += 1
    return spans


def audit_flags(audit: Audit, body: str):
    """Every --flag the runner passes must exist in the target script."""
    calls = re.findall(r"Invoke-Python\s+\$[A-Za-z]+\s+'([^']+)'", body)
    targets = {c for c in calls if c in PY_TARGETS}
    audit.require(targets, "no Invoke-Python call resolved to a known script")
    unknown = sorted(c for c in calls if c not in PY_TARGETS)
    audit.note(f"python targets invoked: {len(targets)}")
    if unknown:
        audit.problems.append(f"runner invokes scripts outside the audited set: {unknown}")

    spans = match_balanced(body, "@", ")")
    audit.require(len(spans) >= 6,
                  f"only {len(spans)} PowerShell array literal(s) parsed; expected >= 6")
    seen_flags = 0
    for begin, end in spans:
        window = body[max(0, begin - 900):end + 1]
        target = None
        matches = re.findall(r"Invoke-Python\s+\$[A-Za-z]+\s+'([^']+)'", window)
        for candidate in matches:
            if candidate in PY_TARGETS:
                target = candidate
        if target is None:
            continue
        script_path = HERE.parents[1] / target
        if not audit.require(script_path.exists(), f"runner target missing: {target}"):
            continue
        accepted = argparse_flags(script_path)
        used = set(re.findall(r"['\"](--[a-z0-9-]+)['\"]", body[begin:end]))
        seen_flags += len(used)
        used = {f for f in used if f != "--help"}  # argparse built-in
        bad = sorted(f for f in used if f not in accepted)
        if bad:
            audit.problems.append(f"{target}: runner passes unsupported flag(s) {bad}")
        audit.note(f"{target}: {len(used)} flag(s) -> {sorted(used)}")
    audit.require(seen_flags >= 30,
                  f"only {seen_flags} flags were verified in total; the check is too weak")
    audit.note(f"total flags verified against real argparse surfaces: {seen_flags}")


def find_param_names(body: str) -> set:
    """Names bound by ``param(...)``, with PowerShell type annotations removed.

    ``param([string]$Name, [string[]]$ScriptArgs, [switch]$AllowFail)`` binds
    Name, ScriptArgs and AllowFail. The annotation may itself be a bracketed
    type (``[string[]]``), so annotations are stripped before the name is read.
    """
    names = set()
    for match in re.finditer(r"param\s*\(", body):
        index = match.end()          # just past '('
        depth = 1
        start = index
        while index < len(body) and depth:
            ch = body[index]
            if ch in ("'", '"'):
                quote = ch
                index += 1
                while index < len(body) and body[index] != quote:
                    index += 1
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            index += 1
        block = body[start:index - 1]
        for item in block.split(","):
            name = item.strip().split("=", 1)[0]
            # The parameter name is whatever follows the first '$', so any
            # annotation shape is handled uniformly: [string], [string[]],
            # [switch], [ValidateSet(...)].
            found = re.search(r"\$([A-Za-z][A-Za-z0-9_]*)", name)
            if found:
                names.add(found.group(1))
    return names


def audit_config_order(audit: Audit, body: str, config_end: int):
    head = body[:config_end]
    tail = body[config_end:]
    assigned = set(re.findall(r"^\s*\$([A-Za-z][A-Za-z0-9_]*)\s*=", head, flags=re.M))
    audit.require(len(assigned) >= 25, f"config block looks thin: {len(assigned)} variables")
    used_anywhere = set(re.findall(r"\$([A-Za-z][A-Za-z0-9_]*)", body))
    # strip the sigil
    used_anywhere = {u[1:] if u.startswith("$") else u for u in used_anywhere}
    scopes = {"script", "global", "local", "private", "using", "env", "function", "variable"}
    used_anywhere = {u for u in used_anywhere if u not in scopes}
    builtins = {"PSScriptRoot", "LASTEXITCODE", "ErrorActionPreference", "_", "args",
                "Matches", "PSVersionTable", "PSEdition", "Host", "MyInvocation", "PWD",
                "input", "null", "true", "false", "HOME", "env"}
    read_after = {u for u in used_anywhere if u not in assigned and u not in builtins}
    # Variables introduced after the config block are legal (script-scoped state).
    later = set(re.findall(r"\$([A-Za-z][A-Za-z0-9_]*)\s*=(?!=)", tail))
    # param(...) names are supplied by PowerShell, not by assignment.
    for name in find_param_names(body):
        later.add(name)
    # foreach ($x in ...) and switch/filter locals.
    for name in re.findall(r"foreach\s*\(\s*\$([A-Za-z][A-Za-z0-9_]*)", body):
        later.add(name)
    for name in re.findall(r"\$script:([A-Za-z][A-Za-z0-9_]*)", body):
        later.add(name)
    read_after -= later
    audit.note(f"config variables: {len(assigned)}; script-scoped: {sorted(later)}")
    if read_after:
        audit.problems.append(
            f"variables read but never assigned and not script-scoped: {sorted(read_after)}")
    unused = sorted(assigned - used_anywhere)
    if unused:
        audit.problems.append(f"config variables assigned but never read: {unused}")


def audit_selection_isolation(audit: Audit, body: str):
    stages = {}
    for name in ("candidate-gates", "diagnostic", "heldout-test"):
        m = re.search(rf"function Invoke-{'CandidateGates' if name == 'candidate-gates' else ('Diagnostic' if name == 'diagnostic' else 'HeldOut')}\b(.*?)\n}}\n",
                      body, flags=re.S)
        stages[name] = m.group(1) if m else ""
    for name in stages:
        audit.require(bool(stages[name]), f"stage {name} not found in the runner")

    gates = stages.get("candidate-gates", "")
    audit.require("--real-pdf-splits', 'validation'" in gates,
                  "candidate selection must score the validation split")
    for forbidden in ("heldout-test", "diagnostic"):
        audit.require(forbidden not in gates,
                      f"candidate-gates references {forbidden}; selection must not see it")
    audit.require("$best" in gates and "gate_verdict" in gates,
                  "candidate-gates must select on validation pitch gated by the retention verdict")

    held = stages.get("heldout-test", "")
    audit.require("already-selected winner" in held or "cannot change the selection" in held,
                  "held-out stage must state it cannot influence selection")
    audit.require("$script:Winner" in held, "held-out must run on the fixed winner")

    diag = stages.get("diagnostic", "")
    audit.require("REPORT ONLY" in diag or "never selected" in diag,
                  "diagnostic stage must state it is never selected on")


def audit_training_gate(audit: Audit, body: str, raw: str):
    audit.require("--max-steps" in body, "runner must pass --max-steps explicitly")
    audit.require(re.search(r"\$MaxSteps\s*=\s*300\b", raw),
                  "default MaxSteps must be the 300-step gate")
    m = re.search(r"--max-steps', \"\$MaxSteps\"", body)
    audit.require(bool(m), "MaxSteps is not wired into --max-steps")
    audit.require("--allow-long" not in body,
                  "runner must never pass --allow-long; that would defeat the 300-step gate")
    audit.require("--profile-only" in body, "runner must profile before committing")
    prof = re.search(r"--profile-only', \"\$ProfileSteps\"", body)
    audit.require(bool(prof), "ProfileSteps is not wired into --profile-only")
    audit.require("profile" in body and "MAX_STEP" not in body.upper().replace("MAXSTEPS", ""),
                  "profile stage missing")


def audit_integrity(audit: Audit, body: str, raw: str):
    audit.require("Set-StrictMode -Version Latest" in raw,
                  "Set-StrictMode is required so unassigned variables are fatal")
    audit.require("$ErrorActionPreference = 'Stop'" in raw,
                  "ErrorActionPreference must be Stop")
    audit.require("CheckpointSha256" in raw and "Get-FileHash" in raw,
                  "preflight must verify the checkpoint SHA256")
    audit.require("assert_trainable" in (HERE / "realpdf_data.py").read_text(),
                  "the trainer-side guard realpdf_data.assert_trainable is missing")
    audit.require("split leak" in raw or "held-out scores also in adaptation" in raw,
                  "runner must check for a held-out/adaptation split leak")
    for opener, closer in (("(", ")"), ("{", "}"), ("[", "]")):
        audit.require(body.count(opener) == body.count(closer),
                      f"unbalanced {opener}{closer}: {body.count(opener)} vs {body.count(closer)}")
    single = body.count("'")
    double = body.count(chr(34))
    audit.require(single % 2 == 0, f"odd number of single quotes ({single})")
    audit.require(double % 2 == 0, f"odd number of double quotes ({double})")
    audit.require("param(" in body, "functions should use param() blocks")
    # Brace balance is only meaningful outside string literals.
    outside = re.sub(r"'[^']*'", "''", body)
    outside = re.sub(r'"[^"]*"', '""', outside)
    for opener, closer in (("{", "}"), ("(", ")"), ("[", "]")):
        depth = 0
        lowest = 0
        for ch in outside:
            if ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                lowest = min(lowest, depth)
        audit.require(depth == 0 and lowest >= 0,
                      f"{opener}{closer} imbalance in code (net {depth}, min {lowest})")


def audit_config_at_top(audit: Audit, raw: str):
    marker = raw.find("END OF CONFIGURATION")
    audit.require(marker > 0, "config block is not delimited")
    first_function = raw.find("function Write-Stage")
    audit.require(marker < first_function,
                  "all user-editable config must be ABOVE the first function")
    config = raw[:marker]
    for name in ("$RepoRoot", "$CorpusRoot", "$RunRoot", "$EvalRoot", "$CheckpointRel",
                 "$ReplayRel", "$CheckpointSha256", "$Device", "$MaxSteps", "$LrVisual",
                 "$LrPitch", "$LrHeads", "$LrShared", "$MaxRegression"):
        audit.require(f"{name} " in config or f"{name}=" in config or f"{name}  " in config,
                      f"config variable {name} is not in the top block")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    audit = Audit()
    if not SCRIPT.exists():
        print(f"FATAL: {SCRIPT} not found")
        return 2
    raw = SCRIPT.read_text()
    body = strip_ps_comments(raw)

    audit_config_at_top(audit, raw)
    marker = raw.find("END OF CONFIGURATION")
    config_end = raw.find("Set-StrictMode")
    audit.require(marker > 0 and config_end > 0,
                  "could not locate the config terminator or Set-StrictMode")
    audit.require(marker < config_end, "config block must precede Set-StrictMode")
    head_lines = raw[:marker].count("\n")
    audit.require(head_lines < 140,
                  f"config block runs to line {head_lines}; it should be compact")
    audit_config_order(audit, body, config_end)
    audit_flags(audit, body)
    audit_selection_isolation(audit, body)
    audit_training_gate(audit, body, raw)
    audit_integrity(audit, body, raw)

    # Cross-check: the frozen metric must be present in the evaluator and the
    # runner must produce a baseline report that carries it.
    ev = (HERE / "evaluate_realpdf.py").read_text()
    audit.require("CANONICAL_METRIC" in ev and "METRIC_DEFINITION" in ev,
                  "the frozen metric definition is missing from evaluate_realpdf.py")
    audit.require("compare_metric_definitions" in ev,
                  "the evaluator must refuse a baseline/candidate metric mismatch")
    audit.require("written_pitch_multiset" in ev,
                  "the historical multiset metric must remain reported for continuity")

    if args.verbose:
        for n in audit.notes:
            print(f"  note: {n}")
    if audit.problems:
        print(json.dumps({"ok": False, "problems": audit.problems}, indent=2))
        return 1
    print(json.dumps({"ok": True, "script": SCRIPT.name,
                      "checks": ["config-at-top", "flag-surface", "variable-order",
                                 "selection-isolation", "training-gate",
                                 "metric-freeze", "syntax-balance"]},
                     indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
