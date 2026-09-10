"""Training investment and deployment acceptance are separate decisions."""


TRAINING_GATES = {
    'regression_tests_passed':'Regression tests must pass',
    'bounded_overfit_passed':'Representative bounded training must learn the supported target contract',
    'capacity_benchmarks_complete':'Capacity, precision and memory benchmarks must be available',
    'notation_supervision_adequate':'Comprehensive notation requires validated supplemental labels',
    'role_expansion_supervised':'Shared physical heads require supervised semantic role expansion',
    'context_supervision_complete':'Meter and context changes require nonempty validated labels',
    'predicted_proposal_evaluation_connected':'Exact evaluation must use runtime proposals, including omissions',
    'score_decoder_evaluation_connected':'Full notation decoding/export must be connected to exact score metrics',
    'bounded_validation_comparison_complete':'Architecture/capacity quality comparisons must use validation selection sources',
    'sealed_splits_preserved':'Test and future-test must remain sealed',
}


def training_readiness(evidence):
    blockers=[{'gate':name,'reason':reason} for name,reason in TRAINING_GATES.items() if evidence.get(name) is not True]
    return {'ready_for_serious_training':not blockers,'blockers':blockers,
            'long_training_started':False,'deployment_qualified':False,
            'note':'Calibration and deployment risk qualification occur after training; they are not circular prerequisites for training.'}

