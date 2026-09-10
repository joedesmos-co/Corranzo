#!/usr/bin/env python3
"""Five sequential bounded diagnostics, never production training.

Every case: the same four train scopes, 100 updates, three disjoint selection
validation sources (up to nine scopes). No calibration/risk/test selection.
These diagnose implementation behavior; they cannot establish a quality Pareto.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--index',type=Path,required=True)
    p.add_argument('--output-directory',type=Path,required=True)
    args=p.parse_args();args.output_directory.mkdir(parents=True,exist_ok=True)
    results=[]
    for variant,ablation in [('compact','full'),('compact','no-refinement'),('compact','no-global'),('medium','full'),('large','full')]:
        target=args.output_directory/f'diagnostic-{variant}-{ablation}.json'
        if target.exists():
            print(f'Existing immutable result: {target}',flush=True);continue
        log=target.with_suffix('.txt')
        command=[sys.executable,str(Path(__file__).with_name('run-v2.py')),'smoke',
                 '--index',str(args.index),'--variant',variant,'--ablation',ablation,
                 '--steps','100','--examples','4','--validation-scores','3','--output',str(target)]
        print(f'Starting bounded diagnostic: {variant}, {ablation}',flush=True)
        with log.open('x') as stream:
            result=subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT)
        results.append({'variant':variant,'ablation':ablation,'exit_code':result.returncode})
        print(json.dumps(results[-1]),flush=True)
        if result.returncode:sys.exit(result.returncode)


if __name__=='__main__':main()
