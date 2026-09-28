"""Backtest: rebuild each historical campaign's ladder from what was known before it started, replay
its real posts under both ladders, and compare.

Assumption stated up front: the posts (who joined, what they posted, how many views) are the same
under both ladders. A different ladder would change who joins and how hard they try; we have no data
on that, so the replay measures money and reach, not behaviour.
"""
import json
import statistics
from pathlib import Path

from .builder import CampaignParams, build
from .config import STEP_CHANCE, TIERS
from .data import load
from .fraud import Detector, score
from .settle import growth_factors, replay_fixed, replay_proposal

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
MIN_HISTORY = 12   # campaigns settled before this one; fewer and nearly every group is a cold start
N_SHOWCASE = 5
STEPS = (0.4, 0.5, 0.6)


def evaluate(dataset, campaign, step=STEP_CHANCE, runs=None):
    history = dataset.before(campaign["start_date"])
    kwargs = {"step": step} if runs is None else {"step": step, "runs": runs}
    proposal = build(history, CampaignParams.from_campaign(campaign), **kwargs)
    detector = Detector.fit(history)
    new = replay_proposal(dataset, campaign, proposal, detector, growth_factors(history))
    old = replay_fixed(dataset, campaign, dataset.ladder_by_campaign[campaign["campaign_id"]])
    return proposal, old, new


def compare_manual(dataset, campaign_id, manual_ladder):
    """Score any hand-made ladder against the status quo and ours, on the same campaign's real posts.
    The manual ladder is applied like the status quo: same rungs for everyone, fixed rupee amounts."""
    campaign = dataset.campaign_by_id[campaign_id]
    rungs = [{"view_threshold": int(r["view_threshold"]), "payout_amount": float(r["payout_amount"])}
             for r in manual_ladder]
    if not rungs or any(r["view_threshold"] <= 0 or r["payout_amount"] < 0 for r in rungs):
        raise ValueError("A ladder needs at least one rung with positive views and a non-negative payout")
    proposal, old, new = evaluate(dataset, campaign)
    return {"campaign": campaign, "status_quo": old, "manual": replay_fixed(dataset, campaign, rungs),
            "ours": new, "proposal": proposal.to_dict(),
            "status_quo_ladder": dataset.ladder_by_campaign[campaign_id], "manual_ladder": rungs}


def eligible(dataset):
    return [c for c in dataset.campaigns if len(dataset.before(c["start_date"]).campaigns) >= MIN_HISTORY]


def pick_showcase(candidates, n=N_SHOWCASE):
    """Latest campaigns first, preferring ones that add a category, platform or tier not yet covered."""
    chosen, seen = [], set()
    pool = sorted(candidates, key=lambda c: c["start_date"], reverse=True)
    while len(chosen) < n and pool:
        best = max(pool, key=lambda c: len({("cat", c["category"]), ("plat", c["platform"]),
                                              ("tier", c["target_creator_tier"])} - seen))
        pool.remove(best)
        chosen.append(best)
        seen |= {("cat", best["category"]), ("plat", best["platform"]), ("tier", best["target_creator_tier"])}
    return sorted(chosen, key=lambda c: c["start_date"])


def _mean(xs):
    xs = list(xs)
    return statistics.fmean(xs) if xs else 0.0


def _next_rung_gap(proposal, dataset, campaign):
    """How many more views, as a share of today's, a typical paid post needs for the next rung.
    Small gaps are cheap to fake with bought views; large gaps make creators give up."""
    gaps = []
    for p in dataset.posts_by_campaign[campaign["campaign_id"]]:
        ladder = proposal.ladder_for(dataset.tier_of(p), p["format"])
        nxt = ladder.next_rung(p["views_final"])
        if nxt and ladder.cleared(p["views_final"]):
            gaps.append(nxt / p["views_final"] - 1)
    return statistics.median(gaps) if gaps else None


def run(dataset=None):
    dataset = dataset or load()
    pool = eligible(dataset)
    showcase_ids = {c["campaign_id"] for c in pick_showcase(pool)}

    rows, tier_totals, sensitivity = [], {"old": {}, "new": {}}, {s: [] for s in STEPS}
    for campaign in pool:
        for step in STEPS:
            proposal, old, new = evaluate(dataset, campaign, step)
            sensitivity[step].append((proposal, old, new, _next_rung_gap(proposal, dataset, campaign)))
            if step != STEP_CHANCE:
                continue
            for name, result in (("old", old), ("new", new)):
                for tier, v in result["completion_by_tier"].items():
                    acc = tier_totals[name].setdefault(tier, [0, 0])
                    acc[0] += v["creators"]
                    acc[1] += v["hit"]
            rows.append({"campaign": campaign, "proposal": proposal.to_dict(), "old": old, "new": new,
                         "old_ladder": dataset.ladder_by_campaign[campaign["campaign_id"]],
                         "showcase": campaign["campaign_id"] in showcase_ids})

    last = max(dataset.campaigns, key=lambda c: c["start_date"])
    detector = Detector.fit(dataset.before(last["start_date"]))
    report = {
        "assumptions": {"step_chance": STEP_CHANCE, "min_history": MIN_HISTORY,
                                        "note": "A different ladder would change who joins and how hard they try; with no data "
                                "on that, creator behaviour is held fixed and only money and reach are compared."},
        "campaigns": rows,
        "summary": _summary(rows),
        "completion_by_tier": {
            name: {t: {"creators": s, "hit": h, "rate": h / s} for t, (s, h) in sorted(
                totals.items(), key=lambda kv: TIERS.index(kv[0]))}
            for name, totals in tier_totals.items()},
        "sensitivity": [_sensitivity_row(step, results) for step, results in sensitivity.items()],
        "fraud": score(detector, dataset, dataset.posts),
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "backtest.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    (RESULTS_DIR / "BACKTEST.md").write_text(render_markdown(report), encoding="utf-8")
    return report


def _summary(rows):
    def side(name):
        rs = [r[name] for r in rows]
        return {
            "within_budget": sum(r["within_budget"] for r in rs),
            "worst_overspend": max(r["budget_used"] for r in rs) - 1,
            "total_spend": sum(r["spend"] for r in rs),
            "total_budget": sum(r["budget"] for r in rs),
            "completion": sum(r["creators_hitting_milestone"] for r in rs) / sum(r["creators"] for r in rs),
            "paid_to_bought_views": sum(r["paid_to_bought_views"] for r in rs),
            "clean_posts_withheld": sum(r["clean_posts_withheld"] for r in rs),
        }
    return {"campaigns": len(rows), "old": side("old"), "new": side("new"),
            "closed_early": sum(1 for r in rows if r["new"]["closed_early_on"]),
            "posts_turned_away": sum(r["new"]["posts_rejected"] for r in rows)}


def _sensitivity_row(step, results):
    rungs = [len(g.rungs) for proposal, *_ in results for g in proposal.ladders if g.expected_posts >= 1]
    gaps = [gap for *_, gap in results if gap is not None]
    news = [new for _, _, new, _ in results]
    return {
        "step_chance": step,
        "avg_rungs": _mean(rungs),
        "within_budget": sum(n["within_budget"] for n in news),
        "campaigns": len(news),
        "completion": sum(n["creators_hitting_milestone"] for n in news) / sum(n["creators"] for n in news),
        "views_unpaid_by_rounding": _mean(n["views_unpaid_by_rounding"] for n in news),
        "median_gap_to_next_rung": statistics.median(gaps) if gaps else None,
        "closed_early": sum(1 for n in news if n["closed_early_on"]),
    }


# --- Markdown report ------------------------------------------------------------------------------

def _rs(x):
    return f"₹{x:,.0f}"


def _pct(x):
    return f"{x:.0%}"


def render_markdown(report):
    s = report["summary"]
    old, new = s["old"], s["new"]
    lines = [
        "# Backtest results",
        "",
        "Generated by `python -m ladder backtest`. Every number below is computed, not typed.",
        "",
        "**Method.** For each campaign, the ladder is rebuilt using only campaigns that had fully settled "
        "before it started. The campaign's real posts are then replayed under the ladder that was actually "
        "used (status quo) and under ours.",
        "",
        f"**Assumption.** The same posts happen under both ladders. {report['assumptions']['note']}",
        "",
        f"## Headline, across all {s['campaigns']} campaigns with at least {MIN_HISTORY} settled campaigns of history",
        "",
        "| | Status quo ladders | Our ladders |",
        "|---|---:|---:|",
        f"| Campaigns within budget | {old['within_budget']} / {s['campaigns']} | {new['within_budget']} / {s['campaigns']} |",
        f"| Worst overspend | {_pct(max(0, old['worst_overspend']))} over | {_pct(max(0, new['worst_overspend']))} over |",
        f"| Total paid out | {_rs(old['total_spend'])} | {_rs(new['total_spend'])} |",
        f"| Total budget | {_rs(old['total_budget'])} | {_rs(new['total_budget'])} |",
        f"| Creators hitting at least one milestone | {_pct(old['completion'])} | {_pct(new['completion'])} |",
        f"| Paid to posts with bought views | {_rs(old['paid_to_bought_views'])} | {_rs(new['paid_to_bought_views'])} |",
        f"| Clean posts withheld (false alarms) | {old['clean_posts_withheld']} | {new['clean_posts_withheld']} |",
        "",
        f"Our method closed {s['closed_early']} campaign(s) early, turning away {s['posts_turned_away']} posts "
        "to keep the guaranteed minimum payable.",
        "",
        "## Fairness: milestone hit rate by creator tier",
        "",
        "| Tier | Status quo | Ours |",
        "|---|---:|---:|",
    ]
    for tier in TIERS:
        o = report["completion_by_tier"]["old"].get(tier)
        n = report["completion_by_tier"]["new"].get(tier)
        if o and n:
            lines.append(f"| {tier} | {_pct(o['rate'])} ({o['creators']} creators) | {_pct(n['rate'])} ({n['creators']} creators) |")
    lines += [
        "",
        "Status quo ladders are one set of round numbers per campaign, so they are trivial for big creators "
        "and out of reach for small ones. Ours give every tier the same odds.",
        "",
        "## The five showcase campaigns",
        "",
    ]
    for row in report["campaigns"]:
        if not row["showcase"]:
            continue
        c, o, n, p = row["campaign"], row["old"], row["new"], row["proposal"]
        lines += [
            f"### {c['campaign_id']}: {c['category']} · {c['platform']} · target {c['target_creator_tier']} · budget {_rs(c['total_budget'])}",
            "",
            f"Brand maximum ₹{c['brand_max_cpm']} per 1,000 views. Our guaranteed minimum: ₹{p['pricing']['min_cpm']:.1f}. "
            f"Lowball check: **{p['lowball']['status']}**. {p['lowball']['message']}",
            "",
            "| | Status quo | Ours |",
            "|---|---:|---:|",
            f"| Paid out | {_rs(o['spend'])} ({_pct(o['budget_used'])} of budget) | {_rs(n['spend'])} ({_pct(n['budget_used'])} of budget) |",
            f"| Within budget | {'yes' if o['within_budget'] else '**no**'} | {'yes' if n['within_budget'] else '**no**'} |",
            f"| Refund to brand | {_rs(max(0, o['refund']))} | {_rs(max(0, n['refund']))} |",
            f"| Paid per 1,000 real views | ₹{o['effective_cpm']:.1f} | ₹{n['effective_cpm']:.1f} |",
            f"| Creators hitting a milestone | {o['creators_hitting_milestone']} / {o['creators']} ({_pct(o['completion'])}) | {n['creators_hitting_milestone']} / {n['creators']} ({_pct(n['completion'])}) |",
            f"| Paid to bought views | {_rs(o['paid_to_bought_views'])} | {_rs(n['paid_to_bought_views'])} |",
            f"| Posts turned away (early close) | – | {n['posts_rejected']} |",
            "",
            f"Difference: ours pays **{_rs(abs(n['spend'] - o['spend']))} {'more' if n['spend'] > o['spend'] else 'less'}** than the status quo.",
            "",
            "Status quo ladder (same for every creator): " + ", ".join(
                f"{r['view_threshold']:,} → ₹{r['payout_amount']:,}" for r in row["old_ladder"]),
            "",
            "Our ladders (views; min–max payout):",
            "",
        ]
        for g in p["ladders"]:
            if g["expected_posts"] < 1:
                continue
            rungs = ", ".join(f"{r['views']:,} (₹{r['min_payout']:,}–{r['max_payout']:,})" for r in g["rungs"])
            lines.append(f"- **{g['tier']} {g['format']}**: {rungs}")
        lines.append("")
    lines += [
        "## All campaigns",
        "",
        "| Campaign | Category | Budget | Status quo spend | Our spend | Status quo hit rate | Our hit rate | Closed early |",
        "|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for row in report["campaigns"]:
        c, o, n = row["campaign"], row["old"], row["new"]
        lines.append(f"| {c['campaign_id']} | {c['category']} · {c['platform']} · {c['target_creator_tier']} | "
                     f"{_rs(c['total_budget'])} | {_pct(o['budget_used'])} | {_pct(n['budget_used'])} | "
                     f"{_pct(o['completion'])} | {_pct(n['completion'])} | {n['closed_early_on'] or '–'} |")
    lines += [
        "",
        "## Sensitivity: the one policy choice (step chance)",
        "",
        "| Step chance | Avg rungs | Within budget | Hit rate | Views unpaid by rounding down | Median extra views to next rung | Closed early |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in report["sensitivity"]:
        gap = f"+{r['median_gap_to_next_rung']:.0%}" if r["median_gap_to_next_rung"] is not None else "–"
        lines.append(f"| {r['step_chance']:.0%} | {r['avg_rungs']:.1f} | {r['within_budget']} / {r['campaigns']} | "
                     f"{_pct(r['completion'])} | {_pct(r['views_unpaid_by_rounding'])} | {gap} | {r['closed_early']} |")
    lines += [
        "",
        "Lower step chance means fewer, wider rungs: harder and more expensive to fake, but more views "
        "go unpaid by rounding down and the next rung feels further away. Higher means the reverse. "
        "How creators *react* to each (drop-off) cannot be measured from this data; see docs/METHODOLOGY.md.",
        "",
        "## Fraud: detector vs the ops label, both scored against the generator's hidden truth",
        "",
        "| Signal | Boosted posts caught | Missed | Clean posts wrongly held | Precision | Recall |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    names = {"label_only": "Ops label only (status quo)", "detector_only": "Our detector only",
             "label_or_detector": "Label or detector (what we use)"}
    for key, r in report["fraud"].items():
        lines.append(f"| {names[key]} | {r['caught']} | {r['missed']} | {r['false_alarms']} | "
                     f"{_pct(r['precision'])} | {_pct(r['recall'])} |")
    lines.append("")
    return "\n".join(lines)
