"""Suspicious-growth detector.

Bought views arrive in a burst and then stop, so a boosted post is unusually front-loaded (most of
its 7-day views already there at 24 hours) and unusually large for the account that posted it.
Both thresholds are learned from posts ops did not flag: a post is suspicious only when it is more
extreme than FRAUD_QUANTILE of clean posts, so the false-alarm rate is set by construction rather
than by a hand-picked cutoff.

A held post's coins are not minted until it is validated. Payment waits for validation, nothing else.
"""
from dataclasses import dataclass

from .config import FRAUD_QUANTILE


def _quantile(values, q):
    values = sorted(values)
    if not values:
        return float("inf")
    return values[min(len(values) - 1, int(q * len(values)))]


def front_loading(post):
    return post["views_at_24h"] / max(1, post["views_at_7d"])


def spike(post, creator):
    return post["views_at_7d"] / max(1, creator["historical_avg_views_per_post"])


@dataclass(frozen=True)
class Detector:
    front_extreme: float   # this front-loaded alone is suspicious
    front_high: float      # front-loaded AND ...
    spike_high: float      # ... far above the account's usual reach

    @classmethod
    def fit(cls, dataset):
        clean = [p for p in dataset.posts if not p["flagged_suspicious"] and p["views_at_7d"] > 0]
        fronts = [front_loading(p) for p in clean]
        spikes = [spike(p, dataset.creator_by_id[p["creator_id"]]) for p in clean]
        # Two signals must both be unusual at the 95th percentile, or one at FRAUD_QUANTILE; each
        # route holds roughly 1% of clean posts, so the combined false-alarm rate stays near 2%.
        return cls(front_extreme=_quantile(fronts, FRAUD_QUANTILE),
                   front_high=_quantile(fronts, 0.95),
                   spike_high=_quantile(spikes, 0.95))

    def reasons(self, post, creator):
        front = front_loading(post)
        found = []
        if front > self.front_extreme:
            found.append(f"{front:.0%} of 7-day views arrived in the first 24h")
        elif front > self.front_high and spike(post, creator) > self.spike_high:
            found.append(f"front-loaded ({front:.0%} in 24h) and {spike(post, creator):.1f}x "
                         "the account's usual views")
        return found

    def suspicious(self, post, creator):
        return bool(self.reasons(post, creator))


def score(detector, dataset, posts):
    """Detector and ops label, each scored against the generator's hidden truth."""
    def rates(predicted):
        tp = sum(1 for p in posts if predicted(p) and dataset.truth.get(p["post_id"]))
        fp = sum(1 for p in posts if predicted(p) and not dataset.truth.get(p["post_id"]))
        fn = sum(1 for p in posts if not predicted(p) and dataset.truth.get(p["post_id"]))
        return {"caught": tp, "false_alarms": fp, "missed": fn,
                "precision": tp / (tp + fp) if tp + fp else 0.0,
                "recall": tp / (tp + fn) if tp + fn else 0.0}

    def ours(p):
        return detector.suspicious(p, dataset.creator_by_id[p["creator_id"]])

    return {
        "label_only": rates(lambda p: p["flagged_suspicious"]),
        "detector_only": rates(ours),
        "label_or_detector": rates(lambda p: p["flagged_suspicious"] or ours(p)),
    }
