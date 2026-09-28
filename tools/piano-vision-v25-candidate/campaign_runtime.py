"""Campaign provenance and output guards; no machine configuration changes."""
import hashlib
from pathlib import Path
import torch
ROOT=Path(__file__).resolve().parents[2]
FROZEN=ROOT/'tmp/campaign/piano-vision-phase214/v25-codex-reference-20260926'


def writable_output(path):
    path=Path(path).resolve()
    if path==FROZEN or FROZEN in path.parents:
        raise PermissionError('Frozen reference is read-only')
    return path


def source_digest():
    h=hashlib.sha256()
    root=Path(__file__).resolve().parent
    for p in sorted(root.rglob('*.py')):
        if p.name.startswith('._'):continue
        h.update(p.relative_to(root).as_posix().encode());h.update(p.read_bytes())
    return h.hexdigest()


def set_p1_lr(optimizer,scheduler,lr,policy):
    optimizer.param_groups[0]['initial_lr']=lr
    if policy=='corrected':
        scheduler.base_lrs[0]=lr
        optimizer.param_groups[0]['lr']=lr*scheduler.lr_lambdas[0](scheduler.last_epoch)
        scheduler._last_lr=[g['lr'] for g in optimizer.param_groups]


def capture_rng():
    return {'cpu':torch.get_rng_state(),
            'cuda':torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None}


def restore_rng(state):
    torch.set_rng_state(state['cpu'].cpu())
    if state['cuda'] is not None:
        if not torch.cuda.is_available():raise ValueError('CUDA RNG checkpoint needs CUDA')
        torch.cuda.set_rng_state_all([x.cpu() for x in state['cuda']])
