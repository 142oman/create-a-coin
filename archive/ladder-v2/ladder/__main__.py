"""Command line.

  python -m ladder generate                      write the synthetic data to data/*.json
  python -m ladder build --budget 300000 --category gaming --platform instagram --tier nano micro
  python -m ladder simulate --budget 300000 --category gaming --scenario crowded --seed 42
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
from .config import CATEGORIES, FORMATS, PLATFORMS, TIERS
from .simulate import SCENARIOS, simulate


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
    params = CampaignParams(args.budget, args.category or [], args.platform or [], args.tier or [],
                            args.start, args.end, args.format or [])
    proposal = build(dataset.before(params.start_date), params)
    if args.json:
        print(json.dumps(proposal.to_dict(), indent=1, default=str))
        return
    p = proposal.to_dict()
    o = p["params"]["open"]
    print(f"\nBudget {_money(args.budget)} · open to {', '.join(o['categories'])} · {', '.join(o['platforms'])} "
          f"({', '.join(o['formats'])}) · tiers {', '.join(o['tiers'])}")
    for mode, label in (("rungs", "Coin rungs"), ("linear", "No rungs")):
        m = p["market"][mode]
        if m["cpm"]:
            print(f"{label}: market ₹{m['cpm']:.1f} per 1,000 coins ({m['basis']}); fewer than "
                  f"{m['break_even_coins']:,} coins is a thin market and refunds, more spends the whole budget.")
        else:
            print(f"{label}: no market reference yet ({m['basis']}).")
    print("\nRungs in views = coins (the first is the minimum threshold; share of posts reaching each):")
    for g in p["ladders"]:
        print(f"  {g['platform']:<9} {g['tier']:>5} {g['format']:<9} " + "  ".join(
            f"{r['views']:>9,} ({r['reach']:.0%})" for r in g["rungs"]))
    print()


def cmd_simulate(args):
    dataset = data.load()
    params = CampaignParams(args.budget, args.category or [], args.platform or [], args.tier or [],
                            args.start, args.end, args.format or [])
    run = simulate(dataset, params, args.scenario, args.seed)
    if args.json:
        print(json.dumps(run, indent=1, default=str))
        return
    print(f"\nScenario {run['scenario']} · seed {run['seed']} · {run['summary']['creators']} creators, "
          f"{run['summary']['posts']} posts ({run['summary']['posts_held']} held for fraud)")
    for mode, label in (("rungs", "Coin rungs"), ("linear", "No rungs")):
        st = run["settlement"][mode]
        print(f"{label:>10}: {st['coins']:,} coins · {st['regime']} · ₹{st['coin_cpm']:.1f} per 1,000 · "
              f"paid {_money(st['paid'])} · refund {_money(st['refund'])}")
    print(f"\n{'creator':<8}{'tier':>6}{'views':>11}{'rung coins':>12}{'rung ₹':>10}{'coins':>11}{'no-rung ₹':>11}")
    for c in run["creators"][:15]:
        print(f"{c['creator_id']:<8}{c['tier']:>6}{c['views']:>11,}{c['coins']['rungs']:>12,}{_money(c['paid']['rungs']):>10}"
              f"{c['coins']['linear']:>11,}{_money(c['paid']['linear']):>11}")
    print()


def cmd_validate(_):
    validate.run()
    print(f"Wrote {validate.RESULTS_DIR / 'VALIDATION.md'}")


def cmd_backtest(_):
    report = backtest.run()
    s = report["summary"]
    print(f"Within budget: status quo {s['old']['within_budget']}/{s['campaigns']}, "
          f"coin rungs {s['rungs']['within_budget']}/{s['campaigns']} {s['rungs']['regimes']}, "
          f"no rungs {s['linear']['within_budget']}/{s['campaigns']} {s['linear']['regimes']}")
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
            ("Creators paid", "completion", lambda x: f"{x:.0%}"),
            ("Paid per 1,000 real views", "effective_cpm", lambda x: f"₹{x:.1f}"),
            ("Paid to bought views", "paid_to_bought_views", _money)]
    print(f"\n{args.campaign}: budget {_money(result['campaign']['total_budget'])}\n")
    print(f"{'':32}{'status quo':>14}{'coin rungs':>14}{'no rungs':>14}")
    for label, key, fmt in rows:
        print(f"{label:32}" + "".join(f"{fmt(result[side][key]):>14}" for side in ("status_quo", "rungs", "linear")))
    print()


def cmd_serve(args):
    from .server import serve
    serve(args.port)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="python -m ladder", description="Creator Pool: milestone campaigns paid from a coin pool")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate", help="write synthetic data").set_defaults(func=cmd_generate)
    b = sub.add_parser("build", help="rungs and market terms for a new campaign")
    sim = sub.add_parser("simulate", help="play a new campaign out with simulated creators")
    for command in (b, sim):
        command.add_argument("--budget", required=True, type=float)
        command.add_argument("--category", nargs="*", choices=CATEGORIES, help="any number; none = any category")
        command.add_argument("--platform", nargs="*", choices=PLATFORMS, help="any number; none = both")
        command.add_argument("--format", nargs="*", choices=[f for fs in FORMATS.values() for f in fs],
                             help="which formats count; none = every format on the chosen platforms")
        command.add_argument("--tier", nargs="*", choices=TIERS, help="who can join; none = every tier")
        command.add_argument("--start", help="YYYY-MM-DD (default today)")
        command.add_argument("--end", help="YYYY-MM-DD (default start + 30 days)")
        command.add_argument("--json", action="store_true")
    b.set_defaults(func=cmd_build)
    sim.add_argument("--scenario", default="normal", choices=SCENARIOS)
    sim.add_argument("--seed", type=int, help="same seed, same campaign (default: random)")
    sim.set_defaults(func=cmd_simulate)
    sub.add_parser("validate", help="check the view model").set_defaults(func=cmd_validate)
    sub.add_parser("backtest", help="replay history under all three systems").set_defaults(func=cmd_backtest)
    c = sub.add_parser("compare", help="score an edited status-quo ladder on a past campaign")
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
