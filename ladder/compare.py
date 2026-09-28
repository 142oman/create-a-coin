"""Compare: the user's campaign paid the old way (their budget, rate and hand-built rungs) and by
Creator Coin, across real past campaigns used as "worlds" (G26).

Each matching past campaign's creators and posts meet the user's settings, paid both ways; Creator
Coin runs with only what was known when that campaign started. Which campaigns (same order as the
market reference, G16): same category and format; if none, the same format in any category; if the
format has never run, there is nothing honest to compare against.

Worst world for the old way = most money wasted: overspend above budget + money paid for bought views
+ overpayment against Creator Coin's price for the same genuine views.
"""
import statistics

from . import engine
from .config import ALL_FORMATS, CATEGORIES
from .history import replay


def worlds_for(world, categories, formats):
    has_format = lambda c: any(p["format"] in formats for p in world.posts_by_campaign.get(c["campaign_id"], []))
    same = [c for c in world.campaigns if c["category"] in categories and has_format(c)]
    if same:
        return same, "same category and format"
    anywhere = [c for c in world.campaigns if has_format(c)]
    if anywhere:
        return anywhere, "same format, any category"
    return [], "this format has never run"


def compare(world, categories, formats, budget, old):
    """old: {"budget": ₹, "rungs": [[views, payout], ...]}"""
    cats = [c for c in (categories or []) if c in CATEGORIES] or list(CATEGORIES)
    fmts = [f for f in (formats or []) if f in ALL_FORMATS] or list(ALL_FORMATS)
    budget = float(budget)
    ladder = sorted((int(v), float(p)) for v, p in old["rungs"] if int(v) > 0)
    old_budget = float(old.get("budget") or budget)
    if budget <= 0 or not ladder:
        raise ValueError("Need a budget and at least one rung for the old way")
    chosen, basis = worlds_for(world, cats, fmts)
    ids = {c["campaign_id"] for c in chosen}
    rows = []

    def visit(c, posts, summary):
        if c["campaign_id"] not in ids:
            return
        mine = [p for p in posts if p["format"] in fmts]
        if not mine:
            return
        days = len(max((p["daily"] for p in mine), key=len)) + max(p["day"] for p in mine)
        ours = engine.run(summary, budget, days, mine, [c["category"]], fmts)
        them = engine.old_way(ladder, old_budget, mine)
        ours_bought = engine.ours_paid_for_bought(ours)
        overpay = max(0.0, (them["paid"] - them["paid_for_bought"]) - (ours["paid"] - ours_bought))
        rows.append({
            "campaign_id": c["campaign_id"], "category": c["category"], "posts": len(mine),
            "creators": len({p["creator_id"] for p in mine}), "genuine_views": ours["genuine_views"],
            "old": {"paid": them["paid"], "budget": old_budget, "over": them["over_budget"],
                    "bought": them["paid_for_bought"], "overpay": overpay,
                    "waste": them["over_budget"] + them["paid_for_bought"] + overpay},
            "ours": {"paid": ours["paid"], "budget": budget, "refund": ours["refund"], "bought": ours_bought,
                     "blocked": ours["fraud_value_blocked"], "regime": ours["regime"], "waste": ours_bought,
                     "price": ours["price"]},
        })

    replay(world, visit)
    if not rows:
        return {"worlds": [], "basis": basis, "count": 0}
    worst = max(range(len(rows)), key=lambda i: rows[i]["old"]["waste"])
    mean = lambda f: statistics.fmean(f(r) for r in rows)
    return {
        "basis": basis, "count": len(rows), "worlds": rows, "worst": worst,
        "summary": {
            "old_over_count": sum(1 for r in rows if r["old"]["over"] > 0),
            "ours_over_count": sum(1 for r in rows if r["ours"]["paid"] > budget + 1e-6),
            "old_waste": mean(lambda r: r["old"]["waste"]), "ours_waste": mean(lambda r: r["ours"]["waste"]),
            "saved": mean(lambda r: r["old"]["waste"] - r["ours"]["waste"]),
            "old_paid": mean(lambda r: r["old"]["paid"]), "ours_paid": mean(lambda r: r["ours"]["paid"]),
            "ours_refund": mean(lambda r: r["ours"]["refund"]),
        },
    }
