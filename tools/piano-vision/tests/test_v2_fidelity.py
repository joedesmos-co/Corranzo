"""Notation and uncertainty integration regressions: legal music must survive."""
from copy import deepcopy
from dataclasses import asdict
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import jsonschema
import numpy as np
import torch

from test_v2 import CFG,Images,sample_records,good_measure
from piano_vision.v2.data import tensorize,collate,attach_notation_sidecar,PageResolver
from piano_vision.v2.model import PianoVisionV2
from piano_vision.v2.loss import semantic_loss
from piano_vision.v2.notation import NotationNode,NotationCodec,make_note,tree_element,parse_musicxml,export_musicxml,unknown_region
from piano_vision.v2.notation_model import NotationDecoder
from piano_vision.v2.xml_validation import validate_musicxml
from piano_vision.v2.verifier import verify_measure
from piano_vision.v2.calibration import certify_risk,validation_partition,completion_decision
from piano_vision.v2.checkpoint import save_checkpoint,load_checkpoint
from piano_vision.v2.context_state import ContextLedger
from piano_vision.v2.readiness import training_readiness,TRAINING_GATES


def score_with_notes(notes):
    root=ET.fromstring('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes></measure></part></score-partwise>')
    for n in notes: root.find('part/measure').append(tree_element(n))
    return ET.tostring(root,encoding='unicode')


def sidecar(record):
    node=NotationNode('region-1','direction','xml:words',attributes={'text':'très doux'},
                      region={'page':1,'box':[.1,.2,.3,.3]},status='known')
    return {'schema_version':'notation-supervision/2.0','score_id':record['scoreId'],
            'example_id':record['exampleId'],'split':record['split'],'alignment_validated':True,
            'source_pixel_digest':hashlib.sha256(np.asarray(Images().page(record),dtype=np.uint8).tobytes()).hexdigest(),
            'regions':[{'state':'KNOWN','region_origin':'human-visual','source_region':deepcopy(node.region),'target':asdict(node)}]}


class FidelityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): torch.set_num_threads(2)

    def test_official_schema_accepts_grace_cue_small_dots_and_beams(self):
        notes=[make_note(pitch=['D',5,1],type='16th',grace={'slash':'yes'},cue=True,size='cue',
                         accidental={'value':'sharp','cautionary':'yes'},beams=[(1,'begin'),(2,'begin')]),
               make_note(pitch=['E',5,0],type='16th',grace={},beams=[(1,'end'),(2,'end')]),
               make_note(pitch=['C',4,0],duration=28,type='quarter',dots=2,cue=True),
               make_note(pitch=['E',4,0],duration=16,type='quarter',size='cue')]
        xml=score_with_notes(notes);result=validate_musicxml(xml)
        self.assertTrue(result['valid'],result)
        exported=export_musicxml(parse_musicxml(xml));self.assertTrue(exported['schema_validation']['valid'])
        self.assertFalse(exported['high_fidelity'])

    def test_schema_rejects_misordered_accidental_and_metric_grace(self):
        xml=score_with_notes([make_note(pitch=['C',4,1],duration=16)])
        root=ET.fromstring(xml);note=root.find('part/measure/note')
        note.insert(0,ET.Element('accidental'));note[0].text='sharp'
        self.assertFalse(validate_musicxml(ET.tostring(root))['valid'])
        xml=score_with_notes([make_note(pitch=['C',4,0],grace={})])
        root=ET.fromstring(xml);d=ET.SubElement(root.find('part/measure/note'),'duration');d.text='1'
        self.assertFalse(validate_musicxml(ET.tostring(root))['valid'])

    def test_export_binding_wrong_element_becomes_review(self):
        d=parse_musicxml(score_with_notes([make_note(pitch=['C',4,0],duration=16)]))
        d['notations']=[asdict(NotationNode('x','direction','xml:words',attributes={'document_path':[0]},status='known'))]
        r=export_musicxml(d);self.assertEqual(r['review_sidecar']['unresolved'][0]['id'],'x')
        self.assertTrue(r['schema_validation']['valid'],r)

    def test_unknown_region_and_unicode_obey_versioned_json_schema(self):
        schema=json.loads((Path(__file__).resolve().parents[1]/'schemas/notation-ontology.schema.json').read_text())
        d=parse_musicxml(score_with_notes([make_note(pitch=['C',4,0],duration=16)]))
        d['notations']=[unknown_region('x',1,[.1,.2,.3,.4])]
        jsonschema.Draft202012Validator(schema).validate(d)
        d['notations'][0]['category']='invented'
        with self.assertRaises(jsonschema.ValidationError): jsonschema.Draft202012Validator(schema).validate(d)

    def test_training_codec_excludes_identity_geometry_and_self_certification(self):
        a=NotationNode('opaque-source-id','direction','xml:words',attributes={'text':'a tempo','document_path':[1,2]},
                       confidence=.99,status='known',region={'page':4,'box':[.1,.2,.3,.4]},provenance=[{'secret':'id'}])
        b=deepcopy(a);b.id='other';b.region={'page':9,'box':[.2,.2,.4,.4]};b.confidence=.3
        self.assertEqual(NotationCodec.encode_supervision(a),NotationCodec.encode_supervision(b))
        result=NotationCodec.decode_or_unknown(NotationCodec.encode(a),'runtime',2,[.2,.3,.4,.5])
        self.assertEqual(result['id'],'runtime');self.assertEqual(result['status'],'needs_review')
        self.assertIsNone(result['confidence']);self.assertEqual(result['region']['page'],2)

    def test_sidecar_mixed_batch_trains_shared_decoder_without_mutation(self):
        a,b=sample_records();sample=tensorize(a,[a,b],Images(),CFG);before=deepcopy(sample['metadata'])
        attached=attach_notation_sidecar(sample,sidecar(a),a,Images(),CFG)
        self.assertEqual(sample['metadata'],before);self.assertNotIn('notation',sample['targets'])
        batch=collate([sample,attached]);model=PianoVisionV2(CFG)
        output=model(batch);loss,count=semantic_loss(output,batch['targets']);loss.backward()
        self.assertTrue(torch.isfinite(loss));self.assertFalse(batch['targets']['notation']['mask'][0].any())
        gradient=model.notation_decoder.output.weight.grad
        self.assertTrue(torch.isfinite(gradient).all());self.assertGreater(float(gradient.abs().sum()),0)
        # Supplemental target strings cannot leak into object predictions.
        with torch.no_grad():
            first=model(batch)['object']['pitch_octave']
            batch['notation_tokens'][:, :,1:]=7
            second=model(batch)['object']['pitch_octave']
        torch.testing.assert_close(first,second)

    def test_sidecar_invalid_alignment_and_late_failure_are_atomic(self):
        a,b=sample_records();sample=tensorize(a,[a,b],Images(),CFG);original=deepcopy(sample['metadata'])
        s=sidecar(a);s['source_pixel_digest']='0'*64
        with self.assertRaises(ValueError):attach_notation_sidecar(sample,s,a,Images(),CFG)
        s=sidecar(a);s['regions'].append(deepcopy(s['regions'][0]));s['regions'][1]['region_origin']='target-xml-only'
        with self.assertRaises(ValueError):attach_notation_sidecar(sample,s,a,Images(),CFG)
        self.assertEqual(sample['metadata'],original)
        s=sidecar(a);s['split']='future-test'
        with self.assertRaises(PermissionError):attach_notation_sidecar(sample,s,a,Images(),CFG)

    def test_generation_bounded_and_cannot_self_certify(self):
        m=NotationDecoder(32,width=32,max_length=16).eval()
        with torch.no_grad():m.output.weight.zero_();m.output.bias.zero_();m.output.bias[NotationCodec.EOS]=10
        r=m.generate(torch.zeros(2,32),max_new_tokens=4)
        self.assertEqual(r['tokens'].shape,(2,2));self.assertTrue(r['terminated'].all());self.assertFalse(r['complete'])
        m.train()
        with self.assertRaises(ValueError):m.generate(torch.zeros(1,32))

    def test_legal_grace_sequence_and_shared_role_review(self):
        c=good_measure();a=deepcopy(c['events'][0]);a.update(id='g1',grace=True,grace_order=0,duration='0',type='16th',continuation_to='g2')
        b=deepcopy(a);b.update(id='g2',grace_order=1);b.pop('continuation_to')
        c['events']=[a,b]+c['events'];self.assertTrue(verify_measure(c)['consistent'])
        c['events'][-1]['role_count']=2
        self.assertIn('SHARED_HEAD_ROLES_UNRESOLVED',[i['code'] for i in verify_measure(c)['issues']])

    def test_accidental_evidence_must_be_complete_before_hard_elimination(self):
        c=good_measure();c['accidental_policy']='modern-staff-octave';c['events'][0]['pitch']=['C',4,1]
        r=verify_measure(c);self.assertTrue(r['valid_under_declared_semantics']);self.assertTrue(r['review_required'])
        c['accidental_evidence_complete']=True;self.assertFalse(verify_measure(c)['valid_under_declared_semantics'])

    def test_additive_irrational_meter_and_cross_staff_voice(self):
        c=good_measure();c['time_signature']=['3+2',8];c['events'][0].update(type='half',duration='5/2',time_ratio=[4,5],staff=2)
        c['staff_context']['2']={'key_fifths':0};c['metric_contract_complete']=True
        self.assertTrue(verify_measure(c)['consistent'])
        c['time_signature']=[3,10];c['events'][0].update(type='quarter',duration='6/5',time_ratio=[5,6])
        self.assertTrue(verify_measure(c)['consistent'])

    def test_context_changes_persist_and_ambiguity_invalidates_old_key(self):
        ledger=ContextLedger()
        def event(i,p,value,state='known',staff=None):
            return {'id':i,'position':p,'part':'p','staff':staff,'field':'key','state':state,'value':value,
                    'origin':'visual-prediction','provenance':[{'region':i,'confidence':.9}]}
        ledger.add(event('k1',[1,0,0,0],{'fifths':3}))
        self.assertEqual(ledger.at([5,3,4,0],'p',1)['key']['value'],{'fifths':3})
        ledger.add(event('u',[3,0,0,0],None,'unknown'))
        self.assertEqual(ledger.at([5,3,4,0],'p',1)['key']['state'],'ambiguous')
        ledger.add(event('k2',[4,0,0,0],{'fifths':-2},staff=2))
        self.assertEqual(ledger.at([5,3,4,0],'p',2)['key']['value'],{'fifths':-2})
        self.assertEqual(ledger.at([5,3,4,0],'p',1)['key']['state'],'ambiguous')
        restored=ContextLedger.restore(ledger.snapshot());self.assertEqual(restored.snapshot(),ledger.snapshot())

    def test_risk_cannot_drop_accepted_unknown_truth(self):
        source=next(str(i) for i in range(100) if validation_partition(str(i))=='risk')
        row={'semantic_source_id':source,'split':'validation','confidence':.99,'structurally_verified':True,
             'truth_complete':False,'correct':True}
        with self.assertRaises(ValueError):certify_risk([row],.9,'m','piano')
        r=completion_decision(2,{'consistent':True},{'recognition_allowed':True,'calibrated':True},[],
                              {'qualified':True,'model_digest':'m','domain':'piano','threshold':.9},'m','piano')
        self.assertFalse(r['complete'])

    def test_scheduler_sampler_and_sidecar_lineage_resume(self):
        m=PianoVisionV2(CFG);o=torch.optim.AdamW(m.parameters());scheduler=torch.optim.lr_scheduler.StepLR(o,10)
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'candidate.pt'
            save_checkpoint(path,m,o,8,'dataset',scheduler=scheduler,sampler_state={'epoch':0,'cursor':8},supervision_manifest='sidecars')
            p=load_checkpoint(path,m,o,dataset_digest='dataset',scheduler=scheduler,supervision_manifest='sidecars')
            self.assertEqual(p['sampler_state']['cursor'],8)
            with self.assertRaises(ValueError):load_checkpoint(path,m,dataset_digest='dataset',supervision_manifest='other')

    def test_historical_split_requires_authoritative_manifest(self):
        a,b=sample_records()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'canonical').mkdir()
            with gzip.open(root/'canonical'/f"{a['scoreId']}.json.gz",'wt') as f:
                json.dump({'scoreId':a['scoreId'],'split':'test'},f)
            with self.assertRaises(PermissionError):PageResolver(root).page(a)
            a['split']='test'
            with self.assertRaises(PermissionError):PageResolver(root).page(a)

    def test_readiness_distinguishes_training_from_later_deployment(self):
        self.assertFalse(training_readiness({})['ready_for_serious_training'])
        r=training_readiness({k:True for k in TRAINING_GATES})
        self.assertTrue(r['ready_for_serious_training']);self.assertFalse(r['deployment_qualified'])


if __name__=='__main__':unittest.main()
