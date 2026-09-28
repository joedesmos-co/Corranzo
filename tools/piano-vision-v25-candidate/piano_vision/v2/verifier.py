"""Non-destructive exact music checks with explicit rule preconditions.

HARD = a contradiction under declared semantics; UNKNOWN = missing information;
SOFT = common practice with legal exceptions; STYLE never changes validity.
"""
import heapq
import math
from collections import defaultdict
from copy import deepcopy
from fractions import Fraction

from . import VERIFIER_VERSION

TYPE_QUARTERS = {"maxima":32,"long":16,"breve":8,"whole":4,"half":2,"quarter":1,
                 **{name:Fraction(1,den) for name,den in (("eighth",2),("16th",4),("32nd",8),
                    ("64th",16),("128th",32),("256th",64),("512th",128),("1024th",256))}}


def rational(value):
    if isinstance(value,bool) or value is None:
        raise ValueError("Missing/invalid rational value")
    if isinstance(value,float) and not math.isfinite(value):
        raise ValueError("Nonfinite rational value")
    return Fraction(str(value))


def written_duration(event):
    if event.get("grace"):
        return Fraction(0)
    base=TYPE_QUARTERS.get(event.get("type"))
    if base is None:
        raise ValueError("Unknown written duration")
    dots=event.get("dots",0)
    if not isinstance(dots,int) or not 0<=dots<=32:
        raise ValueError("Unsupported dot count")
    result=Fraction(base)*sum((Fraction(1,2**i) for i in range(dots+1)),Fraction(0))
    # time_ratio is cumulative (including nested tuplets and measured tremolos).
    # Do not apply graphical nested spans a second time.
    ratio=event.get("time_ratio") or event.get("tuplet_ratio")
    if ratio:
        actual,normal=ratio
        if not isinstance(actual,int) or not isinstance(normal,int) or min(actual,normal)<1:
            raise ValueError("Invalid time ratio")
        result*=Fraction(normal,actual)
    return result


def key_alter(fifths, step):
    if not isinstance(fifths,int) or not -7<=fifths<=7 or step not in list("CDEFGAB"):
        raise ValueError("Unsupported key/pitch")
    return (1 if step in "FCGDAEB"[:fifths] else 0) if fifths>=0 else (-1 if step in "BEADGCF"[:-fifths] else 0)


def verify_measure(candidate):
    """Read-only verifier. It cannot certify calibration, visual recall or truth."""
    issues=[]
    def issue(code,*ids,kind="HARD",precondition=None):
        issues.append({"code":code,"ids":[str(i) for i in ids],"kind":kind,
                       "precondition":precondition})
    events=candidate.get("events",[])
    if not events and not candidate.get("explicit_empty_measure"):
        issue("NO_EVENTS",kind="UNKNOWN")
    for key in ("proposal_complete","relations_complete","notation_complete"):
        if candidate.get(key) is not True: issue(key.upper()+"_UNKNOWN",kind="UNKNOWN")
    if candidate.get("truncated_objects") or candidate.get("omitted_relations"):
        issue("CANDIDATE_OVERFLOW",kind="UNKNOWN")
    if candidate.get("unknown_regions"): issue("UNKNOWN_NOTATION_REGIONS",kind="UNKNOWN")
    capacity=None
    free=bool(candidate.get("free_meter") or candidate.get("cadenza"))
    if not free:
        try:
            meter=candidate["time_signature"]
            beats=sum((rational(x) for x in str(meter[0]).split("+")),Fraction(0))
            denominator=rational(meter[1])
            if beats<=0 or denominator<=0: raise ValueError()
            capacity=beats*4/denominator
        except (KeyError,ValueError,TypeError,IndexError,ZeroDivisionError):
            issue("METER_UNKNOWN",kind="UNKNOWN")
    irregular=bool(candidate.get("pickup") or candidate.get("irregular"))
    if irregular and candidate.get("expected_duration") is not None:
        try:
            capacity=rational(candidate["expected_duration"])
            if capacity<=0: raise ValueError()
        except (ValueError,ZeroDivisionError): issue("IRREGULAR_DURATION_UNKNOWN",kind="UNKNOWN")
    # Exact filling only follows an explicit, reviewed metric contract. Hidden
    # rests, forward elements and cross-staff ownership are not inferred away.
    exact_fill=bool(candidate.get("metric_contract_complete") and not free and
                    (not irregular or candidate.get("expected_duration") is not None))
    by_id={};timing={};chords=defaultdict(list);voices=defaultdict(list);tuplets=defaultdict(list)
    staff_context=candidate.get("staff_context",{})
    for event in events:
        identifier=event.get("id")
        if not isinstance(identifier,str) or not identifier or identifier in by_id:
            issue("DUPLICATE_OR_MISSING_EVENT_ID",identifier);continue
        by_id[identifier]=event
        try:
            onset=rational(event["onset"]);duration=rational(event["duration"])
            if duration<0 or (duration==0 and not event.get("grace")):
                issue("INVALID_DURATION",identifier)
            if onset<0 and not event.get("grace"):
                issue("NEGATIVE_METRIC_ONSET",identifier)
            if duration!=written_duration(event):
                issue("WRITTEN_DURATION_MISMATCH",identifier,
                      kind="HARD" if event.get("duration_encoding_complete") else "UNKNOWN",
                      precondition="complete written duration and cumulative time-modification")
            timing[identifier]=(onset,duration)
        except (KeyError,ValueError,TypeError,ZeroDivisionError):
            issue("EVENT_TIMING_UNKNOWN",identifier,kind="UNKNOWN");continue
        if event.get("voice") is None: issue("VOICE_UNKNOWN",identifier,kind="UNKNOWN")
        if str(event.get("staff")) not in staff_context: issue("STAFF_CONTEXT_UNKNOWN",identifier,kind="UNKNOWN")
        if event.get("role_count",1)>1 and not event.get("roles_expanded"):
            issue("SHARED_HEAD_ROLES_UNRESOLVED",identifier,kind="UNKNOWN")
        if event.get("chord") is not None: chords[(event.get("voice"),event["chord"])].append(event)
        voices[event.get("voice")].append(event)
        for group in event.get("tuplet_groups",[event["tuplet_group"]] if event.get("tuplet_group") is not None else []):
            tuplets[group].append(event)
        if event.get("rest") and event.get("pitch") is not None: issue("REST_HAS_PITCH",identifier)
        if not event.get("rest") and not event.get("unpitched"):
            pitch=event.get("pitch")
            if not isinstance(pitch,(list,tuple)) or len(pitch)!=3 or pitch[0] not in list("CDEFGAB"):
                issue("PITCH_UNKNOWN",identifier,kind="UNKNOWN")
    for (_,chord), rows in chords.items():
        if len({timing[e["id"]][0] for e in rows})!=1: issue("CHORD_ONSET_DISAGREEMENT",chord)
        # MusicXML permits shorter additional chord tones. Only an explicitly
        # identified lead establishes the maximum duration and advancing cursor.
        lead=next((e for e in rows if e.get("chord_lead")),None)
        if lead and any(timing[e["id"]][1]>timing[lead["id"]][1] for e in rows):
            issue("CHORD_MEMBER_LONGER_THAN_LEAD",chord,precondition="explicit MusicXML chord lead")
        pitches=[tuple(e["pitch"]) for e in rows if e.get("pitch")]
        if len(set(pitches))!=len(pitches): issue("DUPLICATE_CHORD_PITCH",chord,kind="SOFT")
    for voice, rows in voices.items():
        groups=defaultdict(list)
        for e in rows:
            if not e.get("grace"):
                groups[("chord",e["chord"]) if e.get("chord") is not None else ("event",e["id"])].append(e)
        intervals=[]
        for g in groups.values():
            start=min(timing[e["id"]][0] for e in g)
            stop=max(sum(timing[e["id"]]) for e in g)
            intervals.append((start,stop))
        intervals.sort();end=Fraction(0)
        for start,stop in intervals:
            if start<end: issue("VOICE_OVERLAP",voice,kind="HARD" if exact_fill else "SOFT",
                                precondition="qualified logical voice ownership and metric contract")
            if start>end: issue("VOICE_GAP",voice,kind="HARD" if exact_fill else "SOFT",
                               precondition="all hidden timing/forward elements represented")
            end=max(end,stop)
        if capacity is not None and intervals and end!=capacity:
            issue("MEASURE_CAPACITY_MISMATCH",voice,kind="HARD" if exact_fill else "SOFT",
                  precondition="qualified meter, logical voice ownership and exact-fill contract")
    external=candidate.get("external_events",{})
    for identifier,event in by_id.items():
        if identifier not in timing: continue
        for field,code in (("tie_to","TIE"),("continuation_to","CONTINUATION")):
            endpoint=event.get(field)
            if endpoint is None: continue
            target=by_id.get(endpoint) or external.get(endpoint)
            if target is None:
                issue(code+"_ENDPOINT_UNRESOLVED",identifier,endpoint,kind="UNKNOWN");continue
            if code=="TIE" and (event.get("rest") or target.get("rest")):
                issue("TIE_REST_ENDPOINT",identifier)
            if event.get("voice")!=target.get("voice"):
                # Visual ties can cross logical voices; voice continuity is a
                # soft expectation unless explicitly declared invariant.
                issue(code+"_VOICE_DIFFERENCE",identifier,kind="SOFT")
            if code=="TIE" and event.get("pitch")!=target.get("pitch"):
                issue("TIE_PITCH_MISMATCH",identifier,kind="HARD" if event.get("tie_semantics")=="exact-written" else "SOFT")
            try:
                target_onset=rational(target["onset"])+rational(target.get("measure_offset",0))
                onset,duration=timing[identifier]
                if (event.get("grace") or target.get("grace")) and target_onset==onset:
                    order=event.get("grace_order");next_order=target.get("grace_order")
                    if order is None or next_order is None:
                        issue("GRACE_SEQUENCE_ORDER_UNKNOWN",identifier,kind="UNKNOWN")
                    elif next_order<=order:
                        issue("GRACE_SEQUENCE_ORDER_CONTRADICTION",identifier)
                elif target_onset<=onset: issue(code+"_NONFORWARD",identifier)
                elif target_onset!=onset+duration:
                    issue(code+"_TIMING_GAP",identifier,kind="HARD" if event.get("tie_semantics")=="exact-written" and code=="TIE" else "SOFT")
            except (KeyError,ValueError): issue(code+"_TIMING_UNKNOWN",identifier,kind="UNKNOWN")
    declared=candidate.get("tuplets",{})
    for group,rows in tuplets.items():
        specification=declared.get(str(group))
        if not specification:
            issue("TUPLET_MEMBERSHIP_UNKNOWN",group,kind="UNKNOWN");continue
        if specification.get("complete") and set(specification.get("members",[]))!={e["id"] for e in rows}:
            issue("TUPLET_MEMBERSHIP_MISMATCH",group)
        # Nested groups may have different cumulative ratios per member; never
        # infer invalidity from uncommon ratios or membership count alone.
        if specification.get("duration") is not None:
            try:
                begin=min(timing[e["id"]][0] for e in rows)
                end=max(sum(timing[e["id"]]) for e in rows)
                if end-begin!=rational(specification["duration"]):
                    issue("TUPLET_SPAN_MISMATCH",group,kind="HARD" if specification.get("complete") else "UNKNOWN")
            except (KeyError,ValueError): issue("TUPLET_DURATION_UNKNOWN",group,kind="UNKNOWN")
    # Apply accidental rules only under an explicitly qualified notation policy.
    # Courtesy/editorial appearance remains independent from sounding alteration.
    if candidate.get("accidental_policy")=="modern-staff-octave":
        state={};onsets=defaultdict(list)
        for e in events:
            if e.get("id") in timing and not e.get("rest") and isinstance(e.get("pitch"),(list,tuple)) and len(e["pitch"])==3:
                onsets[timing[e["id"]][0]].append(e)
        for onset,rows in sorted(onsets.items()):
            updates={}
            for e in rows:
                step,octave,alter=e["pitch"];key=(str(e.get("staff")),step,octave)
                context=staff_context.get(key[0],{})
                try:
                    expected=state.get(key,key_alter(context["key_fifths"],step))
                    printed=e.get("accidental")
                    if printed is not None:
                        a=printed if isinstance(printed,dict) else {"alter":printed,"affects_pitch":True}
                        if a.get("affects_pitch",False):
                            expected=rational(a["alter"])
                            if key in updates and updates[key]!=expected:
                                issue("SIMULTANEOUS_ACCIDENTAL_AMBIGUITY",e["id"],kind="UNKNOWN")
                            updates[key]=expected
                    if e.get("tie_from_previous"):
                        if e.get("tie_source_pitch")!=e.get("pitch"):
                            issue("TIE_CARRY_UNKNOWN",e["id"],kind="UNKNOWN")
                        expected=alter
                    if rational(alter)!=expected:
                        issue("KEY_ACCIDENTAL_MISMATCH",e["id"],
                              kind="HARD" if candidate.get("accidental_evidence_complete") else "UNKNOWN",
                              precondition="qualified accidental policy and complete accidental evidence")
                except (KeyError,ValueError,TypeError): issue("KEY_CONTEXT_UNKNOWN",e["id"],kind="UNKNOWN")
            state.update(updates)
    hard=[i for i in issues if i["kind"]=="HARD"]
    unknown=[i for i in issues if i["kind"]=="UNKNOWN"]
    review=[i for i in issues if i["kind"] in {"UNKNOWN","SOFT"}]
    return {"version":VERIFIER_VERSION,"consistent":not hard and not unknown,"valid_under_declared_semantics":not hard,
            "review_required":bool(review),"status":"CONTRADICTORY" if hard else "REVIEW" if review else "CONSISTENT",
            "issues":issues,"hard_violations":len(hard),"complete":False}


def rerank(candidate, alternatives, max_candidates=128, min_log_margin=2.0):
    """Search supplied alternatives; retain the original and every rule decision.

    Soft/style signals never eliminate candidates. Incomplete search or unresolved
    semantic review prevents acceptance. This operation never assigns COMPLETE.
    """
    if not 1<=max_candidates<=4096: raise ValueError("Invalid search budget")
    allowed={"pitch","type","dots","duration","onset","voice","chord","accidental","tie_to","continuation_to","tuplet_ratio","tuplet_group"}
    choices=[];seen=set();event_ids={e.get("id") for e in candidate.get("events",[])}
    for axis in alternatives:
        key=(axis["event_id"],axis["field"])
        if key in seen or axis["field"] not in allowed or axis["event_id"] not in event_ids: raise ValueError("Invalid alternative axis")
        seen.add(key)
        values=sorted(axis["choices"],key=lambda c:-c["probability"])
        if not values or any(not math.isfinite(c["probability"]) or not 0<c["probability"]<=1 for c in values):
            raise ValueError("Invalid alternative probability")
        choices.append(values)
    def score(indexes): return -sum(math.log(choices[i][j]["probability"]) for i,j in enumerate(indexes))
    start=(0,)*len(choices);queue=[(score(start),start)];visited={start};survivors=[];audit=[]
    while queue and len(audit)<max_candidates:
        cost,indexes=heapq.heappop(queue);value=deepcopy(candidate)
        by_id={e["id"]:e for e in value.get("events",[])}
        for i,j in enumerate(indexes): by_id[alternatives[i]["event_id"]][alternatives[i]["field"]]=choices[i][j]["value"]
        report=verify_measure(value)
        audit.append({"choices":list(indexes),"negative_log_probability":cost,"verification":report})
        if report["valid_under_declared_semantics"]: survivors.append((cost,value,indexes,report))
        for i in range(len(indexes)):
            nxt=list(indexes);nxt[i]+=1;nxt=tuple(nxt)
            if nxt[i]<len(choices[i]) and nxt not in visited:
                visited.add(nxt);heapq.heappush(queue,(score(nxt),nxt))
    margin=survivors[1][0]-survivors[0][0] if len(survivors)>1 else None
    ambiguous=bool(queue) or not survivors or (margin is not None and margin<min_log_margin)
    if survivors: ambiguous |= survivors[0][3]["review_required"]
    return {"original_prediction":deepcopy(candidate),"alternatives_considered":deepcopy(alternatives),
            "candidate":survivors[0][1] if survivors else deepcopy(candidate),"examined":len(audit),
            "search_exhausted":not queue,"valid_alternatives":len(survivors),"log_margin":margin,
            "abstain":bool(ambiguous),"complete":False,"audit":audit,
            "chosen_choices":list(survivors[0][2]) if survivors else None}
