from copy import deepcopy
from dataclasses import replace,asdict
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import numpy as np
import torch
from PIL import Image,ImageDraw

from test_stack import record,label
from piano_vision.v2.config import V2Config,PRESETS
from piano_vision.v2.data import build_inputs,tensorize,collate,crop_view,map_box,source_order,development_scores
from piano_vision.v2.model import PianoVisionV2
from piano_vision.v2.visual import RegionSampler
from piano_vision.v2.loss import semantic_loss
from piano_vision.v2.notation import (NotationNode,NotationCodec,unknown_region,make_note,tree_element,
                                      parse_musicxml,export_musicxml,xml_tree)
from piano_vision.v2.notation_model import NotationDecoder
from piano_vision.v2.verifier import verify_measure,written_duration,rerank
from piano_vision.v2.calibration import validation_partition,fit_temperature,binomial_upper,completion_decision
from piano_vision.v2.evaluation import ExactMetrics
from piano_vision.v2.checkpoint import save_checkpoint,load_checkpoint,migrate_weights,promotion_gate
from piano_vision.v2.streaming import FeatureCache,stream_pages
from piano_vision.v2.quality import normalize_page,rectify,rotate_expand,read_pages

CFG=V2Config(channels=(8,12,16,24),depths=(1,1,1,1),hidden=32,heads=4,layers=1,
             image_height=48,image_width=96,dropout=0,source_dropout=0,max_objects=16)


class Images:
    def page(self,record):
        image=Image.new('L',(400,600),'white');d=ImageDraw.Draw(image)
        for y in (220,230,240,250,260): d.line((30,y,370,y),fill=0,width=2)
        d.ellipse((112,232,128,248),fill=0)
        return image


def sample_records():
    a=record('unit-score','train')
    a['input']['modelInput']['geometry']['staffBands']['staffBands']=[{'staffRole':'upper','y0':.35,'y1':.45}]
    b=deepcopy(a);b['exampleId']='unit-score:semantic-m2'
    return a,b


def good_measure():
    return {'proposal_complete':True,'relations_complete':True,'notation_complete':True,
            'time_signature':[4,4],'staff_context':{'1':{'key_fifths':0}},
            'events':[{'id':'a','onset':'0','duration':'4','type':'whole','pitch':['C',4,0],
                       'voice':'v1','staff':1,'duration_encoding_complete':True}]}


def staff_image():
    img=Image.new('L',(800,1100),'white');d=ImageDraw.Draw(img)
    for sy in (150,350,550,750):
        for y in range(sy,sy+41,10): d.line((60,y,740,y),fill=0,width=2)
        for x in range(100,701,90):
            d.ellipse((x,sy+14,x+12,sy+23),fill=0);d.line((x+12,sy+18,x+12,sy-20),fill=0,width=2)
    return img


class DataModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): torch.set_num_threads(2)

    def test_config_rejects_invalid_capacity(self):
        with self.assertRaises(ValueError): replace(CFG,hidden=31)
        with self.assertRaises(ValueError): replace(CFG,max_objects=1)

    def test_order_parses_production_not_lexicographic(self):
        rows=[{'exampleId':f's:p{p}-s{s}-x{x}'} for p,s,x in [(2,0,1),(1,10,2),(1,2,100),(1,2,20)]]
        self.assertEqual([source_order(r) for r in sorted(rows,key=source_order)],[(1,2,20),(1,2,100),(1,10,2),(2,0,1)])

    def test_sealed_splits_fail_before_index_read(self):
        for split in ('test','future-test'):
            with self.assertRaises(PermissionError): next(development_scores('/does/not/exist',split,1))

    def test_coordinate_roundtrip_includes_letterbox_padding(self):
        page=Image.new('L',(321,567),'white')
        image,h,back=crop_view(page,(.19,.23,.71,.63),192,512)
        points=np.array([[.3,.4,1],[.6,.6,1]])
        mapped=points@h.T
        np.testing.assert_allclose(mapped@back.T,points,atol=1e-12)
        # Direct affine location of a pixel agrees with measured dark centroid.
        pixel=Image.new('L',page.size,'white');ImageDraw.Draw(pixel).rectangle((95,225,97,227),fill=0)
        image,h,_=crop_view(pixel,(.19,.23,.71,.63),192,512)
        expected=np.array([96.5/321,226.5/567,1])@h.T
        weight=1-image[0].numpy();ys,xs=np.indices(weight.shape)
        self.assertLess(abs(((xs+.5)*weight).sum()/weight.sum()/512-expected[0]),.005)
        self.assertLess(abs(((ys+.5)*weight).sum()/weight.sum()/192-expected[1]),.005)

    def test_own_view_sampler_and_no_edge_clamp(self):
        sampler=RegionSampler(1)
        features=[torch.stack([torch.ones(1,4,4),torch.ones(1,4,4)*3])]
        boxes=torch.tensor([[[.4,.4,.6,.6],[.4,.4,.6,.6],[2.,2.,3.,3.]]])
        values=sampler(features,boxes,torch.tensor([[0,1,0]]),torch.ones(1,3,dtype=torch.bool),2)
        torch.testing.assert_close(values[0,:,0],torch.tensor([1.,3.,0.]))

    def test_input_truth_firewall_and_cross_score_rejection(self):
        a,b=sample_records();x=build_inputs(a,[a,b],Images(),CFG)[0]
        changed=deepcopy(a);changed['target']={'malicious':'must never be read'}
        y=build_inputs(changed,[changed,b],Images(),CFG)[0]
        for k,v in x.items():
            if torch.is_tensor(v): torch.testing.assert_close(v,y[k])
        b['split']='validation'
        with self.assertRaises(PermissionError): build_inputs(a,[a,b],Images(),CFG)

    def test_neighbor_crops_and_overflow_are_explicit(self):
        a,b=sample_records();s=tensorize(a,[a,b],Images(),replace(CFG,max_objects=2))
        self.assertEqual(s['metadata']['truncated_objects'],2)
        s=tensorize(a,[a,b],Images(),CFG)
        self.assertNotEqual(s['object_view'][0],s['object_view'][2])
        self.assertEqual(s['metadata']['proposal_completeness'],'UNQUALIFIED')

    def test_context_key_supervision_and_conflict_mask(self):
        a,b=sample_records();s=tensorize(a,[a,b],Images(),CFG)
        self.assertEqual(int(s['targets']['context']['key_fifths']['mask'].sum()),1)
        a['target']['families']['PITCH_STAFF'][1]['value']=deepcopy(a['target']['families']['PITCH_STAFF'][1]['value'])
        a['target']['families']['PITCH_STAFF'][1]['value']['accidentalState']['keyContext']['fifths']=3
        s=tensorize(a,[a,b],Images(),CFG)
        self.assertEqual(int(s['targets']['context']['key_fifths']['mask'].sum()),0)

    def test_three_conflicting_duration_labels_stay_masked(self):
        a,b=sample_records();labels=a['target']['families']['DURATION']
        one=deepcopy(labels[0]);two=deepcopy(one);two['value']['writtenType']='eighth'
        a['target']['families']['DURATION']=[one,two,deepcopy(one)]
        s=tensorize(a,[a,b],Images(),CFG)
        self.assertFalse(s['targets']['object']['duration_type']['mask'][0])

    def test_model_loss_gradient_refinement_and_masks(self):
        a,b=sample_records();batch=collate([tensorize(a,[a,b],Images(),CFG)])
        m=PianoVisionV2(CFG);out=m(batch);loss,count=semantic_loss(out,batch['targets']);loss.backward()
        self.assertTrue(torch.isfinite(loss));self.assertGreater(int(count),0)
        for name in ('object_feedback.weight','context_feedback.weight','relation_feedback.weight','backbone.detail.0.weight'):
            gradient=dict(m.named_parameters())[name].grad
            self.assertIsNotNone(gradient,name);self.assertTrue(torch.isfinite(gradient).all(),name)
            self.assertGreater(float(gradient.abs().sum()),0,name)

    def test_hierarchy_visual_context_changes_note_predictions(self):
        a,b=sample_records();batch=collate([tensorize(a,[a,b],Images(),CFG)])
        m=PianoVisionV2(CFG).eval()
        with torch.no_grad():
            first=m(batch)['object']['pitch_written_step']
            # View 0 is page thumbnail; local object pixels unchanged.
            batch['images'][:,0]=0
            second=m(batch)['object']['pitch_written_step']
        self.assertGreater(float((first-second).abs().max()),1e-7)

    def test_padded_objects_do_not_change_valid_predictions(self):
        a,b=sample_records();small=tensorize(a,[a],Images(),CFG);big=tensorize(a,[a,b],Images(),CFG)
        model=PianoVisionV2(CFG).eval()
        with torch.no_grad():
            left=model(collate([small]))['object']['pitch_octave'][0]
            right=model(collate([small,big]))['object']['pitch_octave'][0,:len(left)]
        torch.testing.assert_close(left,right,atol=2e-5,rtol=2e-5)

    def test_no_refinement_finite_and_masked_loss(self):
        a,b=sample_records();batch=collate([tensorize(a,[a,b],Images(),CFG)])
        out=PianoVisionV2(replace(CFG,refinement_steps=0))(batch)
        self.assertIsNone(out['initial'])
        for group in batch['targets'].values():
            for p in group.values(): p['mask'].zero_()
        loss,count=semantic_loss(out,batch['targets']);self.assertEqual(float(loss),0);self.assertEqual(int(count),0)

    def test_cached_inference_matches_uncached_and_rejects_training(self):
        a,b=sample_records();batch=collate([tensorize(a,[a,b],Images(),CFG)])
        model=PianoVisionV2(CFG);cache=FeatureCache('weights','fp32')
        with self.assertRaises(ValueError): cache.get_views(model,batch['images'])
        model.eval()
        with torch.no_grad():
            first=model(batch)['object']['lane']
            encoded=cache.get_views(model,batch['images']);second=model(batch,encoded)['object']['lane']
            cache.get_views(model,batch['images'])
        torch.testing.assert_close(first,second,atol=2e-5,rtol=2e-5);self.assertGreater(cache.hits,0)


class VerifierTests(unittest.TestCase):
    def test_good_chord_not_double_counted_and_order_invariant(self):
        c=good_measure();c['metric_contract_complete']=True
        c['events'][0].update(chord='g',chord_lead=True)
        other=deepcopy(c['events'][0]);other.update(id='b',pitch=['E',4,0],chord_lead=False)
        c['events'].append(other)
        self.assertTrue(verify_measure(c)['consistent'])
        c['events'].reverse();self.assertTrue(verify_measure(c)['consistent'])

    def test_legal_shorter_chord_tones(self):
        c=good_measure();c['events'][0].update(chord='g',chord_lead=True)
        other=deepcopy(c['events'][0]);other.update(id='b',pitch=['E',4,0],duration='2',type='half',chord_lead=False)
        c['events'].append(other);self.assertTrue(verify_measure(c)['consistent'])
        other['duration']='8';other['type']='breve'
        self.assertIn('CHORD_MEMBER_LONGER_THAN_LEAD',[i['code'] for i in verify_measure(c)['issues']])

    def test_voice_gap_soft_unless_explicit_complete_contract(self):
        c=good_measure();c['events'][0].update(onset='2',duration='2',type='half')
        r=verify_measure(c);self.assertTrue(r['valid_under_declared_semantics']);self.assertTrue(r['review_required'])
        c['metric_contract_complete']=True;self.assertFalse(verify_measure(c)['valid_under_declared_semantics'])

    def test_free_meter_pickup_and_irregular_are_not_normalized(self):
        for flags in ({'free_meter':True},{'cadenza':True},{'pickup':True},{'irregular':True}):
            c=good_measure();c.update(flags);c['events'][0].update(duration='1',type='quarter')
            before=deepcopy(c);self.assertTrue(verify_measure(c)['valid_under_declared_semantics']);self.assertEqual(c,before)

    def test_grace_does_not_consume_meter_and_cue_does(self):
        c=good_measure();e=deepcopy(c['events'][0]);e.update(id='gr',duration='0',type='eighth',grace=True)
        c['events'].insert(0,e);self.assertTrue(verify_measure(c)['consistent'])
        e['grace']=False;e['cue']=True;self.assertFalse(verify_measure(c)['consistent'])

    def test_arbitrary_and_nested_tuplets(self):
        self.assertEqual(str(written_duration({'type':'eighth','time_ratio':[13,8]})),'4/13')
        c=good_measure();c.update(free_meter=True)
        c['events'][0].update(type='eighth',duration='4/15',time_ratio=[15,8],tuplet_groups=['outer','inner'])
        c['tuplets']={x:{'complete':True,'members':['a'],'duration':'4/15'} for x in ('outer','inner')}
        self.assertTrue(verify_measure(c)['consistent'])

    def test_tie_contradiction_and_missing_boundary(self):
        c=good_measure();c['events'][0].update(tie_to='b',tie_semantics='exact-written')
        self.assertEqual(verify_measure(c)['status'],'REVIEW')
        c['external_events']={'b':{'id':'b','pitch':['D',4,0],'onset':'0','measure_offset':'4','voice':'v1'}}
        self.assertEqual(verify_measure(c)['status'],'CONTRADICTORY')

    def test_courtesy_accidental_and_unusual_articulation_preserved(self):
        c=good_measure();c['accidental_policy']='modern-staff-octave'
        c['events'][0].update(accidental={'alter':0,'cautionary':True,'affects_pitch':False},articulations=['staccato'],tie_start=True)
        before=deepcopy(c);self.assertTrue(verify_measure(c)['consistent']);self.assertEqual(c,before)

    def test_unknown_prevents_consistency_and_no_empty_success(self):
        c=good_measure();c['unknown_regions']=[{'id':'x'}]
        self.assertFalse(verify_measure(c)['consistent']);self.assertFalse(verify_measure({})['consistent'])

    def test_reranking_is_auditable_and_not_destructive(self):
        c=good_measure();c['accidental_policy']='modern-staff-octave';c['accidental_evidence_complete']=True;c['events'][0]['pitch']=['C',4,1]
        original=deepcopy(c)
        axes=[{'event_id':'a','field':'pitch','choices':[{'value':['C',4,1],'probability':.6},{'value':['C',4,0],'probability':.4}]}]
        result=rerank(c,axes);self.assertEqual(c,original);self.assertEqual(result['candidate']['events'][0]['pitch'],['C',4,0])
        self.assertEqual(result['examined'],2);self.assertEqual(result['original_prediction'],original)
        self.assertTrue(rerank(c,axes,max_candidates=1)['abstain'])


class NotationTests(unittest.TestCase):
    def test_grace_cue_and_small_ordinary_are_distinct(self):
        grace=tree_element(make_note(pitch=['D',4,0],type='16th',grace={'slash':'yes'},size='cue'))
        cue=tree_element(make_note(pitch=['D',4,0],duration=1,type='16th',cue=True,size='cue'))
        small=tree_element(make_note(pitch=['D',4,0],duration=1,type='16th',size='cue'))
        self.assertIsNotNone(grace.find('grace'));self.assertIsNone(grace.find('duration'))
        self.assertIsNotNone(cue.find('cue'));self.assertIsNotNone(cue.find('duration'))
        self.assertIsNone(small.find('cue'));self.assertIsNone(small.find('grace'))

    def test_broad_xml_roundtrip_preserves_trees(self):
        xml='''<score-partwise version="4.0"><work><work-title>Élan</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>12</divisions><time><senza-misura/></time><staves>2</staves></attributes><direction><direction-type><words>rit. e rubato</words><pedal type="change" line="yes"/><wedge type="crescendo" number="2"/></direction-type></direction><note><grace slash="yes"/><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><voice>1</voice><type size="cue">16th</type><accidental cautionary="yes">sharp</accidental><beam number="1">begin</beam><notations><slur type="start" number="2"/><tuplet type="start" number="1"/><tuplet type="start" number="2"/><articulations><staccato/><tenuto/></articulations><ornaments><inverted-turn/><tremolo type="single">3</tremolo></ornaments><technical><fingering substitution="yes">2</fingering></technical><arpeggiate direction="up"/></notations></note><barline location="right"><ending number="1,2" type="discontinue"/><repeat direction="backward" times="3"/></barline></measure></part></score-partwise>'''
        document=parse_musicxml(xml);result=export_musicxml(document)
        self.assertEqual(xml_tree(ET.fromstring(result['musicxml'])),document['document'])
        self.assertFalse(result['high_fidelity'])

    def test_unknown_survives_export_and_blocks_complete(self):
        d=parse_musicxml('<score-partwise><part-list/></score-partwise>')
        d['notations']=[unknown_region('u',1,[.1,.2,.3,.4])]
        result=export_musicxml(d)
        self.assertIn('corranzo:unresolved-notation-v2',result['musicxml']);self.assertEqual(len(result['review_sidecar']['unresolved']),1)
        with self.assertRaises(ValueError): export_musicxml(d,require_high_fidelity=True)

    def test_unbound_known_mark_does_not_disappear(self):
        d=parse_musicxml('<score-partwise><part-list/></score-partwise>')
        d['notations']=[asdict(NotationNode('n','direction','xml:words',status='known',attributes={'text':'a tempo'}))]
        result=export_musicxml(d);self.assertEqual(result['review_sidecar']['unresolved'][0]['id'],'n')

    def test_codec_unicode_and_invalid_sequence_review(self):
        n=NotationNode('n','direction','xml:words',attributes={'text':'très doux – cantabile'},status='needs_review')
        self.assertEqual(NotationCodec.decode(NotationCodec.encode(n)),asdict(n))
        unknown=NotationCodec.decode_or_unknown([1,30,2],'x',1,[.1,.1,.2,.2]);self.assertEqual(unknown['category'],'unknown')

    def test_shared_decoder_causal_and_region_conditioned(self):
        torch.manual_seed(2);m=NotationDecoder(32,width=32,max_length=32).eval()
        region=torch.randn(1,32);a=torch.tensor([[1,10,11,12]]);b=torch.tensor([[1,10,99,99]])
        with torch.no_grad(): x=m(region,a);y=m(region,b);z=m(region+1,a)
        torch.testing.assert_close(x[:,:2],y[:,:2]);self.assertGreater(float((x-z).abs().sum()),0)

    def test_invalid_region_and_xml_names_rejected(self):
        with self.assertRaises(ValueError): unknown_region('x',1,[.5,.1,.2,.2])
        with self.assertRaises(ValueError): tree_element({'tag':'note><evil'})
        with self.assertRaises(ValueError): parse_musicxml('<!ENTITY x "oops"><score-partwise/>')


class SafetyEvaluationTests(unittest.TestCase):
    def test_checkpoint_strict_resume_and_explicit_partial_migration(self):
        m=PianoVisionV2(CFG);o=torch.optim.AdamW(m.parameters())
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.pt';save_checkpoint(path,m,o,3,'data')
            self.assertEqual(load_checkpoint(path,m,o,dataset_digest='data')['step'],3)
            with self.assertRaises(ValueError): load_checkpoint(path,m,dataset_digest='other')
            with self.assertRaises(FileExistsError): save_checkpoint(path,m,o,4,'data')
        state={'source':torch.zeros_like(m.heads.object['lane'].weight),'bad':torch.zeros(2,2)}
        r=migrate_weights(state,m,{'source':'heads.object.lane.weight','bad':'heads.object.rest.weight'})
        self.assertEqual(len(r['copied']),1);self.assertEqual(r['skipped'][0]['reason'],'shape_mismatch')

    def test_temperature_partitions_and_no_train_calibration(self):
        source=next(str(i) for i in range(100) if validation_partition(str(i))=='temperature')
        logits=torch.tensor([[5.,0.],[5.,0.],[5.,0.],[0.,5.]])
        target=torch.tensor([0,1,0,1]);result=fit_temperature(logits,target,[source])
        self.assertLessEqual(result['nll_after'],result['nll_before'])
        with self.assertRaises(PermissionError): fit_temperature(logits,target,[source],split='train')
        self.assertGreater(binomial_upper(0,100),.02);self.assertEqual(binomial_upper(0,0),1)

    def test_complete_never_from_uncalibrated_or_contradiction(self):
        certificate={'qualified':True,'model_digest':'m','domain':'piano','threshold':.9}
        report=verify_measure(good_measure())
        quality={'recognition_allowed':True,'calibrated':True,'complete_eligible':True}
        self.assertTrue(completion_decision(.99,report,quality,[],certificate,'m','piano')['complete'])
        report['review_required']=True
        self.assertFalse(completion_decision(.99,report,quality,[],certificate,'m','piano')['complete'])
        self.assertFalse(completion_decision(.99,report,quality,[],None,'m','piano')['complete'])

    def test_missing_page_and_wrong_complete_denominators(self):
        m=ExactMetrics([('s',1,'a'),('s',2,'b')]);v={'consistent':True,'review_required':False}
        m.add(('s',1,'a'),raw_exact=False,truth_complete=True,offered=True,verification=v,notation_complete=True)
        r=m.summary();self.assertEqual(r['measure']['wrong_complete'],1);self.assertEqual(r['score']['coverage'],0)
        self.assertEqual(r['score']['raw_exact_rate_all'],0);self.assertEqual(r['page']['missing_units'],1)
        with self.assertRaises(ValueError): m.add(('s',1,'a'),raw_exact=True,truth_complete=True,offered=False,verification=v,notation_complete=True)

    def test_promotion_refuses_missing_metrics_and_regressions(self):
        a={'checkpoint_digest':'a','evaluation_manifest':'e','domain':'d','notation_schema':'n','metrics':{'exact':.8}}
        b={**a,'parent_champion':'a','replay_digest':'r','risk_qualified':True,'metrics':{'exact':.7}}
        self.assertFalse(promotion_gate(a,b,{'exact':'higher'})['promote'])
        b['metrics']['exact']=.9;self.assertTrue(promotion_gate(a,b,{'exact':'higher'})['promote'])
        self.assertFalse(promotion_gate(a,b,{'missing':'higher'})['promote'])

    def test_page_stream_yields_before_whole_score_finishes(self):
        consumed=[]
        def pages():
            for i in range(3): consumed.append(i);yield i,None
        output=stream_pages(pages(),lambda i,p:{'page':i},lambda l,r:{**l,'boundary_checked':True})
        self.assertEqual(next(output)['event'],'page_provisional');self.assertEqual(consumed,[0])
        self.assertEqual(len(list(output)),5)


class QualityTests(unittest.TestCase):
    def test_clean_and_blur_and_resolution(self):
        image=staff_image();result=normalize_page(image,orientation_degrees=0)
        self.assertTrue(result['quality']['recognition_allowed'],result['quality'])
        self.assertFalse(result['quality']['calibrated'])
        small=normalize_page(image.resize((120,165)),orientation_degrees=0)
        self.assertIn('INSUFFICIENT_RESOLUTION',small['quality']['reasons'])
        from PIL import ImageFilter
        blurred=normalize_page(image.filter(ImageFilter.GaussianBlur(7)),orientation_degrees=0)
        self.assertFalse(blurred['quality']['recognition_allowed'],blurred['quality'])

    def test_perspective_is_rectified_before_quality(self):
        import cv2
        image=np.asarray(staff_image());h,w=image.shape
        corners=np.array([[90,30],[w-35,90],[w-5,h-45],[35,h-10]],np.float32)
        matrix=cv2.getPerspectiveTransform(np.array([[0,0],[w-1,0],[w-1,h-1],[0,h-1]],np.float32),corners)
        photo=cv2.warpPerspective(image,matrix,(w,h),borderValue=45)
        result=normalize_page(photo,corners=corners,orientation_degrees=0)
        self.assertIn('perspective_rectification',result['quality']['applied'])
        self.assertTrue(result['quality']['recognition_allowed'],result['quality'])
        np.testing.assert_allclose(result['source_to_canonical']@result['canonical_to_source'],np.eye(3),atol=1e-8)

    def test_rotation_canvas_expands_and_blank_rejects(self):
        image=np.asarray(staff_image());rotated,h=rotate_expand(image,12)
        self.assertGreater(rotated.shape[1],image.shape[1])
        result=normalize_page(rotated,orientation_degrees=0)
        self.assertNotIn('UNRECOVERABLE_PERSPECTIVE',result['quality']['reasons'])
        self.assertFalse(normalize_page(Image.new('L',(800,1100),'white'))['quality']['recognition_allowed'])

    def test_transparent_images_are_composited_white(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'transparent.png';Image.new('RGBA',(400,600),(0,0,0,0)).save(path)
            page=next(read_pages(path))[1];self.assertEqual(np.asarray(page).min(),255)


if __name__=='__main__': unittest.main()
