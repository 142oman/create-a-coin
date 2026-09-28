# Discussing and understanding: how the design was reached

> **Current design: Part 12 onwards** (the project is now called **Creator Coin**). Parts 1–11 record how we got
> there and are kept as history; where they conflict with Part 12+, Part 12+ wins.

A record of every question raised while designing this, what we decided, and why. **Part 6 (at the end) replaces the pricing design in Parts 2–5**: no cap, no minimum, no simulation, a Creator Pool settled at campaign end. It includes the
places where an earlier answer was wrong and was corrected. Use it to walk through the reasoning in
the interview.

---

## Part 1. Where we started

### 1.1 What we had built first
A **cost-per-impression price-discovery market**:
- Advertisers fund a pool; publishers "mint" one coin per impression.
- Every coin settles at one price, learned from a supply curve across campaigns.
- Whatever the market can't absorb is refunded.

It was careful work (budget conservation, manipulation tests, a comparison against a Nash-bargaining
"handshake") but it answered **"what should a view cost?"**, not the brief's question.

### 1.2 The mismatch with the brief
- **The brief asks for** *"a milestone ladder — a set of (view threshold, payout) pairs"*.
- **Ours paid linearly** (coins × price) and said *"money is never gamified"*. Its "ladder" was a
  motivation widget of 6-hour delivery targets, with no money attached.
- **None of the brief's data model existed:** no followers, posts, view curves, fraud labels or
  backtest.

### 1.3 The original intent, mapped to the brief's terms

| Our term | Brief's term |
|---|---|
| Coin (1 minted = 1 verified view) | View |
| Settled CPI | Payout per view (× 1000 = effective CPM) |
| Personal dynamic ladder | Tiering, taken to the extreme |
| Settlement + refund | Budget adherence |
| Brand's expected CPI | Brand's ROI reference |
| "Don't pay for an unreached rung" | Milestones |

**Conclusion:** partly a naming gap, partly real gaps (data, view model, fairness, fraud, backtest,
one-pager).

### 1.4 Two conceptual corrections early on
- **Posts don't "deliver" views in 6-hour steps.** A creator posts once and the algorithm distributes
  it over days (24h → 7d → 30d). The creator's real levers are posting more and staying in the
  campaign.
- **"Motivate creators to boost their posts" conflicts with the brief**, which lists *"paid promotion
  to hit a threshold"* as gaming to resist. So the ladder should motivate more genuine posts, not
  boosting.

---

## Part 2. Decisions, in the order we made them

### D1. Can we drop the ladder?
**No.** The brief requires it in three places:
- §2: *"outputs a milestone ladder"*
- §4B: *"output a milestone ladder (view thresholds + payouts)"*
- §4C: *"compare the ladder your method proposes against the ladder that was actually used"*

What we're free to choose is how it's built.

### D2. Is a ladder per post or per creator?
**Per post.** The brief: *"a creator's post unlocks a cash reward each time it crosses a threshold"*,
and `posts.total_payout_earned`.
- **Risk:** grinding many cheap posts that each clear rung 1.
- **Mitigation:** rung 1 at the median (half of posts earn nothing); the fraud check.

### D3. Pay only for cleared rungs, or for every view?
**Only up to the last cleared rung** (141 pays for 140). That is what a milestone is. Paying every
view would be a per-view rate with a UI on top.

### D4. Fairness: "if someone can reach 140, pay 140 whether their ladder said 140 or 150"
- **Rounding down:** yes.
- **But moving a rung to wherever the post landed** would be linear pay in disguise. Rungs must be
  fixed before the views come in.
- **Resolution:** same views in the same tier and format → same money, always.

### D5. A personal "next goal" on a shared ladder?
**Dropped.** As you put it, a personal goal without a personal ladder is just UI. The brief itself
offers the middle ground: *"decide whether and how milestones should be tiered or normalized"*. So:
**one ladder per creator tier**.
- **Reachable for everyone:** each tier's rungs sit where its own posts land.
- **Fair in money:** every tier gets the same ₹ per view; only the thresholds differ.
- **Cold start for free:** a new creator is placed by follower count.
- **Rejected: a fully personal ladder per creator.** Not defensible on fairness, and it can be gamed
  by deliberately weak early posts to get easier rungs later.

### D6. How are tiers defined, and do we move creators between them?
- **Definition:** the brief defines tiers by followers (nano < 10K, micro 10K–100K, mid 100K–1M,
  macro 1M+), and `creators.tier` is in the data.
- **Moving creators:** the brief doesn't ask for it, so **we take the given tier as true**. We
  discussed moving a creator one tier when their view history doesn't match (it would help against
  bought followers) and left it as a possible extension.

### D7. How are categories (gaming, finance…) handled?
Category affects two different things:
- **Where rungs sit (views):** learned per category from past posts. Gaming content travels further
  than finance, so a gaming micro ladder sits higher.
- **What a view is worth (₹):** the brand's own maximum, entered at creation. A finance brand values a
  viewer more and enters more.

The lowball check compares a brand only with past campaigns in **its own category**.

### D8. How far apart are rungs? (the longest discussion)
1. **First suggestion, a fixed multiplier (1.5–2×):** you asked "why 1.5 and not 1.2 or 1.3?" There
   was no answer, so it was **rejected**.
2. **Second, reach chances 65% / 50% / 3%:** three separate made-up numbers, **rejected**.
3. **Final, one number, the step chance = 50%.** Each rung is reached by half of the posts that
   reached the previous one, and rung 1 is the tier's median post.
   - **Why reach-based at all:** it gives every tier the same odds, which is the fairness requirement.
   - **Why 50%:** the brief names two opposite failures, *"so large that creators give up"* and
     *"so small that the ladder is trivially climbed and cheap to grind"*. We have no data on how
     creators react to missing a rung, so 50% is the neutral point.
   - **It's tested:** the backtest compares 40%, 50% and 60%.
   - **Answer to "why 250K?":** *1 in 8 posts in this group reach it, and half of those reaching the
     rung below also reach this one.*

### D9. How many rungs? Is 4 fixed?
**Not fixed.** The brief's 4-rung example is today's manual ladder, not a requirement.
- **Rule:** keep adding rungs while at least one post in this campaign is expected to reach the next.
- Campaign size therefore decides the count; typically 5–6.
- (See B2 for a floor added while building.)

### D10. Should ₹ per view fall at higher rungs?
- We first agreed to a slight drop (to make viral posts cheaper), then asked "why 10%?" and "why half
  rate at the top?". **Both were arbitrary, so we reversed.**
- **Final: a flat rate at every rung.** Paid media charges the same per 1,000 views whichever post
  delivers them, so the brief's ROI criterion argues for flat.
- **Viral risk is handled by the top rung:** views beyond it aren't paid.

### D11. What does P95 mean?
The brief: *"within the brand's budget with a defined confidence level, not just in expectation"*.
- **P95:** in 95% of simulated outcomes, total payout stays within budget.
- **95% is our choice;** the brief asks us to state one.

### D12. Is the brand's CPI a hard maximum? Does the brief demand it?
- **The brief doesn't demand it.** It asks that pay per view *"make sense relative to… paid media
  CPM"*.
- A hard ceiling at the brand's number is **our** way of meeting that.
- **Tension with the old design:** the old code deliberately ignored the brand's number so a brand
  couldn't lowball. With a ceiling, lowballing just means fewer creators join, hence D13.

### D13. How do we stop a brand lowballing? Meta and Google CPM data?
- **Old code:** it ignored the brand's number and priced from a learned curve (measured sensitivity
  to a 20× misquote: under 0.15).
- **New: compare the brand's maximum with what creators in the same category were actually paid:**
  - below every past campaign → **block**
  - below the median → **warn**
  - otherwise OK
- **No live Meta or Google data.** Their APIs show an advertiser's own costs, not market prices, and
  hand-typed benchmarks would be unsourced. You decided: *"we will handle max and min here itself."*
  (We briefly considered a `brand_paid_cpm` field; dropped for that reason.)

### D14. How can a minimum be "guaranteed" if a viral creator can join?
You were right that no forecast is 100%. So the guarantee rests on a **rule**, not the forecast:
1. **Pay once, at the end.** No money moves during the campaign.
2. **Running tally:** keep a daily tally of guaranteed minimum × each post's projected cleared views.
3. **Early close:** when the tally reaches the budget, stop accepting new posts.
4. **Top rung:** limits any single post's claim.

- **What the forecast decides:** only how high the minimum can safely be. Set from the P95 forecast,
  about 5% of campaigns should fill up early.
- **Precise statement:** promises already made are always paid. The budget can be exceeded only if
  posts *already accepted* grow far past their projections. That happened in **0 of 23** backtest
  campaigns.
- **Correction:** I first said "early closing is what we're doing now". It wasn't; the old code only
  diluted the price. It is implemented now.
- **Clarification:** early close protects the **budget**. Underpaying creators is handled by the
  **minimum**, overpaying by the **ceiling**. Three different tools.

### D15. The "handshake": what the old code did, what we kept
- **What the old code actually did:**
  - posted price from the learned curve
  - final price = min(posted, budget ÷ coins)
  - refund the rest
- **The Nash-bargaining handshake,** √(brand CPI × budget ÷ coins), was tested and **rejected** in the
  old work: a brand could triple the price by misreporting.
- **Kept:** settle once with one price, capped by the pool, refund the rest. Extended with the
  guaranteed minimum:
  ```
  final rate = max(guaranteed minimum, min(brand maximum, budget ÷ cleared views))
  refund     = budget − payouts
  ```
- **Dropped:** the learned price curve. The brief's data has no price-vs-participation signal.
- **What is reserved when a rung is cleared:** the guaranteed minimum × rung views, in the tally only.
  The rest (up to the brand's maximum) arrives at settlement as a **bonus**.

### D16. Why 7 and 30 days? What about views after 30 days?
- **The checkpoints come from the brief's schema:** `views_at_24h`, `views_at_7d`, `views_at_30d`,
  `views_final`. There is no day-8 or day-29 figure, which answers "why not 8 days?".
- **Correction:** I once said *"views after 30 days aren't paid"*. That was invented, and retracted.
  **We pay on `views_final`.**
- **Settlement date** = campaign end + 30 days, so every post gets at least the brief's last
  checkpoint. Longer campaigns simply settle later.
- 24h, 7d and 30d are used only for the running tally and the fraud check.

### D17. What is a "similar campaign"? What's the fallback?
- **Similar posts:** same category, platform, tier and format (the brief's own fields).
- **Fallback:** if fewer than 30 clean posts, widen one factor at a time; tier is kept longest.
  **30** is the usual rule of thumb for a stable median and spread; stated as a convention.
- **Every ladder records which group it used,** so thin forecasts are visible.
- This is also the **cold-start** answer.

### D18. Format
**One ladder per tier × format** (micro reel and micro carousel are different ladders). The brief
names ignoring format as a failure of today's ladders.

### D19. Fraud
- **The label:** the brief says `flagged_suspicious` is *"already labeled for you"*. Since we generate
  the data, we generate the label (noisy), **and** build our own detector, **and** score both against
  the hidden truth.
- **Policy:** payout is held until the growth check runs, not at a fixed 30 days. If still suspicious,
  it isn't paid.
- **Four layers:** growth-curve detection, payment timing, ladder design, data we'd want in
  production. See METHODOLOGY §2.4.
- **Correction:** the old report claimed *"Nothing to fake. Only minting is observed."* That is wrong
  under the brief's threat model, because bought views are real, mintable views. Removed.

### D20. Data format and size
- **Format:** JSON files written by a seeded generator (`data/*.json`), using the brief's field names.
- **Size:** you asked for smaller. The result is 40 campaigns, 400 creators, 2,820 posts. Size is about
  having enough posts per group, not speed; generation takes under a second.

### D21. The "old ladder" and the backtest
- **"Old ladder"** = the brief's `milestone_ladders` table: *"the thing you're trying to improve on"*,
  set manually by ops. §4C requires comparing against it, so the generator makes them look like gut
  feel: round numbers, the same for everyone, sometimes too generous or too stingy.
- **Backtest:** the same real posts, replayed under both.
- **Manual comparison, your suggestion:** `python -m ladder compare --campaign C035 --ladder
  my.json`, and the Compare page in the app. It scores any hand-made ladder against both.

### D22. The old code
**Moved to `archive/cpi-market/`, not deleted.** It answers a different question; reviewers grade
"not full of dead code"; the part we kept (settle and refund) is a few lines. METHODOLOGY §7 explains
this in one paragraph.

### D23. Language and wording
- **Python, standard library only**, so reviewers need no installs.
- **Wording:** the brief's terms (views, milestone, payout, CPM). "Coins" survives only in the archive.

### D24. Creator behaviour at 40 / 50 / 60%
In the write-up as an assumption, because it can't be measured:
- **40%:** fewer, bigger jumps. More give up; harder to fake.
- **50%:** neutral.
- **60%:** frequent small wins. Cheap to fake; more grinding.

*"Lacking behavioural data, we picked the neutral point. With real drop-off data, this is the first
number to tune."*

---

## Part 3. Changes made while building (and why)

These came from running the code, not from our discussion. Each is a place where the agreed design,
applied literally, produced a bad result.

**B1. The fallback drops category before format.**
- **I had said** "drop format first".
- **Measured:** format moves views more than category (spread 0.40 vs 0.28).
- **Change:** the code now measures which to drop instead of assuming. That is what "drop the least
  important factor first" actually means.

**B2. The ladder always covers 95% of posts.**
- **Problem:** the "stop when fewer than one post is expected" rule alone gave groups with about 3
  expected posts a single rung at the median. A 500K-view mid post was paid as 79K, which fails
  fairness.
- **Fix:** keep adding rungs until the top rung is reached by 5% or fewer, reusing the 95% confidence
  level rather than inventing a number.

**B3. The participation forecast keeps tier, and normalises across tiers.**
- **Problem:** widening from "same platform + tier" to "same platform" mixed nano campaigns (about
  200 creators per lakh) with macro ones (about 1.5). Forecasts were off by 10–50×.
- **Fix:** widen by dropping platform first, and normalise posts per rupee by the tier's typical post.

**B4. The running tally skips posts that already look suspicious.**
- **Problem:** one post with 4.2M bought first-day views was projected to 12.5M, filled the tally
  alone, and closed a campaign at 17% spend.
- **Fix:** the tally now applies the checks possible at each age (day one: views vs the account's
  history; from 7 days: the full front-loading check).

**B5. Recalibrated synthetic world.**
- **Problem:** in the first data, budgets were 5–10× smaller than the reach they attracted, so every
  campaign diluted to a few rupees per 1,000 views, and every status-quo ladder underspent.
- **Fix:** brand values were set to the range the brief's own example ladder implies (about ₹30–50 per
  1,000 views, finance higher), and budgets rebalanced so some campaigns overspend and some
  underspend, as the brief describes.

**B6. Drip fraud added.**
- **Problem:** the first detector caught 100% of fraud, which is unrealistically easy.
- **Fix:** 30% of boosted posts now spread bought views over the week. The detector alone then catches
  72%, which is more honest.

**B7. Lowball thresholds come from history.**
- **Before:** "block under 50% of benchmark, warn at 50–80%" was proposed.
- **Now:** block below the lowest past rate in the category, warn below its median. No invented
  percentages.

---

## Part 4. Honest trade-offs to own in the interview

- **Completion falls overall:** 62% → 57%. By tier it becomes even (nano 40→59%, macro 95→60%). We
  chose fairness and budget safety over making big creators' first rung trivially easy.
- **Creators earn less per view in oversubscribed campaigns** than the status quo paid, because the
  status quo simply overspent. The brand gets the reach within budget; creators get at least the
  guaranteed minimum.
- **Behaviour is held fixed.** The backtest measures money and reach, not how many creators would
  join or quit.
- **The model's tail is too thin.** Top rungs are reached a bit more often than advertised (4.9% vs
  3.1% at rung 5).
- **Two numbers are genuinely chosen:** the 50% step chance and 95% confidence. Everything else is
  given, measured or a named convention (30 posts; 99th/95th-percentile fraud thresholds).

---

## Part 5. Likely interview questions

**Why not just pay per view?** The brief asks for milestones, and milestones do something a per-view
rate can't: they give creators targets, which is the motivation half of the problem. Rounding down
costs about 28% of views unpaid, which the settlement partly returns via a higher rate.

**Why is rung 3 at 100K and not 80K or 120K?** Because 12.5% of posts like this reach 100K, and half
of those reaching rung 2 go on. Moving it breaks the halving.

**Why the median for rung 1?** It pays a normal post. A lower rung 1 is cheap to grind with low-effort
posts; a higher one leaves most creators with nothing.

**How do you know the model is right?** Calibration on campaigns it never saw (rung 1: 49.9%
predicted, 49.8% actual), plus recovery of the effects we hid in the data.

**What if a brand sets a silly low price?** Blocked if below every past campaign in the category,
warned if below the median.

**What if a macro creator goes viral in a small campaign?** Their post is paid up to the top rung. The
rate may dilute toward the guaranteed minimum, and the tally closes the campaign to new posts before
promises exceed the budget.

**What would you do with real data first?** Measure creator drop-off after missing a rung (to tune the
50%), add engagement signals to fraud detection, and fit a heavier tail.

**What did you get wrong along the way?** The 30-day payment cutoff (invented, retracted); the
declining rate (arbitrary, dropped); "early close is already implemented" (it wasn't); the fallback
order (measured, reversed); "nothing to fake" (false, removed).

---

## Glossary

| Term | Meaning |
|---|---|
| Rung / milestone | A view threshold with a cumulative payout |
| Step chance | Share of posts that reached one rung and go on to reach the next (50%) |
| Tier | Creator size band from the brief (nano / micro / mid / macro) |
| Group | Category × platform × tier × format: posts expected to behave alike |
| CPM | ₹ per 1,000 views |
| Brand maximum | Highest ₹ per 1,000 views the brand pays; a hard ceiling |
| Guaranteed minimum | Lowest rate creators will get; budget ÷ P95 of simulated cleared views |
| P95 | The value 95% of simulated outcomes stay under |
| Running tally | Daily sum of promised minimums; closes the campaign to new posts at the budget |
| Settlement | One payout at campaign end + 30 days; unspent budget is refunded |
| Fallback / widening | Using a broader group when the exact one has under 30 posts |

---

## Part 6. The pivot: from a capped ladder to a coin pool

Everything in Parts 2–5 describes the previous design, now in `archive/ladder-v1/`. This part records
why it was replaced and what replaced it.

### P1. No brand maximum
A cap lets the brand decide what a view is worth, and a brand can penny-pinch. **Removed.** The brand
gives a budget only; the market decides the price.

### P2. No guaranteed minimum, no Monte Carlo
A guaranteed per-post minimum rewards many cheap posts, which dissolves the price for everyone. The
3,000-run simulation behind it rested on our own assumptions, which can't hold for a ₹2K or ₹50K
campaign. **Removed.** Nothing in pricing uses a simulation now.

### P3. Why not have brands and creators type in prices?
It adds nothing. The brand's offer is its budget (real money); the creator's offer is posting (real
views). Nobody states a number, so nobody can misstate one (revealed preference). No mechanism can
make every stated valuation correct: that is the Myerson–Satterthwaite theorem.

### P4. Coins and settlement
Every validated view above the qualifier mints a coin; the budget backs all coins, so each coin is
worth less as more arrive. One price per coin at the end:
```
B/M ≤ p_ref → price = B/M                 (competitive, whole budget paid)
B/M > p_ref → price = √(B/M · p_ref)      (thin, Nash split, rest refunded)
```
`p_ref` = median pool split of past settled campaigns in the same category and platform. It is the
platform's reserve-price analogue, as Meta and Google keep for thin auctions, but used as a bargaining
reference, not a floor.

### P5. Resolve only at the end
Nobody can know the price earlier: a viral post on the last day really changes supply. Creators see a
live value ("if it ended now"); the final price is fixed at the end.

### P6. Do we need rungs?
Not for money. The pool already protects the budget, and rounding down only leaves views unpaid (46%
of views on paid posts under the status quo). The brief asks for a ladder, so each campaign keeps **one qualifying
milestone** per tier × format (the median post), to stop low-effort grinding. Above it every view
is a coin. Four display targets are shown for motivation and do not affect pay.

### P7. Tiny campaigns vs huge history
The qualifier comes from how far posts like yours travel, not from the budget, so history from ₹3
crore campaigns applies to a ₹1,000 one. The market reference is per view, so it also compares across
budget sizes.

### P8. Fraud without checkpoints
Payment is held until a post is validated. The 7-day and 30-day settlement checkpoints, the running
tally and the early close are gone; settlement happens at campaign end.

### P9. Honest trade-offs
- Creator Pool pays more per view than the status quo in the backtest (median ₹61 vs ₹35 per 1,000),
  because gut-feel ladders often paid out far less than the budget. In a live market, higher value would draw
  more creators and dilute it; a replay can't show that.
- In extreme thin cases the Nash split still pays well above market (e.g. 35× in the worked example of
  METHODOLOGY §2.3), while refunding almost all of the budget.
- Creators carry price risk: no floor.

---

## Part 7. Rungs back, a lower threshold, open choices, and a simulator

### Q1. Why no rungs? The brief asks for them.
Rungs do not protect the budget in a pool, but the brief asks for a (threshold, payout) ladder, so we
build one: **coin rungs**, placed from past posts per tier and format, paid in coins, with the coin
price settled at the end. The no-rung rule (every view past the threshold is a coin) is priced from
the same rungs, and both are shown side by side everywhere. Rounding down to a rung does not save the
brand money when plenty of views arrive; it moves money to posts that crossed a higher rung.

### Q2. The threshold was too high (median: half of posts earned nothing).
It was carried over from the capped design, where rung 1 had to make a guaranteed minimum expensive
to farm. In a pool a weak post adds few coins, so the threshold only has to exclude duds. Measured:
50% → 80% qualifying pays 27 more creators in 100 and lowers the coin value by 17%. **Now 80%.**

### Q3. What do the brand's choices do?
All are multi-select; none = any. Category and platform pick which past posts place the rungs and
which campaigns set the market reference; platform also decides which formats exist. "Target tier"
did nothing to money before, so it became **who can join**. Formats are not chosen: each gets its own
rungs. Budget only sets the coin's value.

### Q4. Show a new campaign playing out.
`ladder/simulate.py`: one seed drives every draw (same seed, same campaign). Scenarios: normal, too
many join, too few join, viral on the last day, fraud wave, only small or only big creators. It shows
the live coin value by day under both rules, the settlement, where the budget went, every creator's
payout, and a creator view that follows one creator. It is a sandbox: pricing never reads it, which
keeps the rule that real pricing cannot rest on our assumptions.

### Q5. "Please enter a valid value" on the budget.
That was the browser enforcing `step="100"`. The budget now accepts any whole rupee amount.

### Q6. The Compare page.
Exactly three systems on the same real posts: the status quo (editable), our coin rungs, no rungs.

---

## Part 8. Making the simulation and the rungs readable

- **Why coin rungs and no rungs mint different coin counts.** Rungs round each post down to the rung
  it reached (26K views on a 20K rung mints 20K); no rungs counts every view. Same budget, fewer
  coins, so each rung coin is worth more. Each simulation run now explains this with one of its own posts.
- **Playback.** Runs auto-play day by day with pause, speed and a scrubber, on both pages: creators
  join, the coin-value line draws, rung tracks fill, the budget bar and payout tables update.
- **Categories belong to creators now.** A campaign open to several categories gets separate rungs per
  category; each simulated creator makes content in one of them and qualifies against its rungs.
  Results are shown per tier × category.
- **How each tier's rungs were calculated** is shown per category and format: posts used, whether the
  group was widened, the typical post, spread, and the formula for every rung.
- **Scenario and seed can be changed on the creator page** and stay in sync with the brand page.
- **"No cap · no floor"** was jargon; replaced by a sentence saying what it means.
- **Scenarios are counted in views, not creators**, so the number of creators varies widely by seed.

---

## Part 9. Formats on the form, and a form that updates live

- **Format is now a choice** (reel, carousel, short, long-form), filtered by the platforms picked. Rungs
  are built only for the chosen formats, and simulated creators only post in them.
- **Stories, static posts and community posts were considered and left out:** the history has no
  views for them, so their rungs would be invented rather than learned. Stories expire in 24 hours and
  community posts show no public view count, so "a view" would first need defining for them.
- **The page updates as you choose.** Every chip, the budget and the dates refresh the campaign after
  a short pause, with no Create button. The simulation re-runs with the same seed and scenario and
  shows the settled result; pressing Run plays it day by day.

---

## Part 10. Held posts need a deadline

- **The problem:** a held post's coins are left out of the coin price. If everyone else were paid at
  campaign end and the post was cleared later, the price would change after the money had gone.
- **Decision:** settlement waits up to **7 days** after the campaign ends when any post is held, and
  nobody is paid before then. Valid: counted at the same price. Fraud: never paid. A post not cleared
  by the deadline counts as fraud, because the flagged creator must show the views are real.
- **UI:** the simulation lists every held post with Valid / Fraud buttons. Changing one
  re-prices the coin and shows what it did to creators with nothing held and to the refund. The
  creator page has the same buttons on the creator's held posts.
- **Flag thresholds, stated:** over 70% of week-one views arrive in 24h, or over 62% plus more than
  2.5× the creator's usual views. Views alone never flag a post.
- **Tiers** stay fixed within a campaign (followers at joining); a creator who grows is re-tiered on
  their next campaign. **Categories** belong to posts, not creators.

---

## Part 11. Naming and layout

- **Review has two outcomes only:** valid or fraud. A post not cleared within the 7 days counts as
  fraud. The buttons appear on the brand page's review list and on the creator page.
- **The project is called Creator Pool** (was "Coin Market"): creators share one pool, coin by coin.
- **The brief's objectives** checklist moved to the bottom of the brand page, collapsed by default.

---

## Part 12. Test data generated at run time (design interview, in progress)

Prompted by review feedback: results depend on how the test data is generated, so the generator must
not hard-code facts. It declares a few intrinsic types and only the relations a creator ad market
needs to be recognisable, and lets Markov chains with randomly drawn settings produce everything
else, over a wide space. The recipe is changeable at run time.

### G1. One source of history
The Markov generator replaces `ladder/generate.py` everywhere: rungs, market reference, simulations,
Compare and Backtest all learn from it. Changing the recipe changes all of them. The committed
`data/*.json` is only the default recipe's output; quoted numbers are "for the default recipe and seed".

### G2. The only relations built in
1. Bigger accounts get more views, less than proportionally; the curve's steepness is drawn per run.
2. Views never decrease over time.
3. Category and format change reach; how much each matters is drawn per run.
4. Bought views arrive mostly as a burst, some spread over the first week; the split is drawn per run.
5. ~~`flagged_suspicious` is a noisy version of the truth~~ Dropped (G17): the export's
   `flagged_suspicious` is our fraud check's decision; no separately wrong label is simulated.

Deliberately not built in: "creators join more when a ladder pays more". It is an unmeasured
behaviour claim, so it is a random recipe setting, not a rule. Everything else (tier mix, share of
cheaters, budgets, campaign lengths, posting frequency, old-ladder generosity) is random or emerges
from the chains.

### G3. A post's views: a six-state momentum chain
Each day a post is in one state: cold, steady, trending, viral, fading, dead. Each state multiplies
daily views; the post moves between states by a transition table drawn at random per run. The only
fixed rule: dead is absorbing, so every post stops. Starting daily views come from the creator's size
(G2.1) adjusted for category and format (G2.3).

**Why six, and why these.** They cover every shape a post's views can take: slow start (cold), normal
life (steady → fading → dead), breakout (steady → trending → viral), burnout (viral → fading → dead),
second wave (fading → trending; any move except out of dead is allowed), and stopping (dead). Fewer
states merge trending and viral and lose the rare runaway posts; more states add parameters without
adding any shape. Bought views are not a state: they are added by the creator, on top of the chain.
Validity is checked, not asserted: a validation report will confirm heavy tails, a spread of growth
shapes, and fraud that still differs from organic posts.

### G4. `views_final` is the views on the campaign's last day
Correction during the interview: an earlier draft read `views_final` 90 days after posting. That
contradicts the settlement rule (paid on views at the campaign's end), so `views_final` is taken on
the campaign's last day. Views after that are never paid.

### G5. Stored data: one new field, nothing after the campaign ends
- **Only new field: `daily_views`**, the views a post gained on each day from `post_date` to the
  campaign's last day. Nothing after the campaign ends is counted or stored.
- **The brief's columns are an export**, calculated from `daily_views`: `views_at_24h`, `views_at_7d`,
  `views_at_30d` stop at the campaign's end (so they never exceed `views_final`); `views_final` is the
  views on the campaign's last day; `flagged_suspicious` is the fraud system's decision. Nothing in
  the method reads the three checkpoint columns.
- **Fraud signals are computed from `daily_views` when checked, never stored.**
- **No other data is needed.** `daily_views` plus the creator's past posts catches bought views that
  arrive in a burst. The known gap is views dripped in slowly to look organic: they are caught only
  when they push a post far above the creator's usual. The industry answer is engagement per view,
  but adding it would mean inventing how fake engagement behaves, the kind of hard-coded fact this
  redesign removes. Written down as a limit instead.
- **Posts made in the campaign's last days** have too little history for a shape check; they are
  judged only on how their views compare with the creator's usual, and held for review if out of line.

### G6. Fraud check: two signals, one rule
Only data our system pulls itself is used: `daily_views` and the creator's past posts. We have no
audience, retention, device or engagement data, so no signal pretends to use it.

**Signals** (computed from `daily_views` at check time, never stored):
1. **Drop after the peak:** views the day after the post's biggest day ÷ views on that day. This is
   the signal that separates bought views from real spikes. A platform (algorithm) boost or genuine
   virality fades gradually because the platform keeps showing the post; a bought batch arrives and
   stops, so the next day falls back to the creator's normal trickle.
2. **Versus usual:** this post's views ÷ the creator's usual post. Supporting evidence only.

Rejected: **share of views on the peak day** (an algorithm boost concentrates views in one day too,
so it would hold genuine boosted posts), and **creator track record** (it would carry any reviewer
mistake forward to future campaigns).

**Rule.** Cut-offs come from past unflagged posts, never set by hand.
1. Hold if the drop after the peak is sharper than 99 in 100 genuine posts; or
2. hold if the drop is sharper than 95 in 100 **and** the post is bigger than 95 in 100 of the
   creator's usual.
3. "Versus usual" never holds a post alone, so a small creator's genuine viral post is safe.
4. Peak on the campaign's last day (no day after to look at): held for the review week only if
   bigger than 99 in 100 of the creator's usual. This is the one case where a genuine viral post can
   be held, and it is stated openly.

**How a hold is shown** to the reviewer and the creator: a bar chart of the post's daily views with
the peak day and the day after marked; one sentence ("Day 3: 48K views. Day 4: 900, a 98% drop. Fewer
than 1 in 100 genuine posts drop this sharply. This post is also 3.8× your usual."); the status
(Held, review by <date>, then Valid or Fraud).

**Known limit:** bought views dripped in slowly to look organic are not caught unless they push the
post far above the creator's usual. Only engagement or watch-time data would catch them, and we do
not have it.

### G7. Creators: a four-state chain across campaigns
At each campaign a creator could join, they are in one state: **active** (joins, posts normally),
**fatigued** (less likely to join, posts less), **cheating** (joins, buys views on some posts), or
**gone** (left the platform; the only fixed rule is that gone is permanent). Transition chances are
drawn at random per run, so the share of cheaters is not set by hand, and cheating is a phase a
creator drifts into and out of. The brief's creator fields are calculated from each creator's own
generated past, not invented: `historical_avg_views_per_post` (mean of past posts),
`historical_completion_rate` (share of past campaigns with at least one milestone reached),
`account_age_months` (time since their first generated post). Followers are drawn at the start and
grow slowly with the creator's views; the tier is read when they join each campaign.

### G8. Campaign settings for generated history are visible recipe settings
Real campaigns take budget, duration and choices from the advertiser (the current UI stays). The
generator invents past campaigns, so it needs those values from somewhere: they come from ranges that
are **recipe settings shown on the page**, changeable by anyone, never limits hidden in code.

### G9. Every real view sets the price; only rung coins are paid; the rest is refunded
Changes the coin-rungs rule.
- **Price:** every validated view is a coin in the price, including views on posts below the first
  rung and views between rungs. A coin's true value is the budget over the views the brand actually
  received; leaving any real views out would pretend they did not happen and inflate the price.
- **Bought views caught by the fraud check never count**: they were not real reach.
- **Pay:** a creator is paid only for the coins at the highest rung each post reached, at that price
  (42 views on a 40 rung: priced as 42, paid as 40).
- **Refund:** everything priced but not paid (posts below the first rung, views between rungs) goes
  back to the brand. This is what makes rungs save the brand money.
- **Why this does not reward grinding:** weak posts are priced but earn nothing; their share is
  refunded. They lower the price for others only because views really are more plentiful, which is
  the market telling the truth.
- **Consequence:** rung heights now decide real money, so they must be reachable (see G10).

### G10. Winter: rungs lowered when a group in this campaign cannot reach them
History keeps rungs from ever being too easy; the winter rule keeps them from ever being too hard.
- **Campaign-centric, per group.** A "group" is category × format inside this campaign (for example
  gaming reels), with all creator tiers pooled: every post is measured against its own first rung, so
  tiers compare fairly, and pooling keeps the group large enough to test. Only that group's rungs
  change; other formats and categories in the same campaign keep theirs.
- **No market-wide comparison.** Whatever the cause (a market slump or weak brand material), creators
  in the group cannot reach the rungs, and the brand made the brief. Lowering rungs does not change
  the price (it is set by all views, G9); it only shrinks the brand's refund.
- **Detection: two shares, both clearly short of the 80% the first rung was built for.**
  1. Posts: share of the group's posts that reached their own first rung.
  2. Creators: share of the group's creators whose best post reached their own first rung.
  "Clearly" = below 80% by more than chance explains (one-sided test, 95% confidence). No minimum
  count is needed: a handful of posts can never be clearly short. Requiring both stops one creator
  with many weak posts from triggering it alone.
- **Only lowering, never raising.** A hot market is handled by the price (more coins, each worth
  less); raising targets creators have already cleared would move the goalposts.

### G11. Winter rungs: one Nash shrink factor per group
- **Shortfall:** express each of the group's posts as a fraction of its own first rung (1,200 views on
  a 2,000 rung = 0.6). The score 80% of posts reach is where a first rung built from live data would
  sit (e.g. 0.5).
- **Nash split:** brand's side = historical rung, creators' side = live rung; equal bargaining power
  and log utility give the geometric mean: new rung = historical rung × √0.5 ≈ 0.71 × historical.
  Reachable without collapsing, and neither side sets it alone (the same bargaining logic as the
  thin-market price).
- **All rungs of the group, in every tier, move by the same factor.** Each tier keeps its own rungs
  (nano stays nano-sized, macro stays macro-sized), and the spacing between rungs is kept.
- **Why tiers are pooled for detection but not for rungs:** pooling happens only in counting "did this
  post reach its own first rung?", which means the same thing in every tier. Split by tier, a
  30-post group leaves about 7 posts per tier, too few for the test ever to be clear (3 of 7 reaching
  the rung is not clearly below 80% at 95% confidence), so a real winter would go undetected.
- **Applies to every post in the group**, including posts made before the change; only down, never up.

### G12. Winter checks at the quarter marks, judging each post by its age
- **When:** at 25%, 50% and 75% of the campaign; none after 75% (late changes help too little and
  confuse the most). Not daily: young posts would make every day look like a winter, and 30 daily
  tests at 5% each make a false winter likely. Each check uses ~98.3% confidence so the three
  together keep an overall 95%. Creators are told up front: "rungs are reviewed at each quarter mark
  and can only come down."
- **Growth by age, learned from history:** from past posts' `daily_views` in the same category and
  format, the share of its eventual views a typical post has at each age (e.g. 1 day 25%, 2 days 40%,
  7 days 80%). Learned per run, never typed in.
- **Judging a post:** should-have-by-now = first rung × share for its age; score = views now ÷ that.
  Posts under a day old are skipped. A 2-day-old post with 1,000 views against a 2,000 rung
  (should have 800) is on track; a 10-day-old post with 900 (should have 1,700) is short.
- **Winter test:** share of posts on track and share of creators with at least one post on track,
  both clearly below 80% → winter for that group.
- **New rungs:** the score 80% of the group's posts reach (e.g. 0.5) gives a factor √0.5 ≈ 0.71 applied
  to every rung of the group in every tier (nano 2,000 → 1,400; macro 300K → 210K). Later checks
  judge against the lowered rungs and can lower them again, never raise them.
- **Settlement has no age adjustment:** pay uses each post's views on the campaign's last day against
  the final rungs. The age adjustment exists only to judge winter fairly mid-campaign. Creators are
  told that late posts have less time to earn.

### G13. One system: coin rungs. "No rungs" removed entirely
With G9 (every view sets the price, only rung coins are paid, the rest refunded) and G10–G12 (winter
lowering), coin rungs is the complete design: the ladder the brief asks for, goals for creators,
savings for the brand, fairness when views run cold. "No rungs" (every view past the threshold paid)
was an alternative from before rungs had a real job; it is removed from every page, report and the
code path. Compare becomes two sides: the old way vs Creator Pool.

### G14. The rest of the generator: seasons, joining, old ladders
- **Market seasons:** a Markov chain drifts between hot, normal and cold months (drift chances random
  per run). A cold month lowers every post's views in it, so the generated history contains real
  winters and the backtest can show the winter rule working.
- **Joining:** a creator who has not left the platform, on a matching platform, joins with a chance
  that depends on their state (active or fatigued), the season, and the pay. **Sixth built-in
  relation (direction only): a higher live coin value attracts more creators.** How strongly is
  random per run and always above zero. This is what makes the market's self-correction (high value
  → more creators → value diluted) appear in simulations. Old-way campaigns attract by how generous
  their ladder looks, with the same random strength.
- **Old gut-feel ladders** (history and Compare's old way): 2 to 6 rungs, round thresholds (10K, 25K,
  50K...), one random rate per 1,000 views, the same for everyone; how generous or stingy ops is is
  drawn per run, not from templates.

### G15. Cold start: the market sets the first rungs (replaces the widening fallback)
- **A segment** (category × platform × tier × format) **is a cold start only if it has zero past
  posts.** No invented minimum: one past post is history. Limit: rungs from very few posts can be too
  hard (fixed by the winter rule) or too easy (stays until more history arrives).
- **The widening fallback is removed everywhere.** Borrowing rungs from another group (gaming reels
  for sports reels) assumes a relation nobody can justify.
- **Start to 25%:** no rungs. Every validated view mints a coin; creators see their coins adding up.
- **At 25%:** first rungs built from this campaign's own posts: first rung = the level 80% of posts
  have reached; each next rung = where half of those on the rung below have reached.
- **At 50% and 75%:** rebuilt the same way, moving **up or down** with the data; final at 75%.
- **No age adjustment in a cold start** (there is no history of the segment to learn growth from):
  young posts can pull the 25% rungs down, and the up-or-down rebuilds at 50% and 75% correct it.
- **Settlement:** every post, including those made before 25%, is paid by the final rungs.
- **Price in a brand-new segment:** see G16: the market reference falls back to what coins of the
  same format earned anywhere, so the Nash protection usually still applies.
- **After settlement** its posts join history: the next campaign in the segment has rungs from day
  one, a market reference, and the "only down" winter rule (G10) applies again.
- **Known costs:** no goals for creators in the first quarter (every view still earns coins); a very
  thin first campaign can pay creators a lot per view.

### G16. The market reference: what creators could earn instead
Used only when too few views arrive: it is the "views normally earn about this much" number that
tells the Nash split the pool price is absurd, so the brand is refunded.
1. **Same category and format have settled before:** the median coin price there (as before).
2. **New category** (e.g. the first finance reels): the average price coins of the same format were
   actually paid across all past campaigns, any category. Coins are priced per campaign, not per
   format, so "a reel coin's value" is the average price reel coins received; a campaign counting
   several formats averages over the coins of those formats. This is the creators' real outside
   option: they can post the same format for any campaign.
3. **The format has never been settled at all:** no reference; the plain pool split applies.
Rungs are unaffected: they come only from the same category, format and tier (or the cold-start
rule). The old category → platform → all widening of the reference is removed.

### G17. The recipe panel (Backtest page)
- **Changeable:** the seed; campaign budget and duration ranges (for generated history only); four
  behaviours, each a low-to-high slider shaping the random draws: virality (post momentum chain),
  cheating (creator chain), seasons (market chain), pay pull (how strongly a higher coin value
  attracts creators).
- **Fixed:** world size (number of creators, past campaigns, months of history).
- **Buttons:** "Randomise everything" (all settings at random, to show results hold across very
  different worlds) and "Show all numbers" (the exact values drawn behind the sliders).
- **Not simulated:** label quality. The fraud check decides; people verify afterwards; there is no
  point simulating a separately wrong label.
- Any change regenerates the data and re-runs the backtest.

### G18. "Winter" is called "Fair Reach"
For creators it signals care, not bad weather: "Fair Reach: this campaign's rungs were lowered so
they stay reachable." G10–G12 describe the Fair Reach check; "winter" is kept only as internal shorthand
in this log.

### G19. A running summary per segment
When a campaign settles, its posts are added into a summary table, so a new campaign reads one row
instead of re-scanning all history.
- **Per segment** (category × platform × tier × format): number of posts (zero = cold start); sum and
  sum of squares of log-views (typical post and spread → rungs); views gained by age as running
  totals (judging posts by age at the quarter checks).
- **Per format:** total coins paid and total rupees paid. The market reference (G16) becomes the
  **average** rupees ÷ coins, "what a coin of this format has earned", kept as two running totals (a
  median cannot be updated incrementally).

### G20. The Backtest page: eight measures, no per-campaign tables
Old way vs Creator Pool across every generated campaign, each a headline number with one small chart,
all updating when the recipe changes ("across N campaigns in this world"):
- **Advertisers:** (1) budget kept: campaigns over budget and the worst overspend; (2) cost per 1,000
  genuine views; (3) money returned: thin-market refunds plus priced-but-unpaid views between rungs;
  (4) money not spent on bought views.
- **Creators:** (5) share of creators paid, by tier; (6) Fair Reach rescues: campaigns whose rungs
  were lowered and creators paid only because of it.
- **Market health:** (7) price stability: coin price spread across similar campaigns; (8) pay
  concentration: share of money to the top 10% of creators.
The full per-campaign report stays downloadable in `results/`.

**G19 amended.** Store whatever makes the calculations easy, not only running sums: each settled
campaign's coin price per format is kept, so the market reference stays the **median** (robust: one
strange campaign cannot drag it). The summary serves cold-start checks, rung building, Fair Reach
checks, reports and every Backtest measure.

### G21. The advertiser answers four questions; nothing else
One screen each: (1) **what are you promoting?** category, one or several; (2) **where should it
run?** platform and format as simple cards ("Instagram Reels", "YouTube Shorts"), default "Anywhere";
(3) **how much?** budget: "the most you'll ever pay; if fewer views arrive than it can buy, you get
money back"; (4) **for how long?** quick picks (1 week, 2 weeks, 1 month, custom), starting today.
Then a one-sentence review card ("Gaming · Instagram Reels · ₹3,00,000 · 2 weeks") and **Publish**.
**"Who can join" is removed entirely:** every creator size can join; the coin price and per-tier
rungs handle fairness. Rungs, market reference and Fair Reach work behind the scenes, visible only
under "Under the hood".

### G22. What the advertiser sees after Publish
- **Publish plays one realistic campaign**: a fresh random seed, market season drawn from the recipe's
  normal behaviour, no scenario picker in the way.
- **After the results, "See how we'd handle…"**: too many creators (price per view drops), too few
  views (money back), fraud wave (bought views caught), a viral post on the last day. Each replays the
  same campaign under that situation, with the results explaining what we did.
- **The seed sits at the side with a "?"**: clicking it explains "change this number to simulate a
  different run". A new number is picked automatically on each Publish, and the advertiser can type
  one to replay a specific run.

### G23. The advertiser's live dashboard: simple numbers only
- **Status:** Live → Completed (the completion date simply moves a week later if a review delays
  settlement; no "in review" or "settling" states shown).
- **Five tiles:** views (genuine), spend so far, cost per 1,000 views, creators live, posts.
- **One chart:** views per day as bars, cost per 1,000 views as a line.
- **Plays in about 20 seconds** with pause, 2× and "skip to results".
- **Not shown to advertisers:** activity feed, review messages, Fair Reach notes, rungs, coin curves,
  formulas. Mechanism detail stays under "Under the hood".

**G23 amended.** No top posts table for the brand. Post-level data is stored for reporting and for a
later internal Meme'd dashboard showing everything about a campaign; that dashboard is not built now.

### G24. The results report
Every number computed from the run.
1. **Hero line:** "Your ₹3,00,000 reached 41.2 lakh genuine views."
2. **Four big numbers:** cost per 1,000 views beside what a typical gut-feel ladder would have paid
   for the same posts (the same campaign run under the old way behind the scenes); money back, if any;
   fraud kept out ("₹12,400 of bought views never charged"), **shown only when a held post was proven
   fraud**; creators and posts that worked for them.
3. **How easy it was:** "You answered 4 questions. The old way needs a budget, a rate and a rung
   table, about 20 decisions."
4. **What happened:** two or three short cards, only for things that occurred (many creators joined,
   so views got cheaper; too few views, so a fair price and money back; bought views not charged; and
   always "you never paid more than your budget").
5. **"See how we'd handle…"** replays (G22).
No rungs, coin prices or formulas.

**Fraud in the simulation comes from the Markov creator chain.** Whether a post's views were bought
follows from its creator being in the cheating state; the review's outcome is that truth, not a
separate simulated label. Held-then-cleared posts are never mentioned to the brand.

### G25. The creator's experience
Five guided steps; the UI does the talking, with as little text as possible.
1. **Who are you?** A creator profile card from the generated world (handle, platform, followers,
   size), or "Surprise me".
2. **Campaigns you can join:** two or three live campaign cards; tap one and Join.
3. **Your goals:** their rungs as personal goals ("First goal: 2.1K views, 4 in 5 creators like you
   reach it"), with one line: set from how posts by creators their size have done.
4. **Your post is live:** views count up on a progress bar with the goals marked; each goal passed
   gets a small moment; "what your views are worth right now" shows the live coin value.
5. **You got paid:** "₹4,860: your post reached goal 3 (8.4K views), so 8,400 coins × ₹0.58 each",
   "every creator here got the same price per coin: you were paid your exact share"; and, only if it
   happened, "views were slow for everyone, so your goals were lowered to keep them reachable" (Fair
   Reach, the one place creators see it).
**Cold start shows up at random.** Now and then a campaign in a segment with no history appears in
the list. The creator sees "goals unlock at 25%": every view earns coins until then; the goals appear
at the 25% mark, may move at 50% and 75%, and are fixed after that.

### G26. The Compare page
- **Step 1, "With Creator Pool":** the same four questions in one compact card; "That's it."
- **Step 2, "The old way":** unlocks below, deliberately grey and tedious: budget, a "₹ per 1,000
  views" rate, a target creator size, and a rung table where every row needs views and a payout, with
  small warnings as they type. Pre-filled with a typical gut-feel ladder; every cell editable.
- **Step 3, "Compare":** both systems run on the same worlds; heavy graphs and animation. A strip of
  dots per system (spend vs budget per world: the old way scatters and crosses the line, ours never
  does), then a zoom into the old way's **worst world** side by side with ours in that same world,
  then the summary ("across N campaigns you'd have saved ₹X on average, and never gone over budget").
- **Worst = most money wasted:** overspend above budget + money paid for bought views + overpayment
  versus our price for the same genuine views.
- **The worlds are real past campaigns, not an invented count.** Each past campaign's creators and
  posts meet the user's budget, paid both ways (our rungs built only from campaigns before it). Which
  campaigns, following G16: (1) same category and format; (2) if none, same format in any category;
  (3) if the format has never run, the page says there is nothing honest to compare against. The page
  states how many were used ("compared across 23 past gaming campaigns").

### G27. Detailed views are deferred, not deleted
The mechanism detail (rung explainer, price and refund arithmetic, Fair Reach checks, review list with
Valid / Fraud, per-creator payouts, objectives checklist) is not part of the new flows and no "Under
the hood" page is built now. The current code for it is kept (archived) for a separate page later.
Main tabs become: Advertiser · Creator · Compare · Backtest, plus Method (docs). "No rungs" is removed
everywhere (G13).

**G3 amended (found while building).** Only a **fading** post can move to dead; a post must fade
before it stops. Without this, genuine posts could fall from their
peak to zero overnight, exactly like bought views, and the fraud check's drop-after-peak cut-offs came
out at 0. The rule states the premise the fraud check rests on: real attention tails off.

**G6 detail (found while building).** The drop after the peak is computed as (next day + 1) ÷ (peak
day + 1). Daily views are whole numbers, so a tiny post going from 1 view to 0 would otherwise look
like a 100% cliff; with the +1 it scores 0.5, while 2,000 → 0 still scores about 0. No threshold needed.

### G28. Three corrections found while building the generator
- **Brands budget roughly for the reach they expect (built-in relation 6).** Budget = the campaign's
  genuine reach x the category's value per view x a random error, bounded by the recipe's budget
  range. Drawn per run: each category's value per view and how far off budgets are. Without it,
  budgets were independent of reach (Rs 50 lakh for three creators) and every price came out absurd
  (a median Rs 4,500 per 1,000 views).
- **Ops anchor gut-feel ladders on what past posts got (built-in relation 7).** The first rung is the
  median final views of earlier posts by the target tier, off by a random gut-feel error (size drawn
  per run). Anchoring on an invented belief produced worlds where old ladders paid almost nobody.
- **The market reference is what creators were actually paid per view** in settled campaigns. The
  generated history ran the old way, so its reference is the old ladders' real payouts per view:
  literally what creators could earn instead (G16). Once Creator Coin settles campaigns, their
  prices feed it the same way.

### G29. Name and build (final round)
- **Name: Creator Coin.** Creators share one pool, coin by coin.
- **Built all at once:** generator, engine, reports, advertiser and creator flows, Compare, Backtest,
  and a landing page in the style of etched.com (near-black, very large type, short plain copy).
- **Found while building, recorded above:** only fading posts die (G3), drop computed with +1 (G6),
  budgets and ops ladders tied to reach and history (G28), fraud cut-offs learned from unheld posts
  only, the old-way twin is budget-aware and estimates spend over every creator size, and before any
  coins exist creators feel no pull either way. Compare pre-fills the brief's own example ladder.
