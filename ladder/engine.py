"""How a campaign is run and settled (docs/DISCUSSION.md, G6 and G9 to G16).

  * Rungs per segment (category, platform, tier, format) from that segment's past posts only:
    rung 1 is reached by QUALIFY_REACH of them, each next rung by STEP_CHANCE of those on the one
    below. A segment with no past posts is a cold start: no rungs until the 25% mark, then rungs
    built from the campaign's own posts, rebuilt at 50% and 75% (up or down), final at 75%.
  * Fair Reach at the 25/50/75% marks: per group (category, format), each post judged against the
    first rung for its age. If both the share of posts and the share of creators on track are clearly
    below QUALIFY_REACH, every rung of the group shrinks by the Nash factor sqrt(score 80% reach).
    Only down, never up.
  * Fraud: hold a post if its drop after the peak is extreme, or sharp *and* it is far above the
    creator's usual; a peak on the last day is judged on size alone. Held posts are reviewed within
    REVIEW_DAYS; proven fraud mints nothing, cleared posts count in full.
  * Price: every validated view is a coin in the price; creators are paid only for the coins at the
    rung each post reached; everything priced but not paid is refunded to the brand.
    pool = budget / coins; below the market reference the whole budget is split; above it the price
    is the Nash split sqrt(pool x reference) and the rest is refunded.
"""
import math

from .config import CHECKS, CONFIDENCE, QUALIFY_REACH, REVIEW_DAYS, RUNGS, STEP_CHANCE
from .store import drop_after_peak, quantile

LEVELS = [QUALIFY_REACH * STEP_CHANCE ** k for k in range(RUNGS)]


def round_sig(x, digits=2):
    if x <= 0:
        return 0
    return max(1, int(round(x, digits - 1 - int(math.floor(math.log10(x))))))


def rungs_from(values):
    """Rungs from a list of view counts: rung k is reached by LEVELS[k] of them. Strictly rising."""
    if not values:
        return None
    out = []
    for level in LEVELS:
        v = round_sig(quantile(values, 1 - level))
        if v and (not out or v > out[-1]):
            out.append(v)
    return out or None


def rung_coins(views, rungs):
    cleared = 0
    for r in rungs or ():
        if views >= r:
            cleared = r
    return cleared


def settle(budget, coins, reference):
    """One price per coin. Returns (price per view, regime)."""
    if coins <= 0:
        return 0.0, "empty"
    pool = budget / coins
    if reference is None:
        return pool, "no reference"
    if pool <= reference:
        return pool, "plenty"
    return math.sqrt(pool * reference), "thin"


def fraud_check(daily, usual, cut):
    """(held?, reason) from the post's daily views so far and the creator's usual (G6)."""
    if not cut or not daily:
        return False, None
    views = sum(daily)
    ratio = views / usual if usual else None
    drop = drop_after_peak(daily)
    if drop is None:   # peak on the last day seen: judged on size alone
        if ratio is not None and cut["usual_alone"] and ratio > cut["usual_alone"]:
            return True, {"signal": "size", "ratio": ratio}
        return False, None
    if drop < cut["drop_alone"]:
        return True, {"signal": "drop", "drop": drop, "ratio": ratio}
    if (drop < cut["drop_together"] and ratio is not None and cut["usual_together"]
            and ratio > cut["usual_together"]):
        return True, {"signal": "drop+size", "drop": drop, "ratio": ratio}
    return False, None


def binom_cdf(k, n, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def _views_to(post, t):
    """Views a post had gathered by campaign day t (days before t)."""
    return sum(post["daily"][:max(0, t - post["day"])])


def run(summary, budget, days, posts, categories, formats, with_timeline=False):
    """Run and settle one campaign.

    posts: dicts with post_id, creator_id, category, platform, tier, format, day (posting day from 0),
    daily (views per day until the campaign's last day), bought (hidden truth: bought views; used
    only as the review's outcome for held posts).
    """
    seg = lambda p: (p["category"], p["platform"], p["tier"], p["format"])
    group = lambda p: (p["category"], p["format"])
    segs = {seg(p) for p in posts}
    base = {s: rungs_from(summary.segment_views.get(s)) for s in segs}
    cold = {s for s in segs if base[s] is None}
    live_rungs = {}                     # cold segments: rungs built from this campaign's own posts
    factor = {group(p): 1.0 for p in posts}
    cut = summary.cutoffs()
    usual = {p["creator_id"]: summary.usual(p["creator_id"]) for p in posts}
    alpha = (1 - CONFIDENCE) / len(CHECKS)
    events, factor_at, rungs_at = [], [], []

    check_days = sorted({min(days - 1, max(1, round(days * q))) for q in CHECKS}) if days > 1 else []
    for t in check_days:
        for g in sorted(set(factor)):
            live = [p for p in posts if group(p) == g and p["day"] < t
                    and not fraud_check(p["daily"][:t - p["day"]], usual[p["creator_id"]], cut)[0]]
            for s in sorted({seg(p) for p in live} & cold):
                built = rungs_from([_views_to(p, t) for p in live if seg(p) == s])
                if built and built != live_rungs.get(s):
                    events.append({"day": t, "kind": "cold_start", "segment": list(s), "rungs": built,
                                   "previous": live_rungs.get(s)})
                    live_rungs[s] = built
            scores, best = [], {}
            for p in live:
                if seg(p) in cold:
                    continue
                thr = summary.age_threshold(seg(p), t - p["day"] - 1)
                if not thr:
                    continue
                score = _views_to(p, t) / (thr * factor[g])
                scores.append(score)
                best[p["creator_id"]] = max(best.get(p["creator_id"], 0), score)
            if not scores:
                continue
            n, k = len(scores), sum(1 for x in scores if x >= 1)
            nc, kc = len(best), sum(1 for x in best.values() if x >= 1)
            if binom_cdf(k, n, QUALIFY_REACH) < alpha and binom_cdf(kc, nc, QUALIFY_REACH) < alpha:
                # The live rung: the score QUALIFY_REACH of posts reach, among posts with any views
                # (posts with none yet cannot say where a reachable rung sits).
                f = quantile([x for x in scores if x > 0], 1 - QUALIFY_REACH)
                if f and f < 1:
                    factor[g] *= math.sqrt(f)
                    events.append({"day": t, "kind": "fair_reach", "group": list(g), "on_track_posts": k / n,
                                   "on_track_creators": kc / nc, "shortfall": f, "factor": factor[g]})
        factor_at.append((t, dict(factor)))
        rungs_at.append((t, dict(live_rungs)))

    def rungs_for(s, g, fac=None, live=None):
        if s in cold:
            return (live if live is not None else live_rungs).get(s)
        f = factor[g] if fac is None else fac[g]
        return [round_sig(r * f) for r in base[s]]

    # Cold segments nobody posted in before the last check: rungs from their final views.
    for s in cold - set(live_rungs):
        built = rungs_from([sum(p["daily"]) for p in posts if seg(p) == s])
        if built:
            live_rungs[s] = built
            events.append({"day": days, "kind": "cold_start", "segment": list(s), "rungs": built, "previous": None})

    reference, ref_basis = summary.reference(categories, formats)
    detail, fraud_ids, held_any = [], set(), False
    for p in posts:
        held, reason = fraud_check(p["daily"], usual[p["creator_id"]], cut)
        fraud = held and p["bought"] > 0
        held_any = held_any or held
        if fraud:
            fraud_ids.add(p["post_id"])
        views = sum(p["daily"])
        rungs = rungs_for(seg(p), group(p))
        detail.append({"post_id": p["post_id"], "creator_id": p["creator_id"], "tier": p["tier"],
                       "category": p["category"], "platform": p["platform"], "format": p["format"],
                       "day": p["day"], "views": views, "bought": p["bought"], "held": held,
                       "reason": reason, "fraud": fraud, "rungs": rungs,
                       "rung_coins": 0 if fraud else rung_coins(views, rungs),
                       "rung_index": sum(1 for r in rungs or () if views >= r)})
    coins = sum(d["views"] for d in detail if not d["fraud"])
    price, regime = settle(budget, coins, reference)
    for d in detail:
        d["paid"] = price * d["rung_coins"]
        d["base_rung_coins"] = 0 if d["fraud"] else rung_coins(
            d["views"], base.get((d["category"], d["platform"], d["tier"], d["format"])))
    paid = sum(d["paid"] for d in detail)
    fraud_value = price * sum(rung_coins(d["views"], d["rungs"]) for d in detail if d["fraud"])
    result = {
        "budget": budget, "days": days, "coins": coins, "price": price, "regime": regime,
        "pool": budget / coins if coins else None, "reference": reference, "reference_basis": ref_basis,
        "paid": paid, "refund": budget - paid, "refund_thin": budget - price * coins if coins else budget,
        "refund_between_rungs": price * coins - paid if coins else 0.0,
        "posts": detail, "events": events, "fraud_value_blocked": fraud_value,
        "review_days": REVIEW_DAYS if held_any else 0,
        "rungs": {"|".join(s): rungs_for(s, (s[0], s[3])) for s in segs},
        "base_rungs": {"|".join(s): base[s] for s in segs},
        "cold_segments": ["|".join(s) for s in cold],
        "genuine_views": sum(d["views"] - d["bought"] for d in detail),
    }
    if with_timeline:
        result["timeline"] = _timeline(posts, days, budget, reference, rungs_for, factor_at, rungs_at,
                                       seg, group, usual, cut)
    return result


def _timeline(posts, days, budget, reference, rungs_for, factor_at, rungs_at, seg, group, usual, cut):
    """Day by day: views, coins, coin price, spend so far if it ended that day, creators, posts."""
    out = []
    for d in range(days):
        t = d + 1
        fac = next((f for day, f in reversed(factor_at) if day <= t), None)
        live = next((r for day, r in reversed(rungs_at) if day <= t), {})
        coins = views = spend_coins = 0
        creators, n = set(), 0
        for p in posts:
            if p["day"] > d:
                continue
            n += 1
            creators.add(p["creator_id"])
            v = _views_to(p, t)
            if fraud_check(p["daily"][:t - p["day"]], usual[p["creator_id"]], cut)[0]:
                continue
            views += v
            coins += v
            f0 = fac if fac is not None else {group(q): 1.0 for q in posts}
            spend_coins += rung_coins(v, rungs_for(seg(p), group(p), f0, live))
        price, regime = settle(budget, coins, reference)
        out.append({"day": d, "views": views, "coins": coins, "price": price, "regime": regime,
                    "spend": price * spend_coins, "creators": len(creators), "posts": n})
    return out


def ladder_pay(ladder, views):
    paid = 0
    for v, p in ladder:
        if views >= v:
            paid = p
    return paid


def old_way(ladder, budget, posts):
    """The status quo: a fixed rupee ladder, the same for everyone, paid on final views, no fraud
    check and no budget stop."""
    detail = []
    for p in posts:
        views = sum(p["daily"])
        pay = ladder_pay(ladder, views)
        detail.append({"post_id": p["post_id"], "creator_id": p["creator_id"], "tier": p["tier"],
                       "views": views, "bought": p["bought"], "paid": pay,
                       "paid_for_bought": pay - ladder_pay(ladder, views - p["bought"])})
    spend = sum(d["paid"] for d in detail)
    return {"budget": budget, "paid": spend, "posts": detail, "over_budget": max(0, spend - budget),
            "unspent": max(0, budget - spend), "paid_for_bought": sum(d["paid_for_bought"] for d in detail),
            "genuine_views": sum(d["views"] - d["bought"] for d in detail)}


def ours_paid_for_bought(result):
    """What Creator Pool paid for bought views that slipped past the check (fraud posts pay nothing)."""
    total = 0.0
    for d in result["posts"]:
        if d["bought"] and not d["fraud"]:
            total += d["paid"] - result["price"] * rung_coins(d["views"] - d["bought"], d["rungs"])
    return total
