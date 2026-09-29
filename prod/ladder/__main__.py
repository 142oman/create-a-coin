"""Command line.

  python -m ladder generate [--seed N]      generate the world -> data/world.json + the brief's tables as CSV
  python -m ladder backtest                 eight measures, old way vs Creator Coin -> results/
  python -m ladder validate                 checks on the generated world and the method -> results/
  python -m ladder publish --budget 25000 --days 21 --category gaming --format reel [--scenario thin]
  python -m ladder serve [--port 8000]      the web app
"""
import argparse
import json
import sys
from pathlib import Path

from . import backtest, data, simulate, validate
from . import report as md
from .config import ALL_FORMATS, CATEGORIES, NAME
from .history import replay
from .world import Recipe, generate

RESULTS = Path(__file__).resolve().parent.parent / "results"


def _money(x):
    return f"₹{x:,.0f}"


def cmd_generate(args):
    world = generate(Recipe(seed=args.seed) if args.seed is not None else Recipe())
    results, _, _ = replay(world)
    held = {d["post_id"] for r in results.values() if r for d in r["posts"] if d["held"]}
    data.save(world, flagged=held)
    print(f"Wrote {len(world.campaigns)} campaigns, {len(world.creators)} creators, {len(world.posts)} posts "
          f"(seed {world.recipe.seed}) to {data.DATA_DIR}")


def cmd_backtest(_):
    world = data.load()
    rows = backtest.rows(world)
    report = backtest.summarise(rows)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "backtest.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (RESULTS / "BACKTEST.md").write_text(md.backtest_md(world, rows), encoding="utf-8")
    b = report["budget"]
    print(f"{report['campaigns']} campaigns. Over budget: old way {b['old_over']}, {NAME} {b['new_over']}. "
          f"Cost per 1,000 genuine views: old ₹{report['cost_per_1k']['old'] or 0:.1f}, "
          f"{NAME} ₹{report['cost_per_1k']['new'] or 0:.1f}. Wrote {RESULTS / 'BACKTEST.md'}")


def cmd_validate(_):
    world = data.load()
    report = validate.run(world)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "validation.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (RESULTS / "VALIDATION.md").write_text(md.validation_md(world, report), encoding="utf-8")
    r = report["rungs"]
    print("Rung reach, design vs actual: " + ", ".join(
        f"{d:.0%}/{a:.0%}" for d, a in zip(r["design"], r["actual"] or [])))
    print(f"Wrote {RESULTS / 'validation.json'}")


def cmd_publish(args):
    world = data.load()
    _, _, summary = replay(world)
    sim = simulate.simulate(world, summary, args.category, args.format, args.budget, args.days, args.seed,
                            args.scenario)
    r, o = sim["report"], sim["ours"]
    print(f"\n{sim['scenario_label']} · seed {sim['seed']} · {r['creators']} creators, {r['posts']} posts")
    print(f"Genuine views {r['genuine_views']:,} · paid {_money(r['paid'])} · money back {_money(r['money_back'])}")
    print(f"Cost per 1,000 views: {NAME} ₹{r['cpm'] or 0:.1f}, the old way ₹{r['old_cpm'] or 0:.1f} "
          f"(old way paid {_money(r['old_paid'])}, {_money(r['old_over_budget'])} over budget)")
    for c in r["cards"]:
        print(" · " + c["text"])
    print()


def cmd_serve(args):
    from .server import serve
    serve(args.port)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="python -m ladder", description=f"{NAME}: creator campaigns paid from a coin pool")
    sub = parser.add_subparsers(dest="command", required=True)
    g = sub.add_parser("generate", help="generate the world")
    g.add_argument("--seed", type=int)
    g.set_defaults(func=cmd_generate)
    sub.add_parser("backtest", help="old way vs Creator Coin on the history").set_defaults(func=cmd_backtest)
    sub.add_parser("validate", help="checks on the world and the method").set_defaults(func=cmd_validate)
    p = sub.add_parser("publish", help="play a new campaign out")
    p.add_argument("--budget", type=float, required=True)
    p.add_argument("--days", type=int, required=True)
    p.add_argument("--category", nargs="*", choices=CATEGORIES)
    p.add_argument("--format", nargs="*", choices=ALL_FORMATS)
    p.add_argument("--seed", type=int)
    p.add_argument("--scenario", default="normal", choices=list(simulate.SCENARIOS))
    p.set_defaults(func=cmd_publish)
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
