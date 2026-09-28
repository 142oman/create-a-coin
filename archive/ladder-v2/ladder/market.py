"""The market reference: what a view has fetched on this platform, read from settled campaigns.

For every campaign that had already ended, take its pool split: budget / coins its validated posts
would mint under today's rules (priced separately for every-view coins and for coin rungs, since
rungs mint fewer coins for the same views). That is the price at which the brand's money met
the supply that turned up, with no cap, floor or declared price involved. The reference for a new
campaign is the median pool split of past campaigns like it (same categories and platforms), widened
when there are fewer than MIN_REFERENCE_CAMPAIGNS of them.

It depends on views per rupee only, so a Rs 1,000 campaign and a Rs 3 crore campaign are compared on
the same footing. It is read from real settlements, never simulated, and moves as each campaign
settles.
"""
import statistics
from dataclasses import dataclass, field

from .config import MIN_REFERENCE_CAMPAIGNS
from .fraud import Detector


@dataclass
class Reference:
    rate: float | None            # Rs per view; None = no history yet (cold start)
    basis: str
    campaigns: list = field(default_factory=list)   # [(campaign_id, pool split Rs/view)]

    def to_dict(self):
        return {"cpm": round(self.rate * 1000, 2) if self.rate else None, "basis": self.basis,
                "campaigns": [{"campaign_id": c, "pool_cpm": round(r * 1000, 2)} for c, r in self.campaigns]}


def pool_splits(history, coins_of):
    """campaign_id -> (campaign, budget / validated coins) for every past campaign that minted any.
    `coins_of(campaign, post)` is the payout rule being priced (every view, or coin rungs)."""
    detector = Detector.fit(history) if history.posts else None
    out = {}
    for c in history.campaigns:
        minted = 0
        for p in history.posts_by_campaign.get(c["campaign_id"], []):
            if p["flagged_suspicious"] or (detector and detector.suspicious(p, history.creator_by_id[p["creator_id"]])):
                continue
            minted += coins_of(c, p)
        if minted:
            out[c["campaign_id"]] = (c, c["total_budget"] / minted)
    return out


def reference(history, categories, platforms, coins_of):
    """`categories` / `platforms`: what the campaign is open to."""
    splits = pool_splits(history, coins_of)
    steps = (("same category and platform", lambda c: c["category"] in categories and c["platform"] in platforms),
             ("same category", lambda c: c["category"] in categories),
             ("same platform", lambda c: c["platform"] in platforms),
             ("all settled campaigns", lambda c: True))
    for basis, keep in steps:
        chosen = [(cid, split) for cid, (c, split) in splits.items() if keep(c)]
        if len(chosen) >= MIN_REFERENCE_CAMPAIGNS:
            return Reference(statistics.median(s for _, s in chosen), basis, sorted(chosen))
    if splits:
        chosen = [(cid, split) for cid, (_, split) in splits.items()]
        return Reference(statistics.median(s for _, s in chosen), "all settled campaigns (few)", sorted(chosen))
    return Reference(None, "no settled campaigns yet: settles at the pure pool split")
