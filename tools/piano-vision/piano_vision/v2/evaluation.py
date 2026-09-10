"""Complete-manifest measure/page/score metrics with explicit missing units."""
from collections import defaultdict


class ExactMetrics:
    def __init__(self,expected_units):
        self.expected=[tuple(x) for x in expected_units]
        if not self.expected or len(set(self.expected))!=len(self.expected) or any(len(x)!=3 for x in self.expected):
            raise ValueError("Require unique (score,page,measure) manifest")
        self.expected_set=set(self.expected);self.rows={}

    def add(self,key,*,raw_exact,truth_complete,offered,verification,notation_complete):
        key=tuple(key)
        if key not in self.expected_set or key in self.rows: raise ValueError("Unexpected/duplicate evaluation unit")
        if raw_exact not in (True,False,None): raise ValueError("Invalid exactness")
        eligible=bool(truth_complete)
        accepted=bool(offered and verification.get("consistent") and not verification.get("review_required") and notation_complete)
        self.rows[key]={"raw_exact":raw_exact is True and eligible,"truth_complete":eligible,
                        "offered":accepted,"missing":False}

    @staticmethod
    def _summary(rows):
        total=len(rows);known=sum(r["truth_complete"] for r in rows)
        raw=sum(r["raw_exact"] for r in rows);offered=sum(r["offered"] for r in rows)
        wrong=sum(r["offered"] and r["truth_complete"] and not r["raw_exact"] for r in rows)
        unscorable=sum(r["offered"] and not r["truth_complete"] for r in rows)
        exact=sum(r["offered"] and r["raw_exact"] for r in rows)
        return {"units":total,"truth_complete_units":known,"missing_units":sum(r["missing"] for r in rows),
                "raw_exact":raw,"raw_exact_rate":raw/known if known else None,
                "raw_exact_rate_all":raw/total if total else None,
                "offered":offered,"coverage":offered/total if total else None,
                "accepted_exact":exact,"accepted_exact_rate_all":exact/total if total else None,
                "wrong_complete":wrong,"wrong_complete_rate_all":wrong/total if total else None,
                "wrong_complete_rate_offered":wrong/(offered-unscorable) if offered>unscorable else None,
                "offered_with_unknown_truth":unscorable}

    def summary(self):
        missing={"raw_exact":False,"truth_complete":False,"offered":False,"missing":True}
        measures=[self.rows.get(k,missing) for k in self.expected]
        output={"measure":self._summary(measures)}
        for name,width in (("page",2),("score",1)):
            groups=defaultdict(list)
            for key in self.expected: groups[key[:width]].append(self.rows.get(key,missing))
            rows=[{"raw_exact":all(r["raw_exact"] for r in group),
                   "truth_complete":all(r["truth_complete"] for r in group),
                   "offered":all(r["offered"] for r in group),
                   "missing":any(r["missing"] for r in group)} for group in groups.values()]
            output[name]=self._summary(rows)
        return output
