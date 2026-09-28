"""Replay a campaign's real posts under a ladder and settle it.

Our rules:
  * Every post is paid once, at settlement, on its final views, rounded down to its cleared rung.
  * While the campaign runs, a tally of promised minimums (min rate x projected cleared views) is kept.
    When the tally reaches the budget, the campaign stops accepting new posts.
  * Posts ops flagged, or that our detector finds suspicious on their full growth curve, are not paid.
  * Final rate = brand maximum while the budget covers it, the pool split below that, never under
    the guaranteed minimum. Whatever is left is refunded.

Status quo rules (fixed ladder): pay the ladder's fixed amount on final views, withhold ops-flagged
posts, no budget stop.
"""
import statistics
from datetime import timedelta

from .data import day
from .rules import fixed_cleared, fixed_payout, settled_rate


def growth_factors(history):
    """How much a clean post typically still grows after each checkpoint (median final / checkpoint)."""
    clean = [p for p in history.posts if not p["flagged_suspicious"] and p["views_at_24h"] > 0]
    ratio = lambda field: statistics.median(p["views_final"] / max(1, p[field]) for p in clean)
    return {"24h": ratio("views_at_24h"), "7d": ratio("views_at_7d"), "30d": ratio("views_at_30d")}


def _expected_cleared(ladder):
    """Expected cleared views of a post nobody has seen yet, straight from the rung reach chances."""
    rungs = ladder.rungs
    total = 0.0
    for i, (views, reach) in enumerate(rungs):
        next_reach = rungs[i + 1][1] if i + 1 < len(rungs) else 0.0
        total += views * (reach - next_reach)
    return total


def _projected_views(post, age, growth):
    if age < 1:
        return None
    if age < 7:
        return post["views_at_24h"] * growth["24h"]
    if age < 30:
        return post["views_at_7d"] * growth["7d"]
    return post["views_at_30d"] * growth["30d"]


def _outcome(dataset, campaign, accepted, rejected, paid, cleared, spend, closed_on, extra):
    budget = campaign["total_budget"]
    creators = {p["creator_id"] for p in accepted}
    hitting = {p["creator_id"] for p in accepted if paid[p["post_id"]] > 0}
    by_tier = {}
    for cid in creators:
        tier = dataset.creator_by_id[cid]["tier"]
        seen, hit = by_tier.get(tier, (0, 0))
        by_tier[tier] = (seen + 1, hit + (cid in hitting))
    real_views = sum(p["views_final"] for p in accepted if not dataset.truth.get(p["post_id"]))
    paid_posts = [p for p in accepted if paid[p["post_id"]] > 0]
    paid_views = sum(p["views_final"] for p in paid_posts)
    return {
        "budget": budget,
        "spend": round(spend),
        "budget_used": spend / budget,
        "within_budget": spend <= budget + 0.5,
        "refund": round(budget - spend),
        "posts_accepted": len(accepted),
        "posts_rejected": len(rejected),
        "closed_early_on": closed_on.isoformat() if closed_on else None,
        "creators": len(creators),
        "creators_hitting_milestone": len(hitting),
        "completion": len(hitting) / len(creators) if creators else 0.0,
        "completion_by_tier": {t: {"creators": s, "hit": h, "rate": h / s} for t, (s, h) in sorted(by_tier.items())},
        "effective_cpm": 1000 * spend / real_views if real_views else 0.0,
        "views_unpaid_by_rounding": 1 - sum(cleared[p["post_id"]] for p in paid_posts) / paid_views if paid_views else 0.0,
        "paid_to_bought_views": round(sum(paid[p["post_id"]] for p in accepted if dataset.truth.get(p["post_id"]))),
        "clean_posts_withheld": sum(1 for p in accepted if paid[p["post_id"]] == 0 and extra["held"](p)
                                    and not dataset.truth.get(p["post_id"])),
        **{k: v for k, v in extra.items() if k != "held"},
    }


def replay_proposal(dataset, campaign, proposal, detector, growth):
    budget = campaign["total_budget"]
    posts = sorted(dataset.posts_by_campaign.get(campaign["campaign_id"], []), key=lambda p: p["post_date"])
    ladder_of = lambda p: proposal.ladder_for(dataset.tier_of(p), p["format"])
    unseen = {id(g): _expected_cleared(g) for g in proposal.ladders}

    accepted, rejected, closed_on = [], [], None
    d, end = day(campaign["start_date"]), day(campaign["end_date"])
    i = 0
    while d <= end:
        while i < len(posts) and day(posts[i]["post_date"]) <= d:
            (rejected if closed_on else accepted).append(posts[i])
            i += 1
        if not closed_on:
            tally = 0.0
            for p in accepted:
                ladder = ladder_of(p)
                age = (d - day(p["post_date"])).days
                if p["flagged_suspicious"] and age >= 1 or detector.held_at(p, dataset.creator_by_id[p["creator_id"]], age):
                    continue  # held: promises nothing until its check clears
                views = _projected_views(p, age, growth)
                tally += proposal.min_rate * (unseen[id(ladder)] if views is None else ladder.cleared(views))
            if tally >= budget:
                closed_on = d  # posts from tomorrow on are turned away
        d += timedelta(days=1)
    rejected.extend(posts[i:])

    held = lambda p: p["flagged_suspicious"] or detector.suspicious(p, dataset.creator_by_id[p["creator_id"]])
    cleared = {p["post_id"]: 0 if held(p) else ladder_of(p).cleared(p["views_final"]) for p in accepted}
    rate = settled_rate(budget, sum(cleared.values()), proposal.min_rate, proposal.max_rate)
    paid = {pid: rate * v for pid, v in cleared.items()}
    return _outcome(dataset, campaign, accepted, rejected, paid, cleared, sum(paid.values()), closed_on,
                    {"held": held, "rate_cpm": rate * 1000, "posts_held": sum(1 for p in accepted if held(p))})


def replay_fixed(dataset, campaign, ladder):
    """Status quo: a fixed ladder, paid on final views, ops-flagged posts withheld, no budget stop."""
    posts = dataset.posts_by_campaign.get(campaign["campaign_id"], [])
    held = lambda p: p["flagged_suspicious"]
    paid = {p["post_id"]: 0 if held(p) else fixed_payout(ladder, p["views_final"]) for p in posts}
    cleared = {p["post_id"]: 0 if held(p) else fixed_cleared(ladder, p["views_final"]) for p in posts}
    return _outcome(dataset, campaign, posts, [], paid, cleared, sum(paid.values()), None,
                    {"held": held, "posts_held": sum(1 for p in posts if held(p))})
