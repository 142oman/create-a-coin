# True-Value Finder for a Fixed-Pool CPI Campaign

There are two pools. The **cash pool** `B` is fixed by the advertiser. The **coin pool** is filled by
publishers, at one coin per verified impression. Every coin settles at a single value, and that value
is known only after the campaign resolves. The advertiser supplies `B` and a wanted CPI `c_e`. The
wanted CPI is only the opening quote. The market decides the price.

Code: `tvf.py` (engine), `market.py` (publishers, campaign loop, benchmark), `simulate.py`
(Monte Carlo), `test_tvf.py` (invariants).

---

## 1. What the engine can and cannot see

The engine **never sees a publisher's private price**. It sees only behaviour that a platform
actually observes:

| Signal | Meaning |
|---|---|
| instant join | a publisher took the quote the moment they arrived |
| decline | a new arrival looked at the quote and did not join |
| holdout | a publisher who declined and is still watching |
| holdout join | a holdout accepted a higher quote, which reveals their price |
| committed coins | coins minted so far plus coins live publishers will still mint |

## 2. How the live quote moves

The quote starts at `c_e`. Each hour it moves one step, in exactly one of these situations:

1. **Budget pressure (down).** The committed coins plus the forecast coins exceed what `B` buys at
   the quote.
2. **Holdout pull (up).** Holdouts are waiting and the budget can afford more supply. Only real,
   present supply can pull the price up.
3. **Generosity probe (down).** Publishers take the quote on arrival and nobody holds out, which means
   the quote is above the top of the supply curve.
4. **Otherwise it holds.** An empty market never moves the price.

The step size adapts. It grows while pressure keeps pointing the same way, halves when the direction
reverses, and halves again whenever a holdout accepts, so the price is resolved finely at the point
where supply responds.

## 3. Forecasting supply that hasn't arrived yet

Publishers and the engine both account for dilution from supply that has not arrived yet. The forecast
uses a persistence rule: a join flow observed for `h` hours is expected to last about `h` more hours.
This keeps a short burst from being extrapolated into a flood for the rest of the campaign, which would
crash the quote and drive away the publishers who are actually there.

```
flow     = production rate added per hour so far
horizon  = min(elapsed, remaining)
forecast = flow · (horizon·remaining − horizon²/2)
publisher's expected coin value = min(quote, B / (committed + forecast + own coins))
```

## 4. Justified price and settlement

A price is **justified** only when a holdout accepts it. At that moment a publisher who refused a lower
price proved that this price was needed. Probing that nobody answers never counts. That is the
self-healing: slippage away from `c_e` survives only if real liquidity demanded it.

```
J  = highest quote at which a holdout accepted
     (if no holdout ever accepted: the lowest quote anyone accepted)
c* = min(J, B / M)          one price for every coin
D  = c* · M                 paid to publishers
R  = B − D                  refunded to the advertiser
```

- **Thin liquidity:** `c* = J`, which is what the scarce supply actually required. The rest is refunded.
- **Abundance:** `c* = B/M`, meaning the pool is fully spent across the coins.

## 5. Results

The test: 200 random campaigns per scenario, with `B = $100,000` and a 240-hour window. Each publisher
has a hidden private price. "Truth" is the full-information competitive price: buy supply
cheapest-first until the budget runs out, and pay everyone the marginal price. This benchmark knows
every private price and ignores stickiness, so no online mechanism can match it exactly. Each cell is
a median.

| Scenario | Truth | Wanted CPI | Pool split B/M | **Finder** | Error: wanted | Error: split | **Error: finder** | Refund |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| thin liquidity | 4.25 | 2.00 | 11.71 | **4.28** | 53% | 177% | **2.6%** | 64% |
| balanced | 2.26 | 2.00 | 2.11 | **2.11** | 11% | 6% | **6.0%** | 0% |
| abundant | 0.99 | 2.00 | 0.93 | **0.92** | 101% | 7% | **6.8%** | 0% |
| early burst | 1.96 | 2.00 | 2.17 | **2.11** | 3% | 11% | **8.3%** | 1% |
| late burst | 2.95 | 2.00 | 3.03 | **2.98** | 32% | 5% | **4.2%** | 0% |
| advertiser lowballs | 3.12 | 0.50 | 3.09 | **3.08** | 84% | 3% | **3.3%** | 0% |
| advertiser highballs | 2.78 | 8.00 | 2.68 | **2.63** | 187% | 3% | **4.3%** | 0% |
| thin + highball | 4.25 | 8.00 | 11.50 | **4.15** | 88% | 168% | **2.9%** | 64% |

- The finder is the only rule that stays within about 8% of the true price in every scenario.
- A fixed wanted CPI fails whenever the advertiser's number is wrong.
- Splitting the pool fails whenever liquidity is thin.
- Whatever the advertiser declares, the finder converges on the market's price. It rises from a
  lowball and falls from a highball.

## 6. Guarantees (enforced by `test_tvf.py`)

- **Exact conservation:** `D + R = B`, with no overdraw.
- **One price for every coin**, regardless of join time or publisher.
- **Recruited supply is paid its price:** every publisher who joined because the price rose receives
  at least their private price, unless the budget itself is exhausted.
- **Thin liquidity heals:** the settled price is below the pool split, and the difference is refunded.
- **No supply means a full refund.**

## 7. Known limits

- **Stickiness has a cost.** Online, publishers join in arrival order and cannot be removed, so an
  early expensive publisher can end up in the pool when the benchmark would have bought a cheaper late
  one instead. This is most of the remaining 4–8% gap.
- **Internal step sizes are a speed/resolution trade-off.** They are not advertiser inputs. If steps
  are too slow (1%), a lowball quote climbs slower than holdouts' patience lasts (21% error). If they
  are too fast (5–15%), the first accepted price overshoots by up to one step. The defaults
  (2%, adapting between 0.2% and 5%) are the robust middle.
- **Holdouts must be visible.** The engine assumes the platform can see publishers who viewed the
  campaign and did not join.
- **Publishers can gain by shading.** Strategic holdouts are modelled in section 10: demanding a
  markup over one's true price pays, so the mechanism is not strategy-proof.

## Running

```
python simulate.py [seeds]      # scenario table (default 200 seeds)
python -m unittest -v test_tvf  # invariants
```

---

# Mathematical properties

## 8. What the mechanism is, formally

**Solution concept.** Let `S(p)` be the supply curve: the coins publishers are willing to mint at
price `p`. `S` is non-decreasing, so `p·S(p)` is non-decreasing, and the excess demand

```
z(p) = B/p − S(p)
```

is strictly decreasing wherever it is defined. It therefore has at most one root, and the campaign's
clearing price is well posed:

```
p* = min{ p : p·S(p) ≥ B }        interior: the budget binds
p* = max{ r_i }                    corner: all supply is cleared and budget is left over
```

`market.true_value` computes exactly this. Uniqueness comes from monotonicity, with no further
assumptions.

**The engine is dual ascent on the budget constraint.** The quote is the Lagrange multiplier of
`Σ payouts ≤ B`. Each hour it takes a sign step on the excess demand `z(q)`, with an adaptive step
size (a sign-based root finder of the Rprop family). On a monotone `z` this converges geometrically
to within one step of the root. This is the same object as dual-gradient budget pacing in ad auctions,
run against a supply curve instead of a demand curve.

**Settlement is the complementary-slackness pair.** With `J` the revealed marginal cost of the
supply in the pool and `M` the coins minted:

```
c* = min(J, B/M)

refund > 0   ⟺   budget slack     ⟺   c* = J     (price set by supply's marginal cost)
refund = 0   ⟺   budget binds     ⟺   c* = B/M   (price set by the pool)
```

These are the two KKT branches of the same program, not two rules bolted together.

**`J` is an order statistic.** A holdout accepting at `q` reveals `r_i ∈ (q_prev, q]`. `J` is the
running maximum of those acceptances, which is the empirical right endpoint of the supply
distribution, with a bias of at most one step size.

**The classical name.** An ascending-clock uniform-price procurement auction, cleared against a fixed
budget, with pari-mutuel pro-rata claims (coins) as the settlement instrument, run online with a
certainty-equivalent forecast of unarrived supply.

## 9. Property audit

| Property | Status | Basis |
|---|---|---|
| Budget feasibility (`Σ payouts ≤ B`) | **Holds** | `c* = min(J, B/M) ⇒ c*·M ≤ B`; tested |
| Uniform, anonymous pricing | **Holds** | one `c*` for all coins; tested |
| Envy-freeness among accepted publishers | **Holds** | identical price, identical coin |
| Existence and uniqueness of `p*` | **Holds** | monotone `p·S(p)`, strictly decreasing `z` |
| Convergence of the quote to `p*` | **Holds** quasi-statically | sign-based root finding on monotone `z`; error ≤ one step |
| Individual rationality for recruited holdouts, budget slack | **Holds** | accepted at `q ≥ r`, `J = max q`, `c* = J`; tested |
| **Ex-post individual rationality in general** | **Fails** | 14–18% of publishers paid below their own price in the balanced and abundant cases (21–28% of coins) |
| **Strategy-proofness** | **Fails** | a 50% markup raises profit per coin by 79% in the balanced case |
| Allocative efficiency | **Fails** | sticky entry prevents cheapest-first procurement; 4–8% price gap |
| Regret bound versus the offline optimum | **Unproven** | forecast is a heuristic, not a Bayes rule; no guarantee under bursts |

## 10. Why ex-post IR cannot be fixed inside these constraints

**Claim.** No mechanism simultaneously satisfies: (1) one uniform price for every coin, (2) budget
feasibility, (3) unrestricted entry, (4) irrevocable entry, and (5) ex-post individual rationality for
every participant, when future arrivals are unknown.

**Proof.** Take publishers who all have reservation `r`. Ex-post IR requires `c* ≥ r`, so total
payouts are `c*·M ≥ r·M`. Budget feasibility requires `c*·M ≤ B`. Together these force `M ≤ B/r`. But
under unrestricted entry `M` is set by arrivals, not by the mechanism, so realizations with `M > B/r`
exist. On those, (2) and (5) are contradictory. Any mechanism must therefore cap entry, violating (3),
price-discriminate, violating (1), or break IR. ∎

This design breaks IR. The alternatives were ruled out by the design constraints: capping entry is
admission control, and per-publisher guarantees are price discrimination.

**Corollary (why it is not strategy-proof).** Because a publisher can be diluted below their own
price, refusing to join until the quote clears a margin is profitable. This is the demand-reduction
incentive of uniform-price auctions (Ausubel and Cramton). Measured over 150 campaigns with 20% of
publishers demanding a markup:

| Scenario | Markup | Strategic profit/coin | Truthful profit/coin | Settled price |
|---|---:|---:|---:|---:|
| balanced | 0% | 0.312 | 0.274 | 2.10 |
| balanced | 25% | 0.502 | 0.329 | 2.17 |
| balanced | 50% | 0.637 | 0.356 | 2.22 |
| thin liquidity | 0% | 1.188 | 1.198 | 4.28 |
| thin liquidity | 50% | 2.141 | 2.133 | 5.16 |

In the balanced case the markup pays privately, mostly by dodging dilution below cost. In the thin
case there is no private edge, because the settled price is the revealed marginal cost and rises for
everyone: no individual gain, but a collective one, which is a collusion incentive rather than a
unilateral one. Both raise the advertiser's price.

## 11. What would restore the missing properties

- **Ex-post IR:** ration admission once `q·committed ≥ B`, which is admission control, or guarantee
  each publisher their join-time quote, which is price discrimination.
- **Strategy-proofness:** pay-as-bid settlement, or a Vickrey-style payment rule, both of which give up
  the single uniform price.
- **Regret bound:** replace the persistence forecast with a Bayesian or UCB estimator of arrivals,
  which buys `O(√T)` regret under stationary arrivals but nothing under bursts.

## 12. Geometric reconciliation, Nash bargaining, and which mechanism wins

### The Nash connection is real, and it is an assumption, not a derivation

The geometric kernel `c* = √(c_e · B/M)` **is** the Nash bargaining solution — under log utilities.
Maximising the Nash product with `u_A = ln(c_e/p)` and `u_P = ln(p/r)` gives
`ln p* = (ln c_e + ln r)/2`, so `p* = √(c_e·r)`. Verified numerically: for (2.5, 12.5) the Nash product
under log utilities peaks at 5.5902, exactly the geometric mean.

But with utilities linear in money, `u_A = (c_e − p)M` and `u_P = (p − r)M`, the same Nash axioms give
the **arithmetic** mean: 7.5000 for the same pair, also verified. Nash's axioms are invariant to affine
rescaling of utility, not to the choice of utility representation. So the mean is picked by the utility
model you assume. The earlier "neutrality under quoting convention" argument was that assumption in
disguise: demanding symmetry in log space is demanding log utility.

### The deeper objection: bargaining is the wrong solution concept here

Nash bargaining is bilateral. It splits a known surplus between two parties with fixed claim points,
and it presumes both claim points are meaningful. Here they are not: `c_e` is an unverified advertiser
declaration, and `B/M` is an accounting artifact of pool over volume, not anyone's valuation. Applying
bargaining axioms to a declared number makes the result inherit that number's manipulability.

With many publishers the correct concept is competitive equilibrium, which is what the clock finds; the
core of a replicated market converges to it (Debreu–Scarf). Bargaining is correct precisely in the
bilateral-monopoly corner, where one publisher faces one advertiser, no competitive price exists, and
all that remains is splitting the range between cost and value.

### Head to head, same agents, same forecast, 200 campaigns per scenario

| Scenario | Truth | Geometric | Finder | Geo error | Finder error |
|---|---:|---:|---:|---:|---:|
| thin liquidity | 4.25 | 4.50 | **4.28** | 12% | **2.6%** |
| balanced | 2.26 | 2.08 | **2.11** | 8% | **6.0%** |
| abundant | 0.99 | 0.92 | 0.92 | 7% | 6.8% |
| early burst | 1.96 | **2.05** | 2.11 | **4%** | 8.3% |
| late burst | 2.95 | 2.43 | **2.98** | 18% | **4.2%** |
| advertiser lowballs | 3.12 | 1.99 | **3.08** | 36% | **3.3%** |
| advertiser highballs | 2.78 | 2.63 | 2.63 | 5% | 4.3% |
| thin + highball | 4.25 | 8.93 | **4.15** | 109% | **2.9%** |

### The decisive test: can the advertiser move the price by misreporting?

Median settled price as the declared CPI is scaled from a quarter to four times its base:

| Scenario | Mechanism | 0.25x | 0.5x | 1x | 2x | 4x | Elasticity |
|---|---|---:|---:|---:|---:|---:|---:|
| thin liquidity | geometric | 2.95 | 3.44 | 4.52 | 6.35 | 8.99 | **0.40** |
| thin liquidity | finder | 4.20 | 4.20 | 4.30 | 4.29 | 4.22 | **0.00** |
| balanced | geometric | 1.58 | 1.78 | 2.08 | 2.09 | 2.09 | **0.10** |
| balanced | finder | 2.16 | 2.13 | 2.11 | 2.10 | 2.10 | **−0.01** |

The geometric kernel lets the advertiser triple the settled price by declaration alone. The finder does
not move. This is the anti-squeeze requirement, and only one mechanism passes it.

### Sybil holdouts do not work

Fake watchers who never join, added to inflate the quote, were tested at 10 and 50 phantoms:

| Scenario | Phantoms | Settled price | Change |
|---|---:|---:|---:|
| thin liquidity | 0 | 4.30 | — |
| thin liquidity | 10 | 3.92 | −9% |
| thin liquidity | 50 | 3.92 | −9% |

The attack backfires. A higher quote recruits real supply sooner, which mints more coins and dilutes
the price. Only a real acceptance moves the justified price, so manufacturing interest cannot fake one.

### Verdict

Use the finder. It is more accurate in six of eight scenarios, decisively so in the thin and
misreported-quote cases that motivated the design, and it is the only one immune to advertiser
misreporting. The geometric kernel keeps real advantages — closed form, no state, no visibility
requirement, timing-immune, trivially auditable — and it is the principled fallback for the case where
no marginal cost is ever revealed, which is the bilateral-monopoly corner where bargaining, not
competition, is the right concept. That fallback fired in 0% of the simulated scenarios, but it is
where the current arbitrary rule ("lowest accepted quote") should be replaced by the Nash split.

Comparison code: `compare.py`.

## 13. What the engine actually observes, and what happens without it

### The signal in question

The finder in sections 1–7 uses a **holdout**: a publisher who looked at the quote and did not join.
That is a presence signal, not a minting action. If the only thing the system records is whether a
publisher contributes impressions or not, holdouts do not exist, and the Sybil test in section 12 was
testing a signal the design does not have.

### Why the signal matters: an identification problem

Zero coins is ambiguous. It means either "the price is too low" or "no publisher is out there", and
minting data alone cannot separate them. The price can only be justified upward by seeing supply that
was withheld at a lower price and released at a higher one. Without a presence signal, that event is
invisible, and the engine must fall back on statistics: raise the price, then test whether the *join
flow* increased. That works when there are enough join events to measure, and fails when there are not.

### Measured cost of removing the signal

`mintonly.py` implements the same mechanism with minting as the only observable: probe the quote
upward, compare join flow before and after, revert the probe when flow does not respond.

| Scenario | Truth | Holdout engine | Mint-only | Holdout error | Mint-only error | Campaigns that got any supply |
|---|---:|---:|---:|---:|---:|---:|
| thin liquidity | 4.25 | 4.28 | 2.04 | **2.6%** | 52.2% | 100% vs **31%** |
| balanced | 2.26 | 2.11 | 2.16 | 6.0% | **2.5%** | 100% vs 100% |
| abundant | 0.99 | 0.92 | 0.95 | 6.8% | **5.4%** | 100% vs 100% |
| early burst | 1.96 | 2.11 | 2.04 | 8.3% | **4.5%** | 100% vs 100% |
| late burst | 2.95 | 2.98 | 2.21 | **4.2%** | 25.3% | 100% vs 100% |
| advertiser lowballs | 3.12 | 3.08 | never | **3.3%** | — | 100% vs **0%** |
| advertiser highballs | 2.78 | 2.63 | 2.65 | 4.3% | **3.9%** | 100% vs 100% |
| thin + highball | 4.25 | 4.15 | 8.32 | **2.9%** | 93.5% | 100% vs 100% |

Reading this:

- **In thick markets, mint-only is better.** Enough join events accumulate for the flow test to work,
  and it avoids the holdout engine's over-reaction. Balanced 2.5% vs 6.0%.
- **In thin markets it collapses.** It underpays publishers by half (2.04 against a true 4.25), and in
  69% of thin campaigns no supply ever joins at all.
- **Under a lowball quote it never starts.** 0% of campaigns got supply. Nothing tells the engine that
  publishers are waiting above the quote, so the quote never climbs to meet them.
- **Thin plus a highball quote overpays by 94%.** Everyone joins instantly, no decline is ever
  observed, and random arrivals during an upward probe look like a price response.

### The trade-off this forces

To price a thin market you need one of:

1. **A presence signal** (publishers register interest without committing). Fakeable in principle, but
   section 12 shows phantom presence backfires, because only a real acceptance moves the justified
   price and a higher quote recruits real supply that dilutes the pool.
2. **Publisher asks** (a stated minimum CPI). Rejected as a design constraint.
3. **A conservative bound with mint-only data**, accepting a systematic ~50% underpayment to publishers
   in thin markets and campaigns that often fail to start.
4. **A hybrid:** mint-only flow control while join events are plentiful, presence signal only when the
   market is thin. This takes the better half of each column above.

In the mint-only design the Sybil question dissolves: the only way to move the price is to mint, and
minting means actually delivering impressions, which costs real work and dilutes the pool.

## 14. Mint-only, final design: discovery moves to the platform

There is no presence signal. Minting is the only observable. Sections 1–7 are therefore
superseded: that engine needed holdouts.

### Why a single campaign cannot price itself

Four control laws and four settlement rules were tried on single-campaign mint-only data
(flow-response probes, budget tâtonnement, hunt-and-revert, arrival-clocked stepping;
settled at max accepted quote, final quote, tail median, minting-weighted average). All of
them work in thick markets and all fail in thin ones, in the 25–150% error range, and some
never start at all. The reason is countable rather than fixable: a thin campaign produces
roughly 15 join events, declines are invisible, and no estimator recovers a price from that.

### The market is the platform, not the campaign

Each campaign posts one price and reports the coins it minted. Pooled across campaigns,
those `(price, coins)` pairs are the supply curve, which is the only object needed to price
the next campaign. A thin campaign is then priced from thousands of pooled events instead of
fifteen.

```
supply curve   ĝ(p)      kernel-smoothed coins delivered at posted price p, pooled
exhaust        p_x        cheapest p with p·ĝ(p) ≥ B        (budget would be spent)
saturate       p_s        cheapest p with ĝ(p) ≥ 0.95·max ĝ (buys all available supply)
posted price   p = min(p_x, p_s)
settlement     c* = min(p, B/M),   D = c*·M,   R = B − D
```

`min(p_x, p_s)` is the whole healing mechanism. Paying past the saturation point buys no
extra supply, so a thin market is never charged the pool split. Rule order matters: checking
`p_x` first reproduces the pool-split absurdity, which is what it did before this was fixed.

### Results, 200 campaigns per market, post-warmup

"Floor" is the campaign-to-campaign spread of the true price: no mechanism can beat it,
because which publishers show up is not predictable.

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

Every market is at or near its floor except thin markets with a misquoted prior, where
warmup contamination costs roughly another 11 points and decays as campaigns accumulate.

### Properties

- **Nothing but minting is observed.** Moving the price requires delivering real impressions,
  so there is no presence signal to fake and Sybil identities gain nothing (payouts are linear
  in coins at a uniform price).
- **The advertiser's wanted CPI is a warmup prior only.** Once the curve exists it is ignored
  entirely, and exploration is symmetric and wide rather than anchored on the quote. Measured
  elasticity of the settled price to a 20x misquote is under 0.15, against 0.40 for the
  geometric kernel.
- **Budget conservation, one price per coin, and price ≤ pool split** hold exactly and are tested.
- **Timing-immune.** The posted price is fixed for the campaign, so bursts, trickles and join
  order cannot move it. Only delivered volume matters.
- **Exploration has a cost.** Roughly 10% of campaigns are priced exploratively, plus a warmup
  period, which is the price of learning a curve nobody can observe directly.

Code: `platform.py`, tests in `test_platform.py`.
