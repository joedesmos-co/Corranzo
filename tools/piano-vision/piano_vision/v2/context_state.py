"""Persistent, auditable context across windows/pages; never infer defaults.

The neural local window alone cannot remember a signature change pages earlier.
This ledger accepts source-recognized context events, including uncertainty, and
serves the decoder. It is independent of target metadata and style conventions.
"""
from copy import deepcopy


class ContextLedger:
    version="musical-context-ledger/2.0"
    fields={"clef","key","time","octave_shift","staff_details","transpose"}

    def __init__(self):
        self.events=[];self.identifiers=set()

    def add(self,event):
        """position=(page, system, source-order, within-scope-order), all source-derived.

        Per-staff values override part-wide values at the same position. Unknown
        changes invalidate inherited certainty until an explicit later event.
        Multiple changes at the same position remain conflicting alternatives.
        """
        if event.get("field") not in self.fields or not event.get("id") or event["id"] in self.identifiers:
            raise ValueError("Invalid/duplicate context event")
        position=event.get("position")
        if not isinstance(position,(list,tuple)) or len(position)!=4 or any(not isinstance(v,int) or v<0 for v in position):
            raise ValueError("Context requires source position")
        if not event.get("part") or event.get("state") not in {"known","unknown","ambiguous","unsupported"}:
            raise ValueError("Context identity/state missing")
        if not event.get("provenance") or event.get("origin") not in {"visual-prediction","human-review"}:
            raise ValueError("Context requires source evidence provenance")
        if event["state"]=="known" and "value" not in event: raise ValueError("Known context requires value")
        self.events.append(deepcopy(event));self.identifiers.add(event["id"])

    def at(self,position,part,staff,fields=None):
        position=tuple(position);result={}
        for field in sorted(self.fields if fields is None else fields):
            if field not in self.fields: raise ValueError("Unsupported context field")
            rows=[e for e in self.events if e["field"]==field and e["part"]==part
                  and e.get("staff") in (None,staff) and tuple(e["position"])<=position]
            if not rows:
                result[field]={"state":"unknown","reason":"NO_CONTEXT_EVIDENCE","events":[]};continue
            latest=max(tuple(e["position"]) for e in rows)
            rows=[e for e in rows if tuple(e["position"])==latest]
            specific=[e for e in rows if e.get("staff")==staff]
            rows=specific or rows
            resolved=all(e["state"]=="known" and e.get("value")==rows[0].get("value") for e in rows)
            result[field]={"state":"known" if resolved else "ambiguous",
                           "value":deepcopy(rows[0].get("value")) if resolved else None,
                           "events":deepcopy(rows),"inherited":latest<position}
        return result

    def snapshot(self):
        return {"version":self.version,"events":deepcopy(self.events)}

    @classmethod
    def restore(cls,snapshot):
        if snapshot.get("version")!=cls.version: raise ValueError("Incompatible context ledger")
        ledger=cls()
        for event in snapshot["events"]: ledger.add(event)
        return ledger
