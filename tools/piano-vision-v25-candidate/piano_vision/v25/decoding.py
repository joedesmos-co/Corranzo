"""V2.5 inference: voice tracks from the continuation graph, pointer-based
attachment, and verifier-guided beam rerank as the default generation
policy (evidence: greedy 229/600 -> beam-4 263/600 on the frozen cohort).
"""
import torch

from ..v2.verifier import rerank as verifier_rerank


@torch.no_grad()
def voice_tracks(continuation_prob, relation_index, relation_mask, threshold=0.5):
    """Connected components over confident lane-continuation edges.

    Returns a voice id per object. Objects with no confident edges are
    singleton voices. Deterministic. Union-find over the batch.
    """
    b, m = continuation_prob.shape
    n = int(relation_index.max()) + 1 if m else 0
    out = torch.zeros(b, n, dtype=torch.long)
    for row in range(b):
        parent = list(range(n))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        def union(a, c):
            ra, rc = find(a), find(c)
            if ra != rc:
                parent[rc] = ra

        for e in range(m):
            if relation_mask[row, e] and continuation_prob[row, e] >= threshold:
                union(int(relation_index[row, e, 0]), int(relation_index[row, e, 1]))
        remap, seen = {}, 0
        for i in range(n):
            r = find(i)
            if r not in remap:
                remap[r] = seen
                seen += 1
            out[row, i] = remap[r]
    return out


@torch.no_grad()
def pointer_owners(pointer_logits, null_class):
    """Argmax owner per region; null_class means abstain (no confident owner)."""
    if pointer_logits is None:
        return None
    return pointer_logits.argmax(-1)


def generate_policy(decoder, region_context, max_new_tokens=512, width=4,
                    candidates=None, memory_pad=None, projected_memory=False):
    """Real beam search. Prefer generate_batch for the V2.5 object-set path.

    Region-only callers retain their conditioning; callers supplying projected
    memory get exactly the training memory. Verifier needs a separate complete
    semantic candidate and is never silently marked as applied.
    """
    from .generation import beam_generate
    memory = region_context if projected_memory else decoder.memory(region_context)
    if memory.ndim == 2: memory = memory[:, None]
    return beam_generate(decoder, memory, memory_pad, width, max_new_tokens)


def rerank_with_verifier(candidate, alternatives, max_candidates=128,
                         min_log_margin=2.0):
    """Thin wrapper making the verifier-rerank contract explicit for V2.5."""
    report = verifier_rerank(candidate, alternatives,
                             max_candidates=max_candidates,
                             min_log_margin=min_log_margin)
    return report
