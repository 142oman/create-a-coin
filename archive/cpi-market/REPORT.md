# Sticky CPI Market: Mechanism Report

## Problem

An advertiser funds a campaign with budget `B` over a window `T`. Publishers join over time and
post content that stays up, so a join is sticky: it cannot be re-bid or withdrawn. No CPI is set
by anyone. Splitting the pool pro-rata (`B/M` over minted coins `M`) breaks down when few
publishers join, charging absurd prices for scarce impressions.

**Observability:** the only thing the system records is minting. A publisher either contributes
impressions or does not. A publisher who considers the campaign and declines is invisible.

## Model

| Symbol | Meaning |
|---|---|
| `B` | campaign budget (the cash pool) |
| `c_e` | advertiser's wanted CPI — a prior only, never a cap or a floor |
| `m_i`, `M` | coins minted by publisher `i` (1 verified impression = 1 coin), and their total |
| `ĝ(p)` | coins the market delivers at posted price `p` |

Each campaign posts one price for its whole window. Every coin settles at one value, known only
after the campaign resolves.

## Why discovery happens across campaigns

Within one campaign, minting data cannot price the market: zero coins is ambiguous between "the
price is too low" and "nobody is there", and a thin campaign yields only tens of join events.
Four control laws and four settlement rules were tested on single-campaign data; all worked in
thick markets and all failed in thin ones at 25–150% error.

Pooled across campaigns, the `(posted price, coins delivered)` pairs trace the supply curve.
A thin campaign is then priced from thousands of events rather than fifteen.

## Mechanism

**1. Estimate the supply curve.** Kernel-smoothed in log price over all past campaigns:

```
ĝ(p) = Σ coins_j · w_j / Σ w_j ,   w_j = exp(−(ln p_j − ln p)² / 2h²) ,   h = 0.18
```

**2. Post the price.** On a log grid spanning the observed prices, take two candidates and use
the cheaper one:

```
p_x = cheapest p with p · ĝ(p) ≥ B          budget would be fully spent
p_s = cheapest p with ĝ(p) ≥ 0.95 · plateau  all available supply already bought
posted price p = min(p_x, p_s)
```

`plateau` is the median of `ĝ` over the top price decile, not its maximum: the maximum of a
noisy estimate is biased upward and drags the saturation point with it.

`min` is the healing rule. Paying past saturation buys no extra supply, so a thin market is
never charged the pool split. Order matters: taking `p_x` first reproduces the absurdity.

**3. Explore.** Before 15 campaigns are observed, price at `c_e · exp(U[−2, 2])`. After that,
10% of campaigns are priced at `p · exp(U[−2, 2])` and the rest at `p · exp(N(0, 0.1))`.
Exploration is symmetric and never anchored on the advertiser's quote.

**4. Settle.** One price for every coin, budget conserved by construction:

```
c* = min(p, B/M)     D = c*·M     R = B − D  (refunded)
```

## Properties

- **Budget conservation.** `D + R = B` exactly; `D ≤ B` always.
- **One price per coin**, independent of when a publisher joined or who they are.
- **Never above the pool split.** `c* ≤ B/M`.
- **Thin markets heal.** Price settles at the saturation point and the unspent budget is refunded.
- **Advertiser cannot steer the price.** `c_e` is a warmup prior, ignored once the curve exists.
  Measured elasticity of the settled price to a 20x misquote is under 0.15.
- **Nothing to fake.** Only minting is observed, so moving the price requires delivering real
  impressions. Payouts are linear in coins at a uniform price, so Sybil identities gain nothing.
- **Timing-immune.** The price is fixed for the campaign; bursts, trickles and join order
  cannot move it. Only delivered volume matters.

All enforced by `test_platform.py`.

## Results

200 campaigns per market, post-warmup medians. "Floor" is the campaign-to-campaign spread of the
true price: no mechanism can beat it, since which publishers arrive is not predictable. "Truth"
is the full-information competitive price computed from the publishers' hidden reservation prices.

| Market | Truth | Posted | Error | Pool-split error | Refund | Floor |
|---|---:|---:|---:|---:|---:|---:|
| thin | 5.06 | 5.43 | **17.3%** | 107% | 45% | 16% |
| balanced | 2.23 | 2.05 | **8.9%** | 11% | 0% | 6% |
| abundant | 0.99 | 0.90 | **9.9%** | 14% | 0% | 3% |
| early burst | 1.94 | 1.76 | **10.2%** | 16% | 0% | 5% |
| late burst | 2.89 | 2.67 | **6.7%** | 6% | 0% | 10% |
| advertiser lowballs | 3.12 | 2.78 | **11.0%** | 12% | 0% | 10% |
| advertiser highballs | 2.79 | 2.59 | **7.5%** | 7% | 0% | 12% |
| thin + highball | 5.06 | 6.32 | **28.4%** | 102% | 37% | 16% |
| thin + lowball | 5.05 | 5.03 | **28.1%** | 117% | 49% | 16% |

Every market sits at or near its floor, except a thin market opened with a misquoted prior, where
warmup contamination costs about 11 extra points and decays as campaigns accumulate.

## Limits

- **Exploration costs money.** A warmup period plus ~10% of campaigns priced off-target is the
  cost of learning a curve nobody can observe directly.
- **Not strategy-proof.** Publishers who hold out for a markup gain, since a uniform price with
  free entry invites demand reduction.
- **Ex-post individual rationality is impossible here.** Uniform pricing, budget feasibility and
  unrestricted entry cannot all hold: if enough publishers join, `c* = B/M` falls below what some
  of them required. Avoiding it needs admission caps or per-publisher prices, both excluded by design.
- **The curve assumes a stable publisher population.** A structural shift in supply is only
  tracked as new campaigns accumulate.

## Code

| File | Role |
|---|---|
| `platform.py` | the mechanism: supply curve, pricing, settlement |
| `test_platform.py` | invariants and the manipulation test |
| `market.py` | publisher agents, campaign loop, full-information benchmark |
| `simulate.py` | market scenarios |
| `MECHANISM.md` | full derivation, rejected alternatives, formal audit |
| `server/` | Node service: `mechanism.js` (ports the above), `store.js`, `index.js` (HTTP API) |
| `public/index.html` | test page: create a campaign, join, mint, settle, watch the curve |
| `sim/simulate.js` | Node simulator behind `npm run simulate` and `POST /api/simulate` |
| `test/mechanism.test.js` | Node tests (`npm test`) |
