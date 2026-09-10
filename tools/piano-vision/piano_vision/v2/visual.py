"""ConvNeXt-style multiscale features and view-aware region sampling."""
import torch
import torch.nn.functional as F
from torch import nn


class ChannelNorm(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.norm = nn.LayerNorm(channels)

    def forward(self, x):
        return self.norm(x.permute(0, 2, 3, 1)).permute(0, 3, 1, 2)


class ModernConvBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.depthwise = nn.Conv2d(channels, channels, 7, padding=3, groups=channels)
        self.norm = ChannelNorm(channels)
        self.mlp = nn.Sequential(nn.Conv2d(channels, 4 * channels, 1), nn.GELU(),
                                 nn.Conv2d(4 * channels, channels, 1))
        self.scale = nn.Parameter(torch.full((1, channels, 1, 1), 1e-3))

    def forward(self, x):
        return x + self.scale * self.mlp(self.norm(self.depthwise(x)))


class DetailBackbone(nn.Module):
    """Stride 1 detail branch plus strides 2, 4, 8, 16. Shared across views."""
    version = "detail-conv/2"

    def __init__(self, config):
        super().__init__()
        detail = 12
        self.detail = nn.Sequential(nn.Conv2d(1, detail, 3, padding=1), nn.GELU(),
                                    nn.Conv2d(detail, detail, 3, padding=1, groups=detail), nn.GELU())
        self.stages = nn.ModuleList()
        source = detail
        for channels, depth in zip(config.channels, config.depths):
            self.stages.append(nn.Sequential(nn.Conv2d(source, channels, 3, stride=2, padding=1),
                                             ChannelNorm(channels),
                                             *[ModernConvBlock(channels) for _ in range(depth)]))
            source = channels
        self.output_channels = (detail,) + config.channels

    def forward(self, images):
        value = self.detail(images)
        result = [value]
        for stage in self.stages:
            value = stage(value)
            result.append(value)
        return result


class RegionSampler(nn.Module):
    """Coordinates refer to pixel edges: x_norm=(x+0.5)/W at a pixel center.

    Index each object's own view. No clipping of missing/out-of-view evidence.
    Keeping the grid samples separate preserves the position of accidentals/dots.
    """
    def __init__(self, grid_size=3):
        super().__init__()
        ys, xs = torch.meshgrid((torch.arange(grid_size) + .5) / grid_size,
                               (torch.arange(grid_size) + .5) / grid_size, indexing="ij")
        self.register_buffer("grid", torch.stack((xs, ys), -1).reshape(-1, 2))

    def forward(self, features, boxes, view_index, mask, views_per_batch):
        b, n, _ = boxes.shape
        positions = boxes[..., :2].unsqueeze(2) + self.grid * (
            boxes[..., 2:] - boxes[..., :2]).unsqueeze(2)
        # Grouped sampling avoids copying a full feature map once per object.
        output = []
        for feature in features:
            _, channels, h, w = feature.shape
            maps = feature.reshape(b, views_per_batch, channels, h, w)
            accumulated = feature.new_zeros(b, n, channels * len(self.grid))
            for view in range(views_per_batch):
                values = F.grid_sample(maps[:, view], positions * 2 - 1,
                                       mode="bilinear", align_corners=False, padding_mode="zeros")
                values = values.permute(0, 2, 1, 3).flatten(2)
                selected = ((view_index == view) & mask).unsqueeze(-1)
                accumulated = accumulated + values * selected
            output.append(accumulated)
        return torch.cat(output, -1)
