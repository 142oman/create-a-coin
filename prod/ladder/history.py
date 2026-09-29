"""Replays the generated history in date order, so every campaign is run with only what was known
when it started, and settled campaigns feed the summary for the ones after."""
from datetime import date

from . import engine
from .store import Summary


def days_of(c):
    return (date.fromisoformat(c["end_date"]) - date.fromisoformat(c["start_date"])).days + 1


def campaign_posts(world, c):
    """A past campaign's posts in the engine's shape."""
    start = date.fromisoformat(c["start_date"])
    return [{"post_id": p["post_id"], "creator_id": p["creator_id"], "category": c["category"],
             "platform": p["platform"], "tier": p["tier_at_post"], "format": p["format"],
             "day": (date.fromisoformat(p["post_date"]) - start).days, "daily": p["daily_views"],
             "bought": world.truth[p["post_id"]]}
            for p in world.posts_by_campaign.get(c["campaign_id"], [])]


def replay(world, visit=None):
    """-> (results by campaign_id, number of campaigns known at each start, final summary).

    Each campaign is run once, at its start, against the summary of campaigns that had ended by then;
    it is added to the summary on its end date. `visit(campaign, posts, summary)` is called at each
    start, before the campaign's own run, for callers that need the history as it was then."""
    summary = Summary()
    by_start = sorted(world.campaigns, key=lambda c: (c["start_date"], c["campaign_id"]))
    pending, results, known_at_start = [], {}, {}
    for c in by_start:
        pending.sort(key=lambda x: x[0]["end_date"])
        while pending and pending[0][0]["end_date"] < c["start_date"]:
            done, posts, res = pending.pop(0)
            _add(summary, world, done, posts, res)
        posts = campaign_posts(world, c)
        known_at_start[c["campaign_id"]] = summary.campaigns
        if visit:
            visit(c, posts, summary)
        res = engine.run(summary, c["total_budget"], days_of(c), posts, [c["category"]],
                         sorted({p["format"] for p in posts})) if posts else None
        results[c["campaign_id"]] = res
        pending.append((c, posts, res))
    for done, posts, res in sorted(pending, key=lambda x: x[0]["end_date"]):
        _add(summary, world, done, posts, res)
    return results, known_at_start, summary


def _add(summary, world, c, posts, res):
    """Settle a past campaign into the summary. Its price is what creators were actually paid per view
    (the history ran the old way): the creators' real outside option (G16, G28)."""
    fraud = {d["post_id"] for d in res["posts"] if d["fraud"]} if res else set()
    held = {d["post_id"] for d in res["posts"] if d["held"]} if res else set()
    views = sum(sum(p["daily"]) for p in posts)
    paid = sum(engine.ladder_pay(world.ladder_by_campaign[c["campaign_id"]], sum(p["daily"])) for p in posts)
    summary.add(c, posts, fraud, paid / views if views and paid else None, held)
