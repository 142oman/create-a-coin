# Clearing

Brands set a budget. Creators post. Every real view becomes a coin, and the market sets what a
coin is worth. Never over budget, fair goals for every creator size, and no pay for bought views.

## Run it

```bash
python -m ladder serve          # the web app on http://localhost:8000
```

No packages , Python 3.10+, standard library
Other commands:

```bash
python -m ladder generate       # regenerate the world (add --seed N for another one)
python -m ladder backtest       # eight measures, old way vs Clearing, over the generated world
python -m ladder validate       # checks the generated world and the rung model against it
python -m ladder publish --budget 25000 --days 14 --category gaming --format reel [--scenario thin]
```

## Documents

- [`docs/METHODOLOGY.pdf`](docs/METHODOLOGY.pdf) --- how the settlement mechanism works.
- [`docs/ONE_PAGER.pdf`](docs/ONE_PAGER.pdf) --- One page brief.
  manager or a founder.

## The web app

- **Home:** the problem and the idea.
- **Advertiser:** a budget and a fair price per view, then a campaign plays out and a results
  report shows what happened.
- **Creator:** pick a creator, join a campaign, watch a post climb its goals, get paid.
- **Compare:** your own budget and rung table against Clearing, run through 300 simulated markets.
- **Benchmark:** hundreds of simulated campaigns, old way vs Clearing, on their own synthetic
  market so nothing else in the app can skew it.

## Layout

| Path | Role |
|---|---|
| `ladder/world.py` | the generated world: three Markov chains, the recipe, the brief's tables |
| `ladder/engine.py` | rungs, price, pay, fraud check, Fair Reach, cold start, the old way |
| `ladder/store.py` | running summary of settled campaigns (what the engine reads) |
| `ladder/history.py` | replays history in date order, no look-ahead |
| `ladder/simulate.py` | new campaigns for the advertiser and creator flows |
| `ladder/backtest.py`, `validate.py`, `report.py` | analysis and reports, against the generated world |
| `ladder/benchmark.py` | Benchmark and Compare: a synthetic market, independent of the generated world |
| `ladder/server.py`, `web/` | the web app (standard-library server, plain JS) |
| `data/` | the generated world: the brief's four tables as CSV, plus `world.json` |
| `docs/` | the methodology and the one-pager, as PDF |
