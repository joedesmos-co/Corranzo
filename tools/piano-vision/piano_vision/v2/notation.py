"""Versioned notation ontology and lossless MusicXML interchange.

This is representation/export capability, NOT a claim of visual recognition.
Unknown visual regions persist without pretending to be printed words or notes.
"""
from copy import deepcopy
from dataclasses import dataclass, field, asdict
import json
import math
import re
import xml.etree.ElementTree as ET

ONTOLOGY_VERSION = "notation-graph/2.0"
CATEGORIES = ("event", "attribute", "relation", "span", "direction", "context", "structure", "unknown")
XML_NAME = re.compile(r"^(?:\{[^{}]+\})?[A-Za-z_][A-Za-z0-9_.:-]*$")


@dataclass
class NotationNode:
    id: str
    category: str
    type: str
    attributes: dict = field(default_factory=dict)
    anchors: list = field(default_factory=list)
    region: dict | None = None
    confidence: float | None = None
    status: str = "needs_review"
    provenance: list = field(default_factory=list)
    xml: dict | None = None

    def validate(self):
        if not isinstance(self.id,str) or not self.id or self.category not in CATEGORIES or not isinstance(self.type,str) or not re.fullmatch(r"[^:]+:.+",self.type):
            raise ValueError("Invalid notation node identity/category/type")
        if not isinstance(self.attributes,dict) or not isinstance(self.anchors,list) or any(not isinstance(a,str) or not a for a in self.anchors):
            raise ValueError("Invalid notation attributes/anchors")
        if not isinstance(self.provenance,list) or any(not isinstance(p,dict) for p in self.provenance):
            raise ValueError("Invalid notation provenance")
        if self.status not in {"known", "unknown", "unsupported", "needs_review"}:
            raise ValueError("Invalid notation status")
        if self.confidence is not None and (not math.isfinite(self.confidence) or not 0<=self.confidence<=1):
            raise ValueError("Invalid notation confidence")
        if self.region is not None:
            b=self.region.get("box")
            if not isinstance(b,list) or len(b)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in b):
                raise ValueError("Invalid notation region")
            if not (0<=b[0]<b[2]<=1 and 0<=b[1]<b[3]<=1) or not isinstance(self.region.get("page"),int) or self.region["page"]<1:
                raise ValueError("Invalid notation region bounds/page")
        if self.category=="unknown" and self.region is None:
            raise ValueError("Unknown visual notation must retain its source region")
        if self.xml is not None:
            tree_element(self.xml)
        # Enforce serializability and reject NaN even inside future attributes.
        json.dumps(asdict(self),allow_nan=False)
        return self


def xml_tree(element):
    return {"tag":element.tag,"attributes":dict(element.attrib),"text":element.text,
            "tail":element.tail,"children":[xml_tree(c) for c in element]}


def tree_element(tree, depth=0, budget=None):
    budget=[100_000] if budget is None else budget
    budget[0]-=1
    if depth>64 or budget[0]<0: raise ValueError("Notation tree capacity exceeded")
    if not isinstance(tree,dict) or set(tree)-{"tag","attributes","text","tail","children"}:
        raise ValueError("Invalid notation tree fields")
    tag=tree.get("tag")
    if not isinstance(tag,str) or not XML_NAME.fullmatch(tag): raise ValueError("Invalid XML element name")
    attrs=tree.get("attributes",{})
    if not isinstance(attrs,dict) or any(not isinstance(k,str) or not XML_NAME.fullmatch(k) or not isinstance(v,str) for k,v in attrs.items()):
        raise ValueError("Invalid XML attributes")
    for key in ("text","tail"):
        if tree.get(key) is not None and not isinstance(tree[key],str): raise ValueError("Invalid XML text")
    element=ET.Element(tag,attrs);element.text=tree.get("text");element.tail=tree.get("tail")
    for child in tree.get("children",[]): element.append(tree_element(child,depth+1,budget))
    return element


def parse_musicxml(payload):
    if isinstance(payload,str): payload=payload.encode()
    if len(payload)>64*1024**2 or b"<!ENTITY" in payload.upper(): raise ValueError("Unsupported XML entity/content size")
    root=ET.fromstring(payload)
    if root.tag not in {"score-partwise","score-timewise","opus"}: raise ValueError("Unsupported MusicXML root")
    return {"schema_version":ONTOLOGY_VERSION,"document":xml_tree(root),"notations":[],
            "recognition_provenance":"interchange_only","visual_coverage_qualified":False}


def export_musicxml(document, require_high_fidelity=False):
    if document.get("schema_version")!=ONTOLOGY_VERSION: raise ValueError("Unsupported notation ontology")
    root=tree_element(document["document"])
    if root.tag not in {"score-partwise","score-timewise","opus"}: raise ValueError("Invalid MusicXML root")
    nodes=[NotationNode(**n).validate() for n in document.get("notations",[])]
    ids=[n.id for n in nodes]
    if len(set(ids))!=len(ids): raise ValueError("Duplicate notation id")
    unresolved=[asdict(n) for n in nodes if n.status!="known" or n.category=="unknown"]
    exported_ids=[]
    for node in nodes:
        if node.status!="known" or node.category=="unknown": continue
        try:
            target=root
            path=node.attributes.get("xml_parent_path") if node.xml is not None else node.attributes.get("document_path")
            if not isinstance(path,list): raise ValueError("Missing export binding")
            for index in path:
                if not isinstance(index,int) or index<0: raise ValueError("Invalid export path")
                target=target[index]
            if node.xml is not None:
                target.append(tree_element(node.xml))
            elif node.type.startswith("xml:") and target.tag!=node.type[4:]:
                raise ValueError("Export binding does not match notation type")
            exported_ids.append(node.id)
        except (ValueError,IndexError,TypeError):
            failed=asdict(node);failed["status"]="needs_review"
            failed["provenance"].append({"reason":"UNMAPPED_NOTATION_EXPORT"})
            unresolved.append(failed)
    high_fidelity=(not unresolved and document.get("visual_coverage_qualified") is True
                   and document.get("verified_complete") is True)
    if unresolved and root.tag!="opus":
        identification=root.find("identification")
        if identification is None:
            identification=ET.Element("identification")
            before=next((i for i,c in enumerate(root) if c.tag not in {"work","movement-number","movement-title"}),len(root))
            root.insert(before,identification)
        miscellaneous=identification.find("miscellaneous")
        if miscellaneous is None: miscellaneous=ET.SubElement(identification,"miscellaneous")
        name="corranzo:unresolved-notation-v2"
        for old in list(miscellaneous):
            if old.get("name")==name: miscellaneous.remove(old)
        ET.SubElement(miscellaneous,"miscellaneous-field",{"name":name}).text=json.dumps(unresolved,ensure_ascii=False,allow_nan=False)
    xml=ET.tostring(root,encoding="unicode")
    from .xml_validation import validate_musicxml
    validation=validate_musicxml(xml)
    high_fidelity=high_fidelity and validation["valid"]
    if require_high_fidelity and not high_fidelity: raise ValueError("HIGH_FIDELITY_NOT_QUALIFIED")
    return {"musicxml":xml,"high_fidelity":high_fidelity,"schema_validation":validation,
            "review_sidecar":{"schema_version":ONTOLOGY_VERSION,"unresolved":unresolved},
            "exported_notation_ids":exported_ids,
            "exported_element_count":sum(1 for _ in root.iter()),"status":"complete" if high_fidelity else "draft"}


def unknown_region(identifier,page,box,reason="UNSUPPORTED_NOTATION",alternatives=None):
    return asdict(NotationNode(identifier,"unknown","corranzo:unknown-region",
                              attributes={"reason":reason,"alternatives":alternatives or []},
                              region={"page":page,"box":list(box)},status="unknown").validate())


def make_note(*, pitch=None, rest=False, duration=None, type="quarter", dots=0,
              grace=None, cue=False, size=None, chord=False, voice="1", staff=1,
              accidental=None, beams=(), notations=(), attributes=None):
    """Construct schema-ordered notes without conflating size, grace and cue.

    `grace=None` means non-grace, `{}` means grace with unspecified performance
    timing. Both grace and cue can be represented together as MusicXML permits.
    """
    if dots<0 or not isinstance(dots,int): raise ValueError("Invalid dot count")
    note=ET.Element("note",dict(attributes or {}))
    if grace is not None: ET.SubElement(note,"grace",{k:str(v) for k,v in grace.items()})
    if cue: ET.SubElement(note,"cue")
    if chord: ET.SubElement(note,"chord")
    if rest:
        if pitch is not None: raise ValueError("Rest cannot also contain a pitch")
        ET.SubElement(note,"rest")
    elif pitch is not None:
        step,octave,alter=pitch
        p=ET.SubElement(note,"pitch");ET.SubElement(p,"step").text=str(step)
        if alter is not None: ET.SubElement(p,"alter").text=str(alter)
        ET.SubElement(p,"octave").text=str(octave)
    else: raise ValueError("Note needs pitch or rest")
    if grace is None:
        if duration is None or int(duration)!=duration or duration<=0: raise ValueError("Metric notes require positive integer divisions")
        ET.SubElement(note,"duration").text=str(int(duration))
    ET.SubElement(note,"voice").text=str(voice)
    t=ET.SubElement(note,"type",{"size":size} if size else {});t.text=type
    for _ in range(dots): ET.SubElement(note,"dot")
    if accidental:
        a=deepcopy(accidental); value=a.pop("value")
        ET.SubElement(note,"accidental",{k:str(v) for k,v in a.items()}).text=value
    ET.SubElement(note,"staff").text=str(staff)
    for number,value in beams: ET.SubElement(note,"beam",{"number":str(number)}).text=value
    if notations:
        n=ET.SubElement(note,"notations")
        for tree in notations: n.append(tree_element(tree))
    return xml_tree(note)


class NotationCodec:
    """Stable UTF-8 alphabet for structured node payloads; schema is versioned.

    It trades token efficiency for extensibility. A future subword codec can be
    versioned independently. BOS/EOS/PAD never overlap Unicode bytes.
    """
    PAD=0;BOS=1;EOS=2;OFFSET=3;VOCAB_SIZE=259

    @classmethod
    def encode(cls,node,max_length=4096):
        if isinstance(node,NotationNode): node=asdict(node.validate())
        else: NotationNode(**node).validate()
        data=json.dumps(node,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode("utf8")
        if len(data)+2>max_length: raise ValueError("NOTATION_TOKEN_CAPACITY")
        return [cls.BOS]+[v+cls.OFFSET for v in data]+[cls.EOS]

    @classmethod
    def decode(cls,tokens):
        if not tokens or tokens[0]!=cls.BOS or cls.EOS not in tokens: raise ValueError("INCOMPLETE_NOTATION_SEQUENCE")
        end=tokens.index(cls.EOS)
        if any(t!=cls.PAD for t in tokens[end+1:]): raise ValueError("TRAILING_NOTATION_TOKENS")
        payload=bytes(t-cls.OFFSET for t in tokens[1:end]).decode("utf8")
        node=NotationNode(**json.loads(payload)).validate()
        return asdict(node)

    @classmethod
    def decode_or_unknown(cls,tokens,identifier,page,box):
        try:
            node=cls.decode(tokens)
            # Identity, region and confidence come from runtime evidence, never
            # generated strings. A token sequence cannot self-certify acceptance.
            node.update(id=identifier,region={"page":page,"box":list(box)},confidence=None,status="needs_review",provenance=[])
            return asdict(NotationNode(**node).validate())
        except (ValueError,TypeError,UnicodeError,KeyError,OverflowError):
            return unknown_region(identifier,page,box,"INVALID_OR_INCOMPLETE_NOTATION_SEQUENCE")

    @classmethod
    def encode_supervision(cls,node,max_length=4096):
        """Exclude opaque IDs, source coordinates and confidence from targets."""
        node=asdict(node) if isinstance(node,NotationNode) else deepcopy(node)
        NotationNode(**node).validate()
        attrs={k:v for k,v in node.get("attributes",{}).items() if k not in {"xml_parent_path","document_path"}}
        anchors=node.get("anchors",[])
        if any(not re.fullmatch(r"(?:event|span|context):\d+",a) for a in anchors):
            raise ValueError("Notation anchors require local pointer aliases")
        target=NotationNode("decoded",node["category"],node["type"],attributes=attrs,anchors=anchors,
                            xml=node.get("xml"),status="needs_review")
        if target.category=="unknown":
            # Unknown training preserves type but never memorizes region geometry.
            target.region={"page":1,"box":[0.,0.,1.,1.]}
        return cls.encode(target,max_length)
