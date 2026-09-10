"""Post-training calibration, partition provenance and score-level risk bounds."""
import hashlib
import math
from dataclasses import asdict,dataclass

import torch
import torch.nn.functional as F


def validation_partition(semantic_source_id):
    bucket=int(hashlib.sha256(("pv2-validation:"+semantic_source_id).encode()).hexdigest()[:8],16)%10
    return "selection" if bucket<5 else "temperature" if bucket<7 else "risk"


def fit_temperature(logits,targets,source_ids,split="validation"):
    if split!="validation" or not source_ids or any(validation_partition(s)!="temperature" for s in source_ids):
        raise PermissionError("Temperature fitting requires its designated validation sources")
    if logits.ndim!=2 or len(logits)!=len(targets) or not len(targets): raise ValueError("Empty/invalid calibration tensors")
    logits=logits.detach().float().cpu();targets=targets.detach().long().cpu()
    if not torch.isfinite(logits).all(): raise ValueError("Nonfinite logits")
    log_t=torch.zeros((),requires_grad=True)
    optimizer=torch.optim.LBFGS([log_t],lr=.2,max_iter=50,line_search_fn="strong_wolfe")
    def closure():
        optimizer.zero_grad();loss=F.cross_entropy(logits/log_t.exp().clamp(.05,20),targets);loss.backward();return loss
    before=float(F.cross_entropy(logits,targets));optimizer.step(closure)
    temperature=float(log_t.detach().exp().clamp(.05,20))
    after=float(F.cross_entropy(logits/temperature,targets))
    if after>before: temperature=1.;after=before
    return {"temperature":temperature,"nll_before":before,"nll_after":after,
            "examples":len(targets),"split":split,"partition":"temperature",
            "sources_digest":hashlib.sha256("\n".join(sorted(set(source_ids))).encode()).hexdigest()}


def binomial_upper(errors,total,alpha=.05):
    """One-sided exact Clopper-Pearson upper bound; unit must be whole scores."""
    if not isinstance(errors,int) or not isinstance(total,int) or not 0<=errors<=total or not 0<alpha<1:
        raise ValueError("Invalid risk counts")
    if total==0 or errors==total: return 1.
    if errors==0: return 1-alpha**(1/total)
    from scipy.stats import beta
    return float(beta.ppf(1-alpha,errors+1,total-errors))


def certify_risk(rows,threshold,model_digest,domain,max_risk=.001,alpha=.05):
    """Threshold is preselected elsewhere, never tuned against these outcomes."""
    if not model_digest or not domain or not 0<=threshold<=1: raise ValueError("Missing calibration identity")
    ids=[r["semantic_source_id"] for r in rows]
    if len(set(ids))!=len(ids): raise ValueError("Risk units must be distinct semantic scores")
    if any(r.get("split")!="validation" or validation_partition(r["semantic_source_id"])!="risk" for r in rows):
        raise PermissionError("Risk certification requires designated validation scores")
    if any(not isinstance(r.get("confidence"),(float,int)) or not math.isfinite(r["confidence"]) or not 0<=r["confidence"]<=1 for r in rows):
        raise ValueError("Invalid score confidence")
    accepted=[r for r in rows if r["confidence"]>=threshold and r.get("structurally_verified") is True]
    if any(r.get("truth_complete") is not True for r in accepted):
        raise ValueError("Cannot certify risk by excluding accepted scores with incomplete truth")
    if any(not isinstance(r.get("correct"),bool) for r in accepted): raise ValueError("Risk outcomes missing")
    errors=sum(not r["correct"] for r in accepted)
    upper=binomial_upper(errors,len(accepted),alpha)
    return {"version":"score-risk/2","model_digest":model_digest,"domain":domain,
            "threshold":threshold,"max_risk":max_risk,"alpha":alpha,"accepted_scores":len(accepted),
            "wrong_complete_scores":errors,"upper_risk":upper,"qualified":upper<=max_risk,
            "source_ids":ids,"partition":"risk","split":"validation"}


def completion_decision(confidence,verification,quality,unknown_regions,certificate,model_digest,domain):
    reasons=[]
    if not isinstance(confidence,(float,int)) or not math.isfinite(confidence) or not 0<=confidence<=1:
        reasons.append("INVALID_CONFIDENCE")
    if not certificate or not certificate.get("qualified"): reasons.append("CALIBRATION_UNQUALIFIED")
    elif certificate.get("model_digest")!=model_digest or certificate.get("domain")!=domain:
        reasons.append("CALIBRATION_IDENTITY_MISMATCH")
    elif not reasons and confidence<certificate["threshold"]: reasons.append("LOW_CONFIDENCE")
    if not verification.get("consistent") or verification.get("review_required"): reasons.append("MUSICAL_REVIEW_REQUIRED")
    if not quality.get("recognition_allowed") or not quality.get("calibrated") or quality.get("complete_eligible") is not True:
        reasons.append("INPUT_QUALITY_UNQUALIFIED")
    if unknown_regions: reasons.append("UNKNOWN_NOTATION")
    return {"complete":not reasons,"status":"COMPLETE" if not reasons else "REVIEW","reasons":reasons}
