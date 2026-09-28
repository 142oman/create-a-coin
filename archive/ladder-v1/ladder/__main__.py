"""Command line.

  python -m ladder generate                      write the synthetic data to data/*.json
  python -m ladder build --category gaming --platform instagram --budget 300000 --max-cpm 40 --tier micro
  python -m ladder validate                      view-model checks -> results/VALIDATION.md
  python -m ladder backtest                      backtest -> results/BACKTEST.md
  python -m ladder compare --campaign C035 --ladder my_ladder.json
  python -m ladder serve                         web app on http://localhost:8000
"""
import argparse
import json
import sys

from . import backtest, data, validate
from .builder import CampaignParams, build
from .config import CATEGORIES, PLATFORMS, TIERS


def _money(x):
    return f"₹{x:,.0f}"


def cmd_generate(_):
    from .generate import generate
    dataset = generate()
    data.save(dataset)
    print(f"Wrote {len(dataset.campaigns)} campaigns, {len(dataset.creators)} creators, "
          f"{len(dataset.posts)} posts and {len(dataset.milestone_ladders)} status-quo rungs to {data.DATA_DIR}")


def cmd_build(args):
    dataset = data.load()
    params = CampaignParams(args.category, args.platform, args.budget, args.max_cpm, args.tier,
                            args.start, args.end)
    proposal = build(dataset.before(params.start_date), params)
    if args.json:
        print(json.dumps(proposal.to_dict(), indent=1, default=str))
        return
    p = proposal.to_dict()
    pricing, sim = p["pricing"], p["simulation"]
    print(f"\n{args.category} · {args.platform} · target {args.tier} · budget {_money(args.budget)}")
    print(f"Creators earn ₹{pricing['min_cpm']:.1f} (guaranteed) to ₹{pricing['max_cpm']:.1f} per 1,000 views")
    print(f"Expected posts {p['expected_posts']:.0f} · expected spend {_money(sim['expected_spend'])} · "
          f"expected refund {_money(sim['expected_refund'])}")
    print(f"Lowball check: {p['lowball']['status']} — {p['lowball']['message']}\n")
    for g in p["ladders"]:
        basis = " · ".join(g["basis"]["group"])
        print(f"{g['tier']:>5} {g['format']:<9} ({g['expected_posts']:.1f} posts expected; from {basis}, "
              f"{g['basis']['posts']} past posts)")
        for r in g["rungs"]:
            print(f"        {r['views']:>11,} views  reached by {r['reach']:>6.1%}   "
                  f"{_money(r['min_payout']):>10} – {_money(r['max_payout'])}")
    print()


def cmd_validate(_):
    validate.run()
    print(f"Wrote {validate.RESULTS_DIR / 'VALIDATION.md'}")


def cmd_backtest(_):
    report = backtest.run()
    s = report["summary"]
    print(f"Within budget: status quo {s['old']['within_budget']}/{s['campaigns']}, "
          f"ours {s['new']['within_budget']}/{s['campaigns']}")
    print(f"Wrote {backtest.RESULTS_DIR / 'BACKTEST.md'}")


def cmd_compare(args):
    dataset = data.load()
    with open(args.ladder, encoding="utf-8") as f:
        manual = json.load(f)
    if manual and isinstance(manual[0], list):
        manual = [{"view_threshold": v, "payout_amount": r} for v, r in manual]
    result = backtest.compare_manual(dataset, args.campaign, manual)
    rows = [("Paid out", "spend", _money), ("Share of budget", "budget_used", lambda x: f"{x:.0%}"),
            ("Within budget", "within_budget", lambda x: "yes" if x else "NO"),
            ("Creators hitting a milestone", "completion", lambda x: f"{x:.0%}"),
            ("Paid per 1,000 real views", "effective_cpm", lambda x: f"₹{x:.1f}"),
            ("Paid to bought views", "paid_to_bought_views", _money)]
    print(f"\n{args.campaign}: budget {_money(result['campaign']['total_budget'])}\n")
    print(f"{'':32}{'status quo':>14}{'your ladder':>14}{'ours':>14}")
    for label, key, fmt in rows:
        print(f"{label:32}" + "".join(f"{fmt(result[side][key]):>14}" for side in ("status_quo", "manual", "ours")))
    print()


def cmd_serve(args):
    from .server import serve
    serve(args.port)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="python -m ladder", description="Milestone ladder optimisation")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate", help="write synthetic data").set_defaults(func=cmd_generate)
    b = sub.add_parser("build", help="propose a ladder for a new campaign")
    b.add_argument("--category", required=True, choices=CATEGORIES)
    b.add_argument("--platform", required=True, choices=PLATFORMS)
    b.add_argument("--budget", required=True, type=float)
    b.add_argument("--max-cpm", required=True, type=float, help="most the brand pays per 1,000 views (₹)")
    b.add_argument("--tier", required=True, choices=TIERS, help="target creator tier")
    b.add_argument("--start", help="YYYY-MM-DD (default today)")
    b.add_argument("--end", help="YYYY-MM-DD (default start + 30 days)")
    b.add_argument("--json", action="store_true")
    b.set_defaults(func=cmd_build)
    sub.add_parser("validate", help="check the view model").set_defaults(func=cmd_validate)
    sub.add_parser("backtest", help="replay history under both ladders").set_defaults(func=cmd_backtest)
    c = sub.add_parser("compare", help="score a hand-made ladder on a past campaign")
    c.add_argument("--campaign", required=True)
    c.add_argument("--ladder", required=True, help='JSON: [{"view_threshold": 10000, "payout_amount": 500}, ...]')
    c.set_defaults(func=cmd_compare)
    s = sub.add_parser("serve", help="run the web app")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(func=cmd_serve)
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (ValueError, KeyError, FileNotFoundError) as e:
        parser.exit(1, f"error: {e}\n")


if __name__ == "__main__":
    main()
