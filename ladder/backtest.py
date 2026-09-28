"""Backtest: every generated past campaign, paid the old way (its own gut-feel ladder) and by Creator
Coin (run with only what was known at its start), on the same posts. Eight measures (G20).

The posts are the same under both, so creator behaviour is held fixed: a replay shows money and
reach, not how creators would have reacted.
"""
import math
import statistics

from . import engine
from .config import TIERS
from .history import replay


def _median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def _top_share(pays, share=0.1):
    """Share of the money that went to the top 10% of creators."""
    pays = sorted((p for p in pays if p > 0), reverse=True)
    if not pays:
        return None
    k = max(1, math.ceil(share * len(pays)))
    return sum(pays[:k]) / sum(pays)


def _by_creator(detail):
    out = {}
    for d in detail:
        out[d["creator_id"]] = out.get(d["creator_id"], 0) + d["paid"]
    return out


def _cv(xs):
    xs = [x for x in xs if x]
    if len(xs) < 2:
        return None
    return statistics.pstdev(xs) / statistics.fmean(xs)


def run(world):
    return summarise(rows(world))


def rows(world):
    """(campaign, old way result, Creator Coin result) for every past campaign with posts."""
    results, _, _ = replay(world)
    rows = []
    for c in sorted(world.campaigns, key=lambda c: c["start_date"]):
        ours = results[c["campaign_id"]]
        if not ours:
            continue
        posts = [{"post_id": d["post_id"], "creator_id": d["creator_id"], "tier": d["tier"],
                  "daily": [d["views"]], "bought": d["bought"]} for d in ours["posts"]]
        old = engine.old_way(world.ladder_by_campaign[c["campaign_id"]], c["total_budget"], posts)
        rows.append((c, old, ours))
    return rows


def summarise(rows):
    n = len(rows)
    budget_old = [o["paid"] / c["total_budget"] for c, o, _ in rows]
    budget_new = [w["paid"] / c["total_budget"] for c, _, w in rows]
    cpm_old = [1000 * o["paid"] / o["genuine_views"] for _, o, _ in rows if o["genuine_views"]]
    cpm_new = [1000 * w["paid"] / w["genuine_views"] for _, _, w in rows if w["genuine_views"]]

    tiers = {name: {t: [0, 0] for t in TIERS} for name in ("old", "new")}
    for _, o, w in rows:
        for name, res in (("old", o), ("new", w)):
            paid = _by_creator(res["posts"])
            tier = {d["creator_id"]: d["tier"] for d in res["posts"]}
            for cid, amount in paid.items():
                tiers[name][tier[cid]][0] += 1
                tiers[name][tier[cid]][1] += amount > 0

    rescued_campaigns = sum(1 for _, _, w in rows if any(e["kind"] == "fair_reach" for e in w["events"]))
    rescued_creators = 0
    for _, _, w in rows:
        cold = set(w["cold_segments"])
        mine = {}
        for d in w["posts"]:
            if "|".join((d["category"], d["platform"], d["tier"], d["format"])) in cold:
                continue
            got, base = mine.get(d["creator_id"], (0, 0))
            mine[d["creator_id"]] = (got + d["rung_coins"], base + d["base_rung_coins"])
        rescued_creators += sum(1 for got, base in mine.values() if got > 0 and base == 0)

    groups = {}
    for c, o, w in rows:
        g = groups.setdefault((c["category"], c["platform"]), {"old": [], "new": []})
        if o["genuine_views"]:
            g["old"].append(1000 * o["paid"] / o["genuine_views"])
        if w["coins"]:
            g["new"].append(1000 * w["price"])

    return {
        "campaigns": n,
        "budget": {
            "old_over": sum(1 for x in budget_old if x > 1 + 1e-9), "new_over": sum(1 for x in budget_new if x > 1 + 1e-9),
            "old_worst": max(budget_old, default=0), "new_worst": max(budget_new, default=0),
            "old_ratios": budget_old, "new_ratios": budget_new,
        },
        "cost_per_1k": {"old": _median(cpm_old), "new": _median(cpm_new),
                        "old_all": cpm_old, "new_all": cpm_new},
        "returned": {
            "new_thin": sum(w["refund_thin"] for _, _, w in rows),
            "new_between_rungs": sum(w["refund_between_rungs"] for _, _, w in rows),
            "old_unspent": sum(o["unspent"] for _, o, _ in rows),
            "budget": sum(c["total_budget"] for c, _, _ in rows),
        },
        "bought": {"old": sum(o["paid_for_bought"] for _, o, _ in rows),
                   "new": sum(engine.ours_paid_for_bought(w) for _, _, w in rows),
                   "blocked": sum(w["fraud_value_blocked"] for _, _, w in rows)},
        "creators_paid_by_tier": {name: {t: {"creators": v[0], "paid": v[1], "rate": v[1] / v[0] if v[0] else None}
                                         for t, v in d.items()} for name, d in tiers.items()},
        "fair_reach": {"campaigns": rescued_campaigns, "creators": rescued_creators},
        "price_stability": {"old": _median(_cv(g["old"]) for g in groups.values()),
                            "new": _median(_cv(g["new"]) for g in groups.values())},
        "concentration": {"old": _median(_top_share(_by_creator(o["posts"]).values()) for _, o, _ in rows),
                          "new": _median(_top_share(_by_creator(w["posts"]).values()) for _, _, w in rows)},
    }
