"""Strict V2 checkpoint lineage, explicit migration and candidate acceptance."""
import hashlib
import json
import os
from pathlib import Path

import torch
from ..checkpoint import capture_rng_state,restore_rng_state
from . import ARCHITECTURE_VERSION,INPUT_VERSION,VOCABULARY_VERSION,VERIFIER_VERSION
from .notation import ONTOLOGY_VERSION

VERSIONS={"architecture":ARCHITECTURE_VERSION,"input":INPUT_VERSION,"vocabulary":VOCABULARY_VERSION,
          "ontology":ONTOLOGY_VERSION,"verifier":VERIFIER_VERSION}


def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def save_checkpoint(path,model,optimizer,step,dataset_digest,*,parent_champion=None,calibration=None,replay_digest=None,
                    scheduler=None,scaler=None,sampler_state=None,supervision_manifest=None):
    path=Path(path)
    if path.exists(): raise FileExistsError("V2 checkpoints are immutable; use a new path")
    if not dataset_digest or step<0: raise ValueError("Missing dataset lineage")
    config=model.config.to_dict()
    payload={"schema_version":2,"versions":VERSIONS,"config":config,"config_digest":digest(config),
             "dataset_digest":dataset_digest,"model_state":model.state_dict(),
             "optimizer_state":optimizer.state_dict() if optimizer is not None else None,
             "rng_state":capture_rng_state(),"step":step,"parent_champion":parent_champion,
             "replay_digest":replay_digest,"calibration":calibration,"role":"candidate",
             "scheduler_state":scheduler.state_dict() if scheduler is not None else None,
             "scaler_state":scaler.state_dict() if scaler is not None else None,
             "sampler_state":sampler_state,"supervision_manifest":supervision_manifest}
    path.parent.mkdir(parents=True,exist_ok=True)
    partial=path.with_suffix(path.suffix+".partial")
    with partial.open("xb") as stream:
        torch.save(payload,stream);stream.flush();os.fsync(stream.fileno())
    # Exclusive creation prevents accidentally replacing a run/checkpoint.
    try: os.link(partial,path)
    finally: partial.unlink()
    return {"path":str(path),"config_digest":payload["config_digest"],"versions":VERSIONS}


def load_checkpoint(path,model,optimizer=None,*,dataset_digest,restore_rng=True,scheduler=None,scaler=None,
                    supervision_manifest=None):
    payload=torch.load(path,map_location="cpu",weights_only=False)
    if payload.get("schema_version")!=2 or payload.get("versions")!=VERSIONS:
        raise ValueError("Incompatible checkpoint versions")
    if payload.get("config_digest")!=digest(model.config.to_dict()): raise ValueError("Incompatible model config")
    if payload.get("dataset_digest")!=dataset_digest: raise ValueError("Dataset lineage mismatch")
    if optimizer is not None and payload.get("optimizer_state") is None: raise ValueError("Optimizer state unavailable")
    for name,component in (("scheduler",scheduler),("scaler",scaler)):
        if component is not None and payload.get(name+"_state") is None: raise ValueError(name+" state unavailable")
    if supervision_manifest is not None and payload.get("supervision_manifest")!=supervision_manifest:
        raise ValueError("Supplemental supervision lineage mismatch")
    model.load_state_dict(payload["model_state"],strict=True)
    if optimizer is not None: optimizer.load_state_dict(payload["optimizer_state"])
    if scheduler is not None: scheduler.load_state_dict(payload["scheduler_state"])
    if scaler is not None: scaler.load_state_dict(payload["scaler_state"])
    if restore_rng: restore_rng_state(payload["rng_state"])
    return payload


def migrate_weights(source_state,model,approved_map):
    """No guessing by shape: names must be explicitly mapped by semantics."""
    destination=model.state_dict();copied=[];skipped=[]
    if len(set(approved_map.values()))!=len(approved_map): raise ValueError("Duplicate migration destination")
    for source,target in approved_map.items():
        a=source_state.get(source);b=destination.get(target)
        if a is None or b is None: reason="missing_key"
        elif a.shape!=b.shape: reason="shape_mismatch"
        elif a.dtype!=b.dtype: reason="dtype_mismatch"
        else:
            destination[target]=a.detach().clone();copied.append({"source":source,"target":target});continue
        skipped.append({"source":source,"target":target,"reason":reason})
    model.load_state_dict(destination,strict=True)
    return {"copied":copied,"skipped":skipped,"unmapped_source_keys":sorted(set(source_state)-set(approved_map)),
            "uninitialized_destination_keys":sorted(set(destination)-{r["target"] for r in copied}),
            "optimizer_transferred":False,"calibration_transferred":False}


def promotion_gate(champion,candidate,required_metrics):
    """Read-only decision; caller can later atomically promote an accepted candidate."""
    reasons=[]
    for key in ("evaluation_manifest","domain","notation_schema"):
        if not champion.get(key) or champion.get(key)!=candidate.get(key): reasons.append("IDENTITY_MISMATCH:"+key)
    if not candidate.get("parent_champion") or candidate["parent_champion"]!=champion.get("checkpoint_digest"):
        reasons.append("PARENT_CHAMPION_MISMATCH")
    if not candidate.get("replay_digest"): reasons.append("REPLAY_LINEAGE_MISSING")
    if not candidate.get("risk_qualified"): reasons.append("RISK_UNQUALIFIED")
    if not required_metrics: reasons.append("NO_ACCEPTANCE_METRICS")
    for key,direction in required_metrics.items():
        if direction not in {"higher","lower"}: raise ValueError("Invalid metric direction")
        a=champion.get("metrics",{}).get(key);b=candidate.get("metrics",{}).get(key)
        if not isinstance(a,(float,int)) or not isinstance(b,(float,int)) or not all(__import__('math').isfinite(v) for v in (a,b)):
            reasons.append("MISSING_METRIC:"+key)
        elif (b<a if direction=="higher" else b>a): reasons.append("REGRESSION:"+key)
    return {"promote":not reasons,"reasons":reasons,"champion_mutated":False}
