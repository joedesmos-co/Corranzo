"""Masked proper log loss, deep supervision, no synthetic negative labels."""
import torch
import torch.nn.functional as F


def _pass_loss(outputs, targets):
    total=outputs["embeddings"]["object"].sum()*0 if "embeddings" in outputs else next(iter(outputs["object"].values())).sum()*0
    count=total.detach().clone();groups=0
    for group in ("object","relation","context"):
        parts=[]
        for head,logits in outputs[group].items():
            payload=targets.get(group,{}).get(head)
            if payload is None: continue
            mask=payload["mask"].to(logits.dtype)
            target=payload["target"].clamp_min(0)
            ce=F.cross_entropy(logits.flatten(0,-2),target.flatten(),reduction="none").reshape_as(mask)
            denominator=mask.sum()
            parts.append(((ce*mask).sum()/denominator.clamp_min(1),denominator>0))
            count=count+denominator
        if parts:
            group_loss=sum(v for v,active in parts)/sum(active.to(total.dtype) for v,active in parts).clamp_min(1)
            total=total+group_loss;groups+=1
    for head,prediction in outputs.get("regression",{}).items():
        payload=targets.get("regression",{}).get(head)
        if payload is None: continue
        mask=payload["mask"].to(prediction.dtype)
        total=total+.1*(F.smooth_l1_loss(prediction,payload["target"],reduction="none")*mask).sum()/mask.sum().clamp_min(1)
    return total,count


def _ordinal_loss(outputs, targets):
    """Masked CE for the ordinal attachment head. Empty masks give exact zero."""
    payload = (targets.get("attachment") or {}).get("ordinal")
    logits = (outputs.get("attachment") or {}).get("ordinal")
    if payload is None or logits is None:
        return None, None
    mask = payload["mask"].to(logits.dtype)
    denom = mask.sum()
    if int(payload["mask"].sum()) == 0:
        return logits.sum() * 0, denom
    ce = F.cross_entropy(
        logits.flatten(0, -2),
        payload["target"].clamp_min(0).flatten(),
        reduction="none",
    ).reshape_as(mask)
    return (ce * mask).sum() / denom.clamp_min(1), denom


def semantic_loss(outputs,targets,initial_weight=.3, ordinal_weight=1.0):
    loss,count=_pass_loss(outputs,targets)
    if outputs.get("initial") is not None and initial_weight:
        initial,_=_pass_loss(outputs["initial"],targets)
        loss=loss+initial_weight*initial
    if "notation" in outputs and "notation" in targets:
        payload=targets["notation"]
        logits=outputs["notation"]
        mask=payload["mask"].reshape(-1).to(logits.dtype)
        ce=F.cross_entropy(logits.reshape(-1,logits.shape[-1]),payload["target"].reshape(-1).clamp_min(0),reduction="none")
        loss=loss+(ce*mask).sum()/mask.sum().clamp_min(1)
        count=count+mask.sum()
    ordinal_loss, ordinal_count = _ordinal_loss(outputs, targets)
    if ordinal_loss is not None:
        loss = loss + ordinal_weight * ordinal_loss
        count = count + ordinal_count
    return loss,count

