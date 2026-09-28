"""Replay a campaign's real posts and settle it.

Our rules, in either of two payout modes:
  * no rungs ("linear"): a post at or above its minimum threshold mints one coin per view.
  * coin rungs ("rungs"): a post mints the coins of the highest rung it reached.
  * Below the threshold a post mints nothing.
  * A post ops flagged, or our detector finds suspicious, mints nothing until it is validated.
    Settlement waits up to REVIEW_DAYS for that review; a post not cleared by then is not paid. The
    replay has no reviewer, so every held post counts as not cleared: this is the strict reading, and
    the 18 clean posts it withholds are the cost of that strictness.
  * Nothing is paid until the campaign ends. Then one price for every coin (rules.settle), and
    whatever is not paid out is refunded. No cap, no floor, no early close.

Status quo rules (fixed ladder): pay the ladder's fixed amount on final views, withhold ops-flagged
posts, no budget stop.
"""
from .rules import fixed_cleared, fixed_payout


def _outcome(dataset, campaign, posts, paid, counted, extra):
    budget = campaign["total_budget"]
    spend = sum(paid.values())
    creators = {p["creator_id"] for p in posts}
    earning = {p["creator_id"] for p in posts if paid[p["post_id"]] > 0}
    by_tier = {}
    for cid in creators:
        tier = dataset.creator_by_id[cid]["tier"]
        seen, hit = by_tier.get(tier, (0, 0))
        by_tier[tier] = (seen + 1, hit + (cid in earning))
    real_views = sum(p["views_final"] for p in posts if not dataset.truth.get(p["post_id"]))
    paid_posts = [p for p in posts if paid[p["post_id"]] > 0]
    paid_views = sum(p["views_final"] for p in paid_posts)
    return {
        "budget": budget,
        "spend": round(spend),
        "budget_used": spend / budget,
        "within_budget": spend <= budget + 0.5,
        "refund": round(budget - spend),
        "posts": len(posts),
        "creators": len(creators),
        "creators_paid": len(earning),
        "completion": len(earning) / len(creators) if creators else 0.0,
        "completion_by_tier": {t: {"creators": s, "hit": h, "rate": h / s} for t, (s, h) in sorted(by_tier.items())},
        "effective_cpm": 1000 * spend / real_views if real_views else 0.0,
        # Of the views on posts that were paid something, the share that earned nothing.
        "views_unpaid_on_paid_posts": 1 - sum(counted[p["post_id"]] for p in paid_posts) / paid_views if paid_views else 0.0,
        "paid_to_bought_views": round(sum(paid[p["post_id"]] for p in posts if dataset.truth.get(p["post_id"]))),
        "clean_posts_withheld": sum(1 for p in posts if extra["held"](p) and not dataset.truth.get(p["post_id"])),
        **{k: v for k, v in extra.items() if k != "held"},
    }


def replay_proposal(dataset, campaign, proposal, detector, mode="linear"):
    posts = dataset.posts_by_campaign.get(campaign["campaign_id"], [])
    held = lambda p: p["flagged_suspicious"] or detector.suspicious(p, dataset.creator_by_id[p["creator_id"]])
    minted = {p["post_id"]: 0 if held(p) else proposal.ladder_for(dataset.tier_of(p), p["format"], category=campaign["category"]).coins(p["views_final"], mode)
              for p in posts}
    total = sum(minted.values())
    rate, regime = proposal.settle(total, mode)
    paid = {pid: rate * c for pid, c in minted.items()}
    ref = proposal.references[mode].rate
    return _outcome(dataset, campaign, posts, paid, minted, {
        "held": held, "posts_held": sum(1 for p in posts if held(p)), "coins": total, "regime": regime,
        "coin_cpm": rate * 1000, "pool_cpm": 1000 * campaign["total_budget"] / total if total else None,
        "reference_cpm": ref * 1000 if ref else None,
        "posts_qualified": sum(1 for c in minted.values() if c)})


def replay_fixed(dataset, campaign, ladder):
    """Status quo: a fixed ladder, paid on final views, ops-flagged posts withheld, no budget stop."""
    posts = dataset.posts_by_campaign.get(campaign["campaign_id"], [])
    held = lambda p: p["flagged_suspicious"]
    paid = {p["post_id"]: 0 if held(p) else fixed_payout(ladder, p["views_final"]) for p in posts}
    cleared = {p["post_id"]: 0 if held(p) else fixed_cleared(ladder, p["views_final"]) for p in posts}
    return _outcome(dataset, campaign, posts, paid, cleared, {"held": held, "posts_held": sum(1 for p in posts if held(p))})
