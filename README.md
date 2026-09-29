# Creator Coin

Brands set a budget. Creators post. Every real view becomes a coin, and the market sets what a coin is
worth. Never over budget, fair goals for every creator size, and no pay for bought views.

| Deliverable | Where |
|---|---|
| A. Methodology | [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) (decisions: [`docs/DISCUSSION.md`](docs/DISCUSSION.md)) |
| B. Working code | [`ladder/`](ladder): Python 3.10+, standard library only |
| C. Backtest | [`results/BACKTEST.md`](results/BACKTEST.md), checks in [`results/VALIDATION.md`](results/VALIDATION.md) |
| D. One-pager | [`docs/ONE_PAGER.md`](docs/ONE_PAGER.md) |
| Generated data | [`data/`](data): the brief's four tables as CSV, plus `world.json`; generator in [`ladder/world.py`](ladder/world.py) |

## Run it

```bash
python -m ladder serve          # the web app on http://localhost:8000
python -m ladder generate       # regenerate the world (add --seed N for another one)
python -m ladder backtest       # results/BACKTEST.md
python -m ladder validate       # results/VALIDATION.md
python -m ladder publish --budget 25000 --days 14 --category gaming --format reel [--scenario thin]
python -m unittest              # 33 tests
```

No packages to install. The data and results are committed, so `serve` works straight away.

## The web app

- **Home:** the problem and the idea in one scroll.
- **Advertiser:** four questions, Publish, then the campaign plays out in 20 seconds and a results
  report shows what you got and what we protected you from. Try "too few views" or "a fraud wave".
- **Creator:** pick a creator, join a campaign, see your goals, watch your post climb them, get paid.
- **Compare:** a budget, a fair CPI, and the old way's own rung table (random by default, editable),
  then both run through 300 simulated markets and a scorecard rates each on budget adherence, creator
  retention, tier fairness and brand ROI.
- **Benchmark:** hundreds of simulated campaigns, old ladder vs Clearing, not the generated world —
  its own synthetic market, so it can't be skewed by (or skew) anything else in the app. Replaces the
  old Backtest page; `python -m ladder backtest` (eight measures over the generated history) is still
  a separate CLI command, unaffected.
- **Method:** the docs.

## Layout

| Path | Role |
|---|---|
| `ladder/world.py` | the generated world: three Markov chains, the recipe, the brief's tables |
| `ladder/engine.py` | rungs, price, pay, fraud check, Fair Reach, cold start, the old way |
| `ladder/store.py` | running summary of settled campaigns (what the engine reads) |
| `ladder/history.py` | replays history in date order, no look-ahead |
| `ladder/simulate.py` | new campaigns for the advertiser and creator flows |
| `ladder/backtest.py`, `validate.py`, `report.py` | the pages' analyses and reports, against the generated world |
| `ladder/benchmark.py` | Benchmark and Compare: a synthetic market, not the generated world, so a change to it can't affect the other pages |
| `ladder/server.py`, `web/` | the web app (standard-library server, plain JS) |
| `archive/` | earlier designs, kept for reference |
