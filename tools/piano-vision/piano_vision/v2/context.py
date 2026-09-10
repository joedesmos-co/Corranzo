"""Attention with explicit musical hierarchy and geometric pair evidence."""
import torch
import torch.nn.functional as F
from torch import nn


class MusicalAttention(nn.Module):
    def __init__(self, config):
        super().__init__()
        d = config.hidden
        self.heads = config.heads
        self.norm = nn.LayerNorm(d)
        self.qkv = nn.Linear(d, d * 3)
        self.bias = nn.Sequential(nn.Linear(8, 32), nn.GELU(), nn.Linear(32, self.heads))
        self.out = nn.Linear(d, d)
        self.ffn = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, d * config.expansion),
                                 nn.GELU(), nn.Dropout(config.dropout),
                                 nn.Linear(d * config.expansion, d))
        self.dropout = config.dropout

    def forward(self, tokens, mask, pair_features):
        b, n, d = tokens.shape
        q, k, v = self.qkv(self.norm(tokens)).reshape(b, n, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        bias = self.bias(pair_features).permute(0, 3, 1, 2)
        bias = bias.masked_fill(~mask[:, None, None, :], -1e4)
        # Finite even for an all-padded sample; padded queries zeroed below.
        value = F.scaled_dot_product_attention(q, k, v, attn_mask=bias,
                                               dropout_p=self.dropout if self.training else 0)
        value = value.transpose(1, 2).reshape(b, n, d)
        tokens = tokens + self.out(value)
        tokens = tokens + self.ffn(tokens)
        return tokens * mask.unsqueeze(-1)


def musical_pairs(xy, identities, parent):
    """Identities are source page/system/staff/measure IDs, never target labels."""
    delta = xy[:, :, None] - xy[:, None, :]
    same = (identities[:, :, None] == identities[:, None, :]) & (identities[:, :, None] >= 0)
    n = xy.shape[1]
    index = torch.arange(n, device=xy.device)
    ancestors = (parent[:, :, None] == index[None, None, :]) | (parent[:, None, :] == index[None, :, None])
    return torch.cat((delta, same.to(xy.dtype), ancestors.unsqueeze(-1).to(xy.dtype),
                      (delta.square().sum(-1, keepdim=True)).sqrt()), -1)

