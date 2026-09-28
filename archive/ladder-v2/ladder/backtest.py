"""Backtest: rebuild each historical campaign's rungs and market reference from what was known before
it started, replay its real posts three ways, and compare:

  status quo  - the ladder actually used (fixed rupee amounts)
  coin rungs  - our rungs from past posts, paid in coins, coin price settled at the end
  no rungs    - every view above the minimum threshold is a coin, coin price settled at the end

Assumption stated up front: the posts (who joined, what they posted, how many views) are the same
under all three. In Creator Pool a high live coin value would pull more creators in and dilute it;
the replay cannot show that, so it measures money and reach, not behaviour.
"""
import json
import statistics
from pathlib import Path

from .builder import CampaignParams, build
from .config import QUALIFY_REACH, STEP_CHANCE, TIERS
from .data import load
from .fraud import Detector, score
from .settle import replay_fixed, replay_proposal

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
MIN_HISTORY = 12   # campaigns settled before this one; fewer and nearly every group is a cold start
N_SHOWCASE = 5
QUALIFY_LEVELS = (0.7, 0.8, 0.9)
SIDES = ("old", "rungs", "linear")
SIDE_NAMES = {"old": "Status quo", "rungs": "Coin rungs", "linear": "No rungs"}


def evaluate(dataset, campaign, qualify=QUALIFY_REACH):
    """-> proposal, {"old": .., "rungs": .., "linear": ..}"""
    history = dataset.before(campaign["start_date"])
    proposal = build(history, CampaignParams.from_campaign(campaign), qualify=qualify)
    detector = Detector.fit(history)
    return proposal, {
        "old": replay_fixed(dataset, campaign, dataset.ladder_by_campaign[campaign["campaign_id"]]),
        "rungs": replay_proposal(dataset, campaign, proposal, detector, "rungs"),
        "linear": replay_proposal(dataset, campaign, proposal, detector, "linear"),
    }


def compare_manual(dataset, campaign_id, manual_ladder):
    """Score a hand-edited status-quo ladder against our coin rungs and no rungs, on the
    same campaign's real posts. The edited ladder is applied like the status quo: same rungs for
    everyone, fixed rupee amounts."""
    campaign = dataset.campaign_by_id[campaign_id]
    rungs = [{"view_threshold": int(r["view_threshold"]), "payout_amount": float(r["payout_amount"])}
             for r in manual_ladder]
    if not rungs or any(r["view_threshold"] <= 0 or r["payout_amount"] < 0 for r in rungs):
        raise ValueError("A ladder needs at least one rung with positive views and a non-negative payout")
    proposal, sides = evaluate(dataset, campaign)
    return {"campaign": campaign, "status_quo": replay_fixed(dataset, campaign, rungs),
            "rungs": sides["rungs"], "linear": sides["linear"], "proposal": proposal.to_dict(),
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


def run(dataset=None):
    dataset = dataset or load()
    pool = eligible(dataset)
    showcase_ids = {c["campaign_id"] for c in pick_showcase(pool)}

    rows, tier_totals, sensitivity = [], {s: {} for s in SIDES}, {q: [] for q in QUALIFY_LEVELS}
    for campaign in pool:
        for qualify in QUALIFY_LEVELS:
            proposal, sides = evaluate(dataset, campaign, qualify)
            sensitivity[qualify].append(sides)
            if qualify != QUALIFY_REACH:
                continue
            for name in SIDES:
                for tier, v in sides[name]["completion_by_tier"].items():
                    acc = tier_totals[name].setdefault(tier, [0, 0])
                    acc[0] += v["creators"]
                    acc[1] += v["hit"]
            rows.append({"campaign": campaign, "proposal": proposal.to_dict(), **sides,
                         "old_ladder": dataset.ladder_by_campaign[campaign["campaign_id"]],
                         "showcase": campaign["campaign_id"] in showcase_ids})

    last = max(dataset.campaigns, key=lambda c: c["start_date"])
    detector = Detector.fit(dataset.before(last["start_date"]))
    report = {
        "assumptions": {"qualify_reach": QUALIFY_REACH, "step_chance": STEP_CHANCE, "min_history": MIN_HISTORY,
                        "note": "In Creator Pool a high live coin value would draw more creators in and dilute "
                                "it. With no data on that response, creator behaviour is held fixed and only money "
                                "and reach are compared."},
        "campaigns": rows,
        "summary": _summary(rows),
        "completion_by_tier": {
            name: {t: {"creators": s, "hit": h, "rate": h / s} for t, (s, h) in sorted(
                totals.items(), key=lambda kv: TIERS.index(kv[0]))}
            for name, totals in tier_totals.items()},
        "sensitivity": [_sensitivity_row(q, results) for q, results in sensitivity.items()],
        "fraud": score(detector, dataset, dataset.posts),
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "backtest.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    (RESULTS_DIR / "BACKTEST.md").write_text(render_markdown(report), encoding="utf-8")
    return report


def _summary(rows):
    def side(name):
        rs = [r[name] for r in rows]
        out = {
            "within_budget": sum(r["within_budget"] for r in rs),
            "worst_overspend": max(r["budget_used"] for r in rs) - 1,
            "total_spend": sum(r["spend"] for r in rs),
            "total_budget": sum(r["budget"] for r in rs),
            "total_refund": sum(max(0, r["refund"]) for r in rs),
            "completion": sum(r["creators_paid"] for r in rs) / sum(r["creators"] for r in rs),
            "median_cpm": statistics.median(r["effective_cpm"] for r in rs),
            "views_unpaid_on_paid_posts": _mean(r["views_unpaid_on_paid_posts"] for r in rs),
            "paid_to_bought_views": sum(r["paid_to_bought_views"] for r in rs),
            "clean_posts_withheld": sum(r["clean_posts_withheld"] for r in rs),
        }
        if name != "old":
            regimes = {}
            for r in rs:
                regimes[r["regime"]] = regimes.get(r["regime"], 0) + 1
            thin = [r for r in rs if r["regime"] == "thin"]
            out.update({"regimes": regimes, "thin_refund": sum(r["refund"] for r in thin),
                        "thin_pool_over_reference": statistics.median(r["pool_cpm"] / r["reference_cpm"] for r in thin) if thin else None,
                        "thin_price_over_reference": statistics.median(r["coin_cpm"] / r["reference_cpm"] for r in thin) if thin else None})
        return out
    return {"campaigns": len(rows), **{name: side(name) for name in SIDES}}


def _sensitivity_row(qualify, results):
    row = {"qualify_reach": qualify, "campaigns": len(results)}
    for mode in ("rungs", "linear"):
        news = [r[mode] for r in results]
        row[mode] = {
            "within_budget": sum(n["within_budget"] for n in news),
            "completion": sum(n["creators_paid"] for n in news) / sum(n["creators"] for n in news),
            "posts_qualified": sum(n["posts_qualified"] for n in news) / sum(n["posts"] for n in news),
            "thin": sum(1 for n in news if n["regime"] == "thin"),
            "median_coin_cpm": statistics.median(n["coin_cpm"] for n in news),
            "refund_share": sum(max(0, n["refund"]) for n in news) / sum(n["budget"] for n in news),
        }
    return row


# --- Markdown report ------------------------------------------------------------------------------

def _rs(x):
    return f"₹{x:,.0f}"


def _pct(x):
    return f"{x:.0%}"


def _cpm(x):
    return f"₹{x:,.1f}" if x is not None else "–"


def _paid_cell(side):
    return f"{_rs(side['spend'])} ({_pct(side['budget_used'])})"


def _creators_cell(side):
    return f"{side['creators_paid']} / {side['creators']}"


def _regimes(side):
    return ", ".join(f"{n} {k}" for k, n in sorted(side["regimes"].items()))


def render_markdown(report):
    s = report["summary"]
    a = report["assumptions"]
    head = "| | " + " | ".join(SIDE_NAMES[x] for x in SIDES) + " |"
    rule = "|---|" + "---:|" * len(SIDES)
    row = lambda label, f: f"| {label} | " + " | ".join(f(s[x]) for x in SIDES) + " |"
    lines = [
        "# Backtest results",
        "",
        "Generated by `python -m ladder backtest`. Every number below is computed, not typed.",
        "",
        "**Method.** For each campaign, the rungs and the market reference are rebuilt using only campaigns that "
        "had ended before it started. The campaign's real posts are then replayed three ways: the ladder actually "
        "used (status quo), our coin rungs, and no rungs (every view above the minimum threshold is a coin).",
        "",
        f"**Policy settings.** Minimum threshold reached by {a['qualify_reach']:.0%} of posts like yours; each "
        f"further rung by {a['step_chance']:.0%} of those on the rung below.",
        "",
        f"**Assumption.** The same posts happen under all three. {a['note']}",
        "",
        "**What this data can and cannot say.** The data is synthetic, so every number here inherits the "
        "generator's assumptions. The mechanism itself uses none of them: it reads only budgets, views and "
        "settled campaigns.",
        "",
        f"## Headline, across all {s['campaigns']} campaigns with at least {MIN_HISTORY} ended campaigns of history",
        "",
        head, rule,
        row("Campaigns within budget", lambda x: f"{x['within_budget']} / {s['campaigns']}"),
        row("Worst overspend", lambda x: f"{_pct(max(0, x['worst_overspend']))} over"),
        row("Total paid out", lambda x: _rs(x["total_spend"])),
        row("Left with / refunded to brands", lambda x: _rs(x["total_refund"])),
        row("Median paid per 1,000 real views", lambda x: _cpm(x["median_cpm"])),
        row("Creators paid anything", lambda x: _pct(x["completion"])),
        row("Views on paid posts that earned nothing", lambda x: _pct(x["views_unpaid_on_paid_posts"])),
        row("Paid to posts with bought views", lambda x: _rs(x["paid_to_bought_views"])),
        row("Clean posts withheld (false alarms)", lambda x: str(x["clean_posts_withheld"])),
        "",
        f"How Creator Pool settled. Coin rungs: {_regimes(s['rungs'])}. No rungs: {_regimes(s['linear'])}.",
        "",
        "**Coin rungs vs no rungs.** Both spend the same budget. Rounding down to a rung does not save the brand "
        "money when supply is plentiful: it moves the money from views between rungs to posts that crossed a "
        "higher rung. When supply is thin, rungs mint fewer coins, which can change how much is refunded.",
        "",
        "**Why Creator Pool pays more per view than the status quo here.** Gut-feel ladders often paid out "
        "far less than the budget, so brands kept money they had set aside for reach. Creator Pool pays out "
        "the whole budget whenever supply is plentiful, because that is what the brand committed, and refunds "
        "only when supply is thin. In a live market that higher price would draw more creators and dilute it.",
        "",
        "## Creators paid anything, by tier",
        "",
        "| Tier | " + " | ".join(SIDE_NAMES[x] for x in SIDES) + " |",
        rule,
    ]
    for tier in TIERS:
        cells = [report["completion_by_tier"][x].get(tier) for x in SIDES]
        if all(cells):
            lines.append(f"| {tier} ({cells[0]['creators']} creators) | " + " | ".join(_pct(c["rate"]) for c in cells) + " |")
    lines += [
        "",
        "Status quo ladders are one set of round numbers per campaign, so they are trivial for big creators and out "
        "of reach for small ones. Our rungs are set per tier and format, so every tier faces the same odds.",
        "",
        "## Five campaigns up close",
        "",
    ]
    for r in report["campaigns"]:
        if not r["showcase"]:
            continue
        c, p = r["campaign"], r["proposal"]
        cell = lambda f: " | ".join(f(r[x]) for x in SIDES)
        lines += [
            f"### {c['campaign_id']}: {c['category']} · {c['platform']} · target {c['target_creator_tier']} · budget {_rs(c['total_budget'])}",
            "",
            f"Coin rungs settled **{r['rungs']['regime']}** at {_cpm(r['rungs']['coin_cpm'])} per 1,000 coins "
            f"(market {_cpm(r['rungs']['reference_cpm'])}). No rungs settled **{r['linear']['regime']}** at "
            f"{_cpm(r['linear']['coin_cpm'])} (market {_cpm(r['linear']['reference_cpm'])}).",
            "",
            "| | " + " | ".join(SIDE_NAMES[x] for x in SIDES) + " |",
            rule,
            f"| Paid out | {cell(_paid_cell)} |",
            f"| Within budget | {cell(lambda x: 'yes' if x['within_budget'] else '**no**')} |",
            f"| Left with / refunded | {cell(lambda x: _rs(max(0, x['refund'])))} |",
            f"| Paid per 1,000 real views | {cell(lambda x: _cpm(x['effective_cpm']))} |",
            f"| Creators paid | {cell(_creators_cell)} |",
            f"| Views on paid posts that earned nothing | {cell(lambda x: _pct(x['views_unpaid_on_paid_posts']))} |",
            f"| Paid to bought views | {cell(lambda x: _rs(x['paid_to_bought_views']))} |",
            "",
            "Status quo ladder (same for every creator): " + ", ".join(
                f"{x['view_threshold']:,} → ₹{x['payout_amount']:,}" for x in r["old_ladder"]),
            "",
            "Our coin rungs per tier and format (views = coins; the first is the minimum threshold):",
            "",
        ]
        for g in p["ladders"]:
            lines.append(f"- **{g['tier']} {g['format']}**: " + " → ".join(f"{x['views']:,}" for x in g["rungs"]))
        lines.append("")
    lines += [
        "## All campaigns",
        "",
        "| Campaign | Group | Budget | Status quo spend | Coin rungs spend | No rungs spend | Coin rungs settled | No rungs settled |",
        "|---|---|---:|---:|---:|---:|---|---|",
    ]
    for r in report["campaigns"]:
        c = r["campaign"]
        lines.append(f"| {c['campaign_id']} | {c['category']} · {c['platform']} · {c['target_creator_tier']} | "
                     f"{_rs(c['total_budget'])} | {_pct(r['old']['budget_used'])} | {_pct(r['rungs']['budget_used'])} | "
                     f"{_pct(r['linear']['budget_used'])} | {r['rungs']['regime']} {_cpm(r['rungs']['coin_cpm'])} | "
                     f"{r['linear']['regime']} {_cpm(r['linear']['coin_cpm'])} |")
    lines += [
        "",
        "Prices are per 1,000 coins (one coin = one view).",
        "",
        "## Sensitivity: where the minimum threshold sits",
        "",
        "| Posts reaching the threshold | Mode | Within budget | Creators paid | Posts qualifying | Thin campaigns | Median coin price | Refunded |",
        "|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    for r in report["sensitivity"]:
        for mode in ("rungs", "linear"):
            m = r[mode]
            lines.append(f"| {r['qualify_reach']:.0%} | {SIDE_NAMES[mode]} | {m['within_budget']} / {r['campaigns']} | "
                         f"{_pct(m['completion'])} | {_pct(m['posts_qualified'])} | {m['thin']} | "
                         f"{_cpm(m['median_coin_cpm'])} | {_pct(m['refund_share'])} |")
    lines += [
        "",
        "A lower bar pays more posts, so the same budget spreads over more coins and each is worth a little less. "
        "Weak posts carry few views, so the coin value moves far less than the number of creators paid.",
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
