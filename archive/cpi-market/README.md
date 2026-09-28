# CPI market

Mint-only price discovery for sticky ad campaigns. Advertisers fund a pool; publishers join and
mint one coin per impression; every coin settles at one price, and whatever the market cannot
absorb is refunded. The price is discovered across campaigns, so a thin market is never charged
the pool split. Mechanism and results: [REPORT.md](REPORT.md).

## Run

```
npm start                 # http://localhost:3000 — API + test page
npm run simulate          # scenario table in the terminal
npm test                  # invariants
```

No dependencies.

## Test page

Open `http://localhost:3000`. **Seed** fills the platform curve from simulated campaigns so the
market is already learned, then create a campaign, join as a publisher, mint impressions, and
settle. The estimated payout updates as coins are minted, and the supply curve shows both
candidate prices.

## Publisher game

`http://localhost:3000/publisher.html` — join a campaign, advance six hours at a time, report the
impressions you delivered, get paid at settlement.

### Ladder design

Targets are not a rising multiplier. A bar that chases your last delivery escalates until it is
unreachable, which is the classic way to break a progression system. Instead:

| Principle | Applied as |
|---|---|
| **The 85% rule** (Wilson et al. 2019) and the **challenge point framework** (Guadagnoli & Lee) — engagement peaks at high, not even, success rates | Rungs are placed at fixed clear probabilities: **85% / 50% / 20%**. Rung one sits *below* typical delivery on purpose. |
| **Goal-setting theory** (Locke & Latham) — goals work only when accepted as attainable | Every rung is a quantile of the publisher's own demonstrated delivery, never an external quota. |
| **Zone of proximal development** (Vygotsky) | The stretch rung sits just past the median of current ability, not far beyond it. |
| **Flow channel** (Csikszentmihalyi) and **DDA** (Hunicke's *Hamlet*, Valve's L4D AI Director) — pace tension as a sawtooth | Three strong steps earn a **recovery beat** where the bar eases; difficulty never ramps monotonically. |
| **Anti-frustration and catch-up design**, bounded so the challenge survives | The bar **holds** through two misses, then eases ~12% per further miss, and **stops at a market floor** (30% of what a typical rival delivers per step). A **near miss** (within 10%) is never punished; a **streak freeze** forgives one miss per five steps. |

The capability model is a recency-weighted **median** with a log-scale spread, so a single lucky
step cannot drag the bar upward — only sustained delivery moves it. Rising is capped at 1.5x per
step; falling is a 5% drift when your demonstrated level slips, or the miss decay above. When the
pool can no longer absorb more coins, rungs stop advertising odds and say so instead.

**The floor is what keeps it a game.** Chasing a failing publisher down to a bar of 1 would reward
delivering nothing, so the decay stops at the market minimum: deliver a fifth of it and you clear
no rungs at all, however long you persist. A publisher below the floor is not shielded from that —
they are simply not competitive yet, and the ladder says so ("minimum to stay in").

Rung placement is calibrated, not assumed: the textbook quantiles produced measured clear rates of
83 / 53 / 28 percent, because the centre and spread are themselves estimated from a few noisy
steps. The shipped values are tuned against simulated publishers to land on **85 / 50 / 21** for
publishers at or above the market floor, and a test holds them there. Below the floor the rates
fall away by design — that is the competition, not a bug.

Money is never gamified: payout is always coins times the settled CPI. Tiers (Bronze → Diamond, by
share of pool) are recognition only.

## Campaign simulator

`http://localhost:3000/simulator.html` — enter a budget, an expected CPI and a duration in days,
pick a publisher market (or `random`), and watch one campaign run hour by hour: publishers
arriving and joining, coins minting, the estimated CPI falling as the pool dilutes, and the
refund shrinking. Playback has speed control, pause, restart and jump-to-settlement. The final
panel reports coins minted, CPI resolved, amount paid, refund, and what splitting the pool would
have cost instead.

Archetypes are relative to the campaign's own target volume (`budget / expected CPI`), so they
mean the same thing at any budget or duration:

| Archetype | Supply vs target | Publisher prices |
|---|---|---|
| `thin` | 0.25x | 1.5x expected CPI |
| `balanced` | 1.2x | 1.0x |
| `abundant` | 3.0x | 0.6x |
| `earlyBurst` / `lateBurst` | 1.2x | 1.0x, arrivals clustered |
| `premium` | 0.6x | 2.0x |
| `random` | one of the above, jittered |

## API

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /api/campaigns` | `{ budget, wantedCpi, durationHours }` | Create a campaign. The posted price comes from the learned curve; `wantedCpi` is only a warmup prior. |
| `GET /api/campaigns` | | List campaigns. |
| `GET /api/campaigns/:id` | | Campaign state, publishers, estimated payouts. |
| `POST /api/campaigns/:id/join` | `{ publisher }` | Join. Sticky: no re-bidding, no withdrawal. |
| `POST /api/campaigns/:id/mint` | `{ publisher, impressions }` | Mint one coin per impression. |
| `POST /api/campaigns/:id/settle` | | Settle at one price, refund the remainder, teach the curve. |
| `GET /api/market` | | Learned supply curve and both candidate prices. |
| `POST /api/market/seed` | `{ market, campaigns }` | Seed the curve from simulated campaigns. |
| `POST /api/simulate` | `{ market, campaigns }` | Run a market and score it against the true price. |
| `POST /api/simulate/campaign` | `{ budget, expectedCpi, durationDays, archetype, seed }` | Simulate one campaign hour by hour. Returns the hourly timeline, per-publisher holdings and the settlement. |
| `GET /api/archetypes` | | Available publisher markets. |

```bash
curl -X POST localhost:3000/api/campaigns \
  -H 'content-type: application/json' \
  -d '{"budget":100000,"wantedCpi":2.0,"durationHours":240}'
```

## Layout

| Path | Role |
|---|---|
| `server/mechanism.js` | supply curve, pricing, settlement |
| `server/store.js` | campaigns, publishers, lifecycle rules |
| `server/index.js` | HTTP API and static hosting |
| `public/index.html` | test page |
| `sim/simulate.js` | publisher agents and the truth benchmark |
| `platform.py`, `market.py` | Python reference the Node port was validated against |
