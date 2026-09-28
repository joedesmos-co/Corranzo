<#
.SYNOPSIS
    V2.5 real-PDF domain-adaptation qualification on the Windows RTX worker.

.DESCRIPTION
    Runs the whole gate in order and stops at the first failure:

      0  preflight                     paths, python, CUDA, checkpoint SHA256, disk
      1  corpus build / verify         canonical records via the PRODUCTION renderer
      2  short profile benchmark       measured seconds/step on THIS machine
      3  baseline real-PDF validation  step-2100, frozen metric -> the gate baseline
      4  baseline original qualification  retention budget for the original corpus
      5  300-step adaptation run       fine-tune, periodic checkpoints, no self-pick
      6  candidate real-PDF validation every checkpoint vs the step-2100 baseline
      7  original-distribution retention  the same gate for every candidate
      8  diagnostic evaluation         reported, NEVER used to select
      9  held-out test                 run ONCE on the selected winner only

    Selection uses the VALIDATION split only. Held-out test data is touched once,
    after a winner is already fixed, and can never move the selection.

    No held-out or diagnostic record is ever opened for training:
    realpdf_data.assert_trainable refuses those splits in the trainer.

    Expected wall clock, 300 steps: see "EXPECTED RUNTIME" below.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\run_rtx_qualification.ps1
    powershell -ExecutionPolicy Bypass -File .\run_rtx_qualification.ps1 -MaxSteps 300 -Device cuda
    powershell -ExecutionPolicy Bypass -File .\run_rtx_qualification.ps1 -ResumeRun <runDir>
#>

# =============================================================================
# USER-EDITABLE CONFIGURATION -- everything you may need to change is here.
# Nothing below this block needs editing for a normal run.
# =============================================================================

# --- locations ---------------------------------------------------------------
$RepoRoot       = 'C:\scoreflow-worker'                                   # repo checkout
$CorpusRoot     = 'C:\scoreflow-worker\.rp-corpus'                        # built records
$RunRoot        = 'C:\scoreflow-worker\.rp-run'                           # training output
$EvalRoot       = 'C:\scoreflow-worker\.rp-eval'                          # evaluation reports
$ResumeRun      = ''                                                       # reuse a prior run dir

# --- inputs (relative to $RepoRoot) ------------------------------------------
$TransferRel    = 'tmp\campaign\piano-vision-phase214\v25-windows-transfer-20260927'
$CheckpointRel  = "$TransferRel\checkpoint-final.pt"
$ContractRel    = "$TransferRel\contract.json"
$ReplayRel      = 'tmp\campaign\piano-vision-phase214\v2-serious-medium-full-v1\train.json'
$OriginalValRel = 'tmp\campaign\piano-vision-phase214\v2-serious-medium-full-v1\validation.json'
$OriginalRefRel = "$TransferRel\v25-full-validation-63086.json"

# SHA256 of the qualified step-2100 checkpoint. Preflight REFUSES to run if this
# differs, so the campaign can never start from a different model.
$CheckpointSha256 = '10fe90b94b065eb8426b38f955968cd30be44e856f2d0ca2396937cfef9731e1'

# --- compute -----------------------------------------------------------------
$Device          = 'cuda'
$ProfileSteps    = 20      # measured steps before committing to the full run
$MaxSteps        = 300     # hard cap; the trainer refuses more without --allow-long
$CheckpointEvery = 50
$SamplesPerStep  = 8
$AdaptRatio      = 0.5     # the other 0.5 is original-distribution replay
$ViewsPerMicro   = 32
$PinMemory       = $true

# --- learning rates (see DIAGNOSIS.md for why these are split this way) ------
$LrVisual        = '1.2e-4'   # backbone + visual/object/geometry projection: the broken path
$LrPitch         = '2.0e-4'   # heads.object.pitch_*
$LrHeads         = '3.0e-5'   # every other head + feedback
$LrShared        = '1.5e-5'   # event/pointer/object_memory/notation
$WarmupSteps     = 30
$WeightDecay     = '1e-4'

# --- evaluation budget -------------------------------------------------------
$OriginalLimit     = 6000   # fast retention gate: fixed manifest prefix
$OriginalFullLimit = 0      # 0 = the authoritative 63,086-example run
$OriginalWorkers   = 6
$MaxRegression     = 0.02   # per-head retention budget against the step-2100 baseline
$MinFreeGiB        = 12     # disk headroom check
$MinCorpusPitch    = 1500   # refuse a corpus thinner than this
$MinCorpusRecords  = 250

# --- behaviour ---------------------------------------------------------------
$RebuildCorpus   = $false   # force a rebuild even if a verified corpus exists
$SkipOriginalFull= $false   # $true skips the authoritative 63,086 run
$KeepGoing       = $false   # $true continues past stage failures (diagnostic only)

# =============================================================================
# END OF CONFIGURATION
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:StageLog = @()

function Write-Stage {
    param([string]$Name, [string]$Message = '', [string]$Level = 'INFO')
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "[$stamp] [$Level] [$Name] $Message"
    Write-Host $line
    $script:StageLog += [pscustomobject]@{ utc = $stamp; stage = $Name; level = $Level; message = $Message }
}

function Fail {
    param([string]$Name, [string]$Message)
    Write-Stage $Name $Message 'FATAL'
    if ($KeepGoing) {
        Write-Stage $Name 'KeepGoing is set; continuing despite the failure.' 'WARN'
        return $false
    }
    throw "[$Name] $Message"
}

function Assert-Path {
    param([string]$Name, [string]$Path, [string]$What)
    if (-not (Test-Path -LiteralPath $Path)) {
        return (Fail $Name "$What not found: $Path")
    }
    return $true
}

function Invoke-Python {
    param([string]$Name, [string]$Script, [string[]]$ScriptArgs, [switch]$AllowFail)
    $exe = Join-Path $RepoRoot '.venv-fixtures\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $exe)) { $exe = 'python' }
    $log = Join-Path $EvalRoot ("{0}.log" -f ($Name -replace '[^A-Za-z0-9_.-]', '_'))
    Write-Stage $Name ("python {0} {1}" -f $Script, ($ScriptArgs -join ' ')) 'CMD'
    Push-Location $RepoRoot
    try {
        & $exe $Script @ScriptArgs 2>&1 | Tee-Object -FilePath $log
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0 -and -not $AllowFail) {
        Fail $Name "exit code $code; see $log" | Out-Null
    }
    return $code
}

function Read-Json {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Get-Checkpoints {
    param([string]$RunDir)
    $dir = Join-Path $RunDir 'checkpoints'
    if (-not (Test-Path -LiteralPath $dir)) { return @() }
    return @(Get-ChildItem -LiteralPath $dir -Filter 'checkpoint-step-*.pt' |
             Sort-Object { [int]($_.BaseName -replace '.*step-', '') })
}

# ------------------------------------------------------------------ preflight
function Invoke-Preflight {
    $n = 'preflight'
    if (-not (Test-Path -LiteralPath $RepoRoot)) { Fail $n "RepoRoot missing: $RepoRoot" | Out-Null; return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'tools\real-pdf-adaptation\train_realpdf.py'))) {
        Fail $n 'tools\real-pdf-adaptation is missing. Copy the whole directory to the worker.' | Out-Null
        return $false
    }
    foreach ($d in @($CorpusRoot, $RunRoot, $EvalRoot)) {
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }

    $ck = Join-Path $RepoRoot $CheckpointRel
    if (-not (Test-Path -LiteralPath $ck)) { Fail $n "checkpoint missing: $ck" | Out-Null; return $false }
    $actual = (Get-FileHash -LiteralPath $ck -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $CheckpointSha256.ToLowerInvariant()) {
        Fail $n "checkpoint SHA256 mismatch. expected $CheckpointSha256 got $actual" | Out-Null
        return $false
    }
    Write-Stage $n "checkpoint sha256 verified: $actual"

    foreach ($rel in @($ContractRel, $ReplayRel, $OriginalValRel)) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $rel))) {
            Fail $n "required input missing: $rel" | Out-Null; return $false
        }
    }

    # Data closure. Roughly 33 GB across ~770k files under tmp/campaign, which is
    # far beyond git and is deliberately NOT part of the branch. Verify it here
    # so a gap is a clear message at preflight rather than a crash three stages
    # later. Everything else in this campaign arrives with the branch.
    $required = @(
        @{ rel = $CheckpointRel;  min_mb = 200; what = 'qualified step-2100 checkpoint' },
        @{ rel = $ContractRel;    min_mb = 0;   what = 'V2.5 model config' },
        @{ rel = $ReplayRel;      min_mb = 1;   what = 'original V2.5 replay manifest' },
        @{ rel = $OriginalValRel; min_mb = 1;   what = 'original qualification manifest' },
        @{ rel = 'tmp\campaign\piano-vision-phase214\full-semantic-index.json'; min_mb = 1; what = 'factory semantic index (replay)' },
        @{ rel = 'tmp\campaign\piano-vision-phase214\notation-sidecars\full-v1'; min_mb = 100; what = 'notation sidecars (replay)' },
        @{ rel = 'tmp\campaign\pdmx-piano-vision-full-v1'; min_mb = 1000; what = 'factory corpus page renders (replay)' }
    )
    $absent = @()
    foreach ($r in $required) {
        $full = Join-Path $RepoRoot $r.rel
        if (-not (Test-Path -LiteralPath $full)) {
            $absent += "$($r.what)  [missing: $($r.rel)]"
            continue
        }
        $sum = (Get-ChildItem -LiteralPath $full -Recurse -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum
        if ($null -eq $sum) { $sum = (Get-Item -LiteralPath $full).Length }
        $mb = [math]::Round(($sum / 1MB), 1)
        if ($mb -lt $r.min_mb) {
            $absent += "$($r.what)  [too small: $mb MiB, expected >= $($r.min_mb) MiB]"
        } else {
            Write-Stage $n ("data ok: {0} = {1} MiB" -f $r.what, $mb)
        }
    }
    if ($absent.Count -gt 0) {
        Fail $n ("data closure incomplete:" + [Environment]::NewLine +
                 '    - ' + ($absent -join ([Environment]::NewLine + '    - ')) +
                 [Environment]::NewLine +
                 '  These live under tmp/ and are NOT carried by the branch (~33 GB).' +
                 [Environment]::NewLine +
                 '  Provision them on the worker, then re-run.') | Out-Null
        return $false
    }
    Write-Stage $n 'data closure verified'

    $free = [math]::Round((Get-PSDrive -Name ([IO.Path]::GetPathRoot($RepoRoot).TrimEnd(':\'))).Free / 1GB, 1)
    Write-Stage $n "free space: $free GiB"
    if ($free -lt $MinFreeGiB) { Fail $n "only $free GiB free, need $MinFreeGiB" | Out-Null; return $false }

    $probe = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @('--help') -AllowFail
    if ($probe -ne 0) { Fail $n 'evaluate_realpdf.py --help failed; python env is wrong' | Out-Null; return $false }

    $cuda = & python -c "import torch,sys;print('ok' if torch.cuda.is_available() else 'no-cuda');print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>&1
    Write-Stage $n ("torch/cuda: {0}" -f ($cuda -join ' | '))
    if (($cuda -join ' ') -match 'no-cuda') {
        Fail $n 'CUDA is not available. This campaign is an RTX-gated run; stop here.' | Out-Null
        return $false
    }

    try { $rev = (git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch { $rev = 'unknown' }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
    $script:RunDir = if ($ResumeRun) { $ResumeRun } else { Join-Path $RunRoot "qual-$MaxSteps-$stamp" }
    if (-not (Test-Path -LiteralPath $script:RunDir)) {
        New-Item -ItemType Directory -Path $script:RunDir -Force | Out-Null
    }
    Write-Stage $n "repo=$rev run=$($script:RunDir)"
    return $true
}

# ---------------------------------------------------------------- corpus
function Invoke-Corpus {
    $n = 'corpus'
    $index = Join-Path $CorpusRoot 'index.json'
    $ok = $false
    if ((Test-Path -LiteralPath $index) -and -not $RebuildCorpus) {
        $doc = Read-Json $index
        if ($doc -and $doc.scores.Count -gt 0 -and $doc.render_dpi -eq 150) {
            $ok = $true
            Write-Stage $n "reusing verified corpus: $($doc.scores.Count) scores, digest $($doc.manifest_digest.Substring(0,12))"
        } else {
            Write-Stage $n 'existing index failed verification; rebuilding' 'WARN'
        }
    }
    if (-not $ok) {
        Invoke-Python $n 'tools/real-pdf-adaptation/audit_pairs.py' @('--out', 'tools/real-pdf-adaptation/split_manifest.json') | Out-Null
        $code = Invoke-Python $n 'tools/real-pdf-adaptation/build_corpus.py' @(
            '--out', $CorpusRoot,
            '--splits', 'adaptation,validation,heldout-test,diagnostic',
            '--min-pitch-labels', "$MinCorpusPitch",
            '--min-records', "$MinCorpusRecords"
        )
        if ($code -ne 0) { Fail $n 'corpus build failed' | Out-Null; return $false }
    }

    $doc = Read-Json $index
    if (-not $doc) { Fail $n 'index.json missing after build' | Out-Null; return $false }
    if ($doc.render_dpi -ne 150) { Fail $n "render_dpi is $($doc.render_dpi), expected 150" | Out-Null; return $false }

    $code = Invoke-Python $n 'tools/real-pdf-adaptation/make_manifests.py' @('--corpus-index', (Join-Path $CorpusRoot 'index.json'))
    if ($code -ne 0) { Fail $n 'manifest freeze failed' | Out-Null; return $false }
    foreach ($s in @('adaptation', 'validation', 'heldout-test', 'diagnostic')) {
        $m = Read-Json (Join-Path $CorpusRoot "$s.json")
        if (-not $m) { Fail $n "manifest $s missing" | Out-Null; return $false }
        Write-Stage $n ("manifest {0,-13} records={1,5} scores={2,2} digest={3}" -f $s, $m.examples.Count, $m.scores.Count, $m.digest.Substring(0,12))
        if ($s -eq 'adaptation' -and $m.examples.Count -lt $MinCorpusRecords) {
            Fail $n "adaptation manifest has only $($m.examples.Count) records" | Out-Null; return $false
        }
    }
    $am = Read-Json (Join-Path $CorpusRoot 'adaptation.json')
    if ($am.campaign_split -ne 'adaptation') {
        Fail $n "adaptation manifest declares campaign_split=$($am.campaign_split)" | Out-Null; return $false
    }
    $h = Read-Json (Join-Path $CorpusRoot 'heldout-test.json')
    $overlap = @($am.scores | Where-Object { $h.scores -contains $_ })
    if ($overlap.Count -gt 0) {
        Fail $n "split leak: held-out scores also in adaptation: $($overlap -join ', ')" | Out-Null; return $false
    }
    Write-Stage $n 'split leak check passed'
    return $true
}

# ---------------------------------------------------------------- profile
function Invoke-Profile {
    $n = 'profile'
    $out = Join-Path $script:RunDir 'profile'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/train_realpdf.py' @(
        '--out', $out,
        '--adapt-manifest', (Join-Path $CorpusRoot 'adaptation.json'),
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--replay-manifest', $ReplayRel,
        '--init-checkpoint', $CheckpointRel,
        '--contract', $ContractRel,
        '--profile-only', "$ProfileSteps",
        '--samples-per-step', "$SamplesPerStep",
        '--views-per-micro', "$ViewsPerMicro",
        '--pin-memory', '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'profile benchmark failed' | Out-Null; return $false }
    $s = Read-Json (Join-Path $out 'summary.json')
    if (-not $s) { Fail $n 'summary.json missing' | Out-Null; return $false }
    $perStep = [double]$s.seconds_median
    $hours = ($perStep * $MaxSteps) / 3600.0
    Write-Stage $n ("measured {0:N2} s/step (median of {1}); {2} steps => {3:N2} h" -f $perStep, $ProfileSteps, $MaxSteps, $hours)
    $s | Add-Member -NotePropertyName projected_run_hours -NotePropertyValue ([math]::Round($hours, 2)) -Force
    $s | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $EvalRoot 'profile-projection.json')
    return $true
}

# ---------------------------------------------------------------- baselines
function Invoke-BaselineRealPdf {
    $n = 'baseline-realpdf'
    $out = Join-Path $EvalRoot 'baseline-step2100.json'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @(
        '--checkpoint', $CheckpointRel,
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--out', $out,
        '--real-pdf-splits', 'validation',
        '--original-limit', "$OriginalLimit",
        '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'baseline real-PDF evaluation failed' | Out-Null; return $false }
    $r = Read-Json $out
    if (-not $r.metric_definition) { Fail $n 'baseline report has no metric_definition' | Out-Null; return $false }
    $v = $r.real_pdf_gates.validation.real_pdf
    Write-Stage $n ("step-2100 VALIDATION: {0}={1:N4} midi={2:N4} dur={3:N4} noteF1={4:N4} restF1={5:N4}" -f `
        'written_pitch', $v.written_pitch_accuracy, $v.derived_midi_accuracy, $v.duration_accuracy, `
        $v.note.f1, $v.rest.f1)
    $script:BaselineReport = $out
    return $true
}

function Invoke-BaselineOriginal {
    $n = 'baseline-original'
    $out = Join-Path $EvalRoot 'baseline-step2100-original.json'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @(
        '--checkpoint', $CheckpointRel,
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--out', $out,
        '--real-pdf-splits', 'validation',
        '--original-limit', "$OriginalLimit",
        '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'baseline original-distribution check failed' | Out-Null; return $false }
    $r = Read-Json $out
    $heads = $r.original_qualification.head_accuracy
    Write-Stage $n ("original prefix ({0} ex): pitch_written_step={1:N4} pitch_octave={2:N4} duration_type={3:N4}" -f `
        $r.original_qualification.prefix_examples,
        $heads.'object.pitch_written_step'.accuracy,
        $heads.'object.pitch_octave'.accuracy,
        $heads.'object.duration_type'.accuracy)
    $script:BaselineReport = $out
    return $true
}

# ---------------------------------------------------------------- training
function Invoke-Adaptation {
    $n = 'adaptation'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/train_realpdf.py' @(
        '--out', $script:RunDir,
        '--adapt-manifest', (Join-Path $CorpusRoot 'adaptation.json'),
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--replay-manifest', $ReplayRel,
        '--init-checkpoint', $CheckpointRel,
        '--contract', $ContractRel,
        '--max-steps', "$MaxSteps",
        '--samples-per-step', "$SamplesPerStep",
        '--adapt-ratio', "$AdaptRatio",
        '--views-per-micro', "$ViewsPerMicro",
        '--lr-visual', $LrVisual, '--lr-pitch', $LrPitch,
        '--lr-heads', $LrHeads, '--lr-shared', $LrShared,
        '--warmup-steps', "$WarmupSteps", '--weight-decay', $WeightDecay,
        '--checkpoint-every', "$CheckpointEvery",
        '--pin-memory', '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'adaptation run failed' | Out-Null; return $false }
    $cks = Get-Checkpoints $script:RunDir
    if ($cks.Count -eq 0) { Fail $n 'no checkpoints were written' | Out-Null; return $false }
    Write-Stage $n ("wrote {0} checkpoints: {1}" -f $cks.Count, (($cks | ForEach-Object { $_.BaseName }) -join ', '))
    return $true
}

# ---------------------------------------------------------------- candidates
function Invoke-CandidateGates {
    $n = 'candidate-gates'
    $results = @()
    $winner = $null
    $best = -1.0

    foreach ($ck in (Get-Checkpoints $script:RunDir)) {
        $tag = $ck.BaseName
        $out = Join-Path $EvalRoot "eval-$tag.json"

        # 6. real-PDF VALIDATION only. This is the selection signal.
        $c1 = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @(
            '--checkpoint', $ck.FullName,
            '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
            '--out', $out,
            '--real-pdf-splits', 'validation',
            '--original-limit', "$OriginalLimit",
            '--baseline-report', $script:BaselineReport,
            '--max-regression', "$MaxRegression",
            '--device', $Device
        )
        if ($c1 -ne 0) { Write-Stage $n "$tag validation eval failed" 'WARN'; continue }

        $r = Read-Json $out
        $v = $r.real_pdf_gates.validation.real_pdf
        $verdict = $r.gate_verdict
        $passes = $verdict -and $verdict.passes

        # 7. original-distribution retention is inside the same report; echo it.
        $oq = $r.original_qualification
        Write-Stage $n ("{0}: pitch={1:N4} midi={2:N4} dur={3:N4} noteF1={4:N4} restF1={5:N4} | original pitch_step={6:N4} retention={7}" -f `
            $tag, $v.written_pitch_accuracy, $v.derived_midi_accuracy, $v.duration_accuracy, `
            $v.note.f1, $v.rest.f1,
            $oq.head_accuracy.'object.pitch_written_step'.accuracy, $passes)

        $results += [pscustomobject]@{
            checkpoint   = $tag
            written_pitch = [double]$v.written_pitch_accuracy
            derived_midi  = [double]$v.derived_midi_accuracy
            duration      = [double]$v.duration_accuracy
            note_f1       = [double]$v.note.f1
            rest_f1       = [double]$v.rest.f1
            retention_ok  = [bool]$passes
            report        = $out
        }
        if ($passes -and [double]$v.written_pitch_accuracy -gt $best) {
            $best = [double]$v.written_pitch_accuracy
            $winner = $ck.FullName
        }
    }

    $table = Join-Path $EvalRoot 'candidate-gates.csv'
    $results | Export-Csv -LiteralPath $table -NoTypeInformation
    Write-Stage $n "gate table -> $table"

    if ($null -eq $winner) {
        Fail $n 'no candidate passed the original-distribution retention budget' | Out-Null
        return $false
    }
    $script:Winner = $winner
    Write-Stage $n ("SELECTED (highest validation written_pitch that retained the original): {0} at {1:N4}" -f `
        (Split-Path $winner -Leaf), $best)
    return $true
}

# ---------------------------------------------------------------- diagnostics
function Invoke-Diagnostic {
    $n = 'diagnostic'
    if (-not (Test-Path -LiteralPath $script:Winner)) { Fail $n 'no winner selected' | Out-Null; return $false }
    $out = Join-Path $EvalRoot 'diagnostic-winner.json'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @(
        '--checkpoint', $script:Winner,
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--out', $out,
        '--real-pdf-splits', 'diagnostic',
        '--skip-original', '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'diagnostic evaluation failed' | Out-Null; return $false }
    $r = Read-Json $out
    foreach ($p in $r.real_pdf_gates.diagnostic.per_score.PSObject.Properties) {
        $m = $p.Value
        Write-Stage $n ("{0}: pitch={1:N4} midi={2:N4} dur={3:N4} noteF1={4:N4} restF1={5:N4} (REPORT ONLY, never selected on)" -f `
            $p.Name, $m.written_pitch_accuracy, $m.derived_midi_accuracy, $m.duration_accuracy, $m.note.f1, $m.rest.f1)
    }
    return $true
}

# ---------------------------------------------------------------- held-out
function Invoke-HeldOut {
    $n = 'heldout-test'
    Write-Stage $n 'held-out is evaluated ONCE on the already-selected winner and cannot change the selection.' 'WARN'
    if (-not (Test-Path -LiteralPath $script:Winner)) { Fail $n 'no winner selected' | Out-Null; return $false }
    $out = Join-Path $EvalRoot 'heldout-winner.json'
    $code = Invoke-Python $n 'tools/real-pdf-adaptation/evaluate_realpdf.py' @(
        '--checkpoint', $script:Winner,
        '--corpus-index', (Join-Path $CorpusRoot 'index.json'),
        '--out', $out,
        '--real-pdf-splits', 'heldout-test',
        '--skip-original', '--device', $Device
    )
    if ($code -ne 0) { Fail $n 'held-out evaluation failed' | Out-Null; return $false }
    $r = Read-Json $out
    $v = $r.real_pdf_gates.'heldout-test'.real_pdf
    Write-Stage $n ("HELD-OUT: pitch={0:N4} midi={1:N4} dur={2:N4} noteF1={3:N4} restF1={4:N4} over {5} scores" -f `
        $v.written_pitch_accuracy, $v.derived_midi_accuracy, $v.duration_accuracy, $v.note.f1, $v.rest.f1, `
        $r.real_pdf_gates.'heldout-test'.scores.Count)
    return $true
}

# ---------------------------------------------------------------- original full
function Invoke-OriginalFull {
    $n = 'original-full'
    if ($SkipOriginalFull) { Write-Stage $n 'skipped by config' 'WARN'; return $true }
    if (-not (Test-Path -LiteralPath $script:Winner)) { Fail $n 'no winner selected' | Out-Null; return $false }
    $out = Join-Path $EvalRoot 'original-full-63086-winner.json'
    $a = @('--checkpoint', $script:Winner,
           '--run-identity', 'v25-realpdf-adaptation',
           '--val-manifest', $OriginalValRel,
           '--out', $out, '--device', $Device, '--engine', 'optimized',
           '--workers', "$OriginalWorkers")
    if ($OriginalFullLimit -gt 0) { $a += @('--limit', "$OriginalFullLimit") }
    $code = Invoke-Python $n 'tools/piano-vision-v25-candidate/evaluate_v25.py' $a
    if ($code -ne 0) { Fail $n 'authoritative original qualification failed' | Out-Null; return $false }
    $ref = Read-Json (Join-Path $RepoRoot $OriginalRefRel)
    $new = Read-Json $out
    if ($ref -and $new) {
        $a1 = $ref.core.head_accuracy.'object.pitch_written_step'.accuracy
        $b1 = $new.core.head_accuracy.'object.pitch_written_step'.accuracy
        Write-Stage $n ("authoritative 63,086: pitch_written_step {0:N4} -> {1:N4} (delta {2:+0.0000;-0.0000})" -f $a1, $b1, ($b1 - $a1))
    }
    return $true
}

# =============================================================================
# MAIN
# =============================================================================
$script:RunDir = $null; $script:BaselineReport = $null; $script:Winner = $null
$started = Get-Date
Write-Stage 'main' "V2.5 real-PDF adaptation qualification; device=$Device steps=$MaxSteps"

$stages = @(
    @{ Name = 'preflight';        Fn = ${function:Invoke-Preflight} },
    @{ Name = 'corpus';           Fn = ${function:Invoke-Corpus} },
    @{ Name = 'profile';          Fn = ${function:Invoke-Profile} },
    @{ Name = 'baseline-realpdf'; Fn = ${function:Invoke-BaselineRealPdf} },
    @{ Name = 'baseline-original';Fn = ${function:Invoke-BaselineOriginal} },
    @{ Name = 'adaptation';       Fn = ${function:Invoke-Adaptation} },
    @{ Name = 'candidate-gates';  Fn = ${function:Invoke-CandidateGates} },
    @{ Name = 'diagnostic';       Fn = ${function:Invoke-Diagnostic} },
    @{ Name = 'heldout-test';     Fn = ${function:Invoke-HeldOut} },
    @{ Name = 'original-full';    Fn = ${function:Invoke-OriginalFull} }
)

foreach ($s in $stages) {
    $t0 = Get-Date
    Write-Stage $s.Name 'BEGIN'
    $r = & $s.Fn
    $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    if ($r -eq $false) {
        Write-Stage $s.Name "FAILED after ${secs}s" 'ERROR'
        $script:StageLog | Export-Csv -LiteralPath (Join-Path $EvalRoot 'stage-log.csv') -NoTypeInformation
        throw "stage $($s.Name) failed"
    }
    Write-Stage $s.Name "OK in ${secs}s"
}

$total = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
$script:StageLog | Export-Csv -LiteralPath (Join-Path $EvalRoot 'stage-log.csv') -NoTypeInformation
Write-Stage 'main' "COMPLETE in $total min"
Write-Host ''
Write-Host 'GATE SUMMARY'
Write-Host '------------'
Write-Host ("winner        : {0}" -f (Split-Path $script:Winner -Leaf))
Write-Host ("candidate gate: {0}" -f (Join-Path $EvalRoot 'candidate-gates.csv'))
Write-Host ("baseline      : {0}" -f $script:BaselineReport)
Write-Host ("diagnostic    : {0}" -f (Join-Path $EvalRoot 'diagnostic-winner.json'))
Write-Host ("held-out      : {0}" -f (Join-Path $EvalRoot 'heldout-winner.json'))
Write-Host ("original full : {0}" -f (Join-Path $EvalRoot 'original-full-63086-winner.json'))
Write-Host ("stage log     : {0}" -f (Join-Path $EvalRoot 'stage-log.csv'))
Write-Host ''
Write-Host 'EXPECTED RUNTIME (300 steps, RTX 5060 worker, measured on the run that'
Write-Host 'produced this checkpoint: 29.6-30.8 s/step at samples_per_step=8).'
Write-Host '  preflight + corpus  ~5 min    profile(20)    ~12 min'
Write-Host '  baseline real-PDF   ~15 min   baseline orig   ~20 min'
Write-Host '  300-step run        ~2.6 h    candidate gates ~2.0 h (6 ckpts x 2 gates)'
Write-Host '  diagnostic + heldout ~25 min   original full  ~40 min'
Write-Host '  TOTAL               ~6.0 h'
