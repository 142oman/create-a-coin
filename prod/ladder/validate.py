"""Checks on the generated world and on the method, all computed, none asserted.

  1. Heavy tails: do a few posts carry most of the views? (the six momentum states should produce it)
  2. Growth shapes: when do posts peak, and how many have stopped by the campaign's end?
  3. Built-in relation 1: do bigger accounts get more views?
  4. Fraud: how many posts with bought views does the check hold, and how many genuine posts?
  5. Rung calibration: on campaigns the rungs were not built from, what share of posts reach each rung?
     By design: 80%, 40%, 20%, 10%, 5%.
"""
import math
import statistics

from .config import QUALIFY_REACH, RUNGS, STEP_CHANCE
from .history import replay


def _corr(xs, ys):
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy) if sx and sy else 0.0


def run(world):
    views = sorted((p["views_final"] for p in world.posts), reverse=True)
    top = views[:max(1, len(views) // 10)]
    peaks, stopped = [], 0
    for p in world.posts:
        d = p["daily_views"]
        if d:
            peaks.append(max(range(len(d)), key=lambda i: d[i]))
            stopped += len(d) > 1 and d[-1] == 0
    followers = {c["creator_id"]: c["follower_count"] for c in world.creators}
    pairs = [(math.log(followers[p["creator_id"]]), math.log(1 + p["views_final"])) for p in world.posts]

    results, _, _ = replay(world)
    bought = clean = caught = false_alarm = 0
    reached, counted = [0] * RUNGS, 0
    for r in results.values():
        if not r:
            continue
        cold = set(r["cold_segments"])
        for d in r["posts"]:
            if d["bought"]:
                bought += 1
                caught += d["held"]
            else:
                clean += 1
                false_alarm += d["held"]
                key = "|".join((d["category"], d["platform"], d["tier"], d["format"]))
                base = r["base_rungs"].get(key)
                if key not in cold and base and len(base) == RUNGS:
                    counted += 1
                    for k, rung in enumerate(base):
                        reached[k] += d["views"] >= rung
    design = [QUALIFY_REACH * STEP_CHANCE ** k for k in range(RUNGS)]
    return {
        "posts": len(world.posts),
        "heavy_tail": {"top_10pct_share": sum(top) / sum(views) if views else 0,
                       "p99_over_median": views[len(views) // 100] / max(1, views[len(views) // 2]) if views else 0},
        "growth": {"peak_on_first_day": sum(1 for x in peaks if x == 0) / len(peaks) if peaks else 0,
                   "peak_after_day_3": sum(1 for x in peaks if x > 3) / len(peaks) if peaks else 0,
                   "stopped_by_end": stopped / len(peaks) if peaks else 0},
        "followers_vs_views_correlation": _corr(*zip(*pairs)) if len(pairs) > 2 else 0,
        "fraud": {"bought_posts": bought, "caught": caught, "genuine_posts": clean, "genuine_held": false_alarm,
                  "catch_rate": caught / bought if bought else None, "false_alarm_rate": false_alarm / clean if clean else None},
        "rungs": {"posts": counted, "design": design,
                  "actual": [x / counted for x in reached] if counted else None},
    }
