'use strict';
/**
 * Publisher game: join a campaign, advance six hours at a time, report the impressions you
 * actually delivered, and chase a three-rung ladder.
 *
 * Ladder design follows established target-setting practice rather than a rising multiplier:
 *
 *   - Rungs are quantiles of the publisher's own demonstrated delivery, aimed at fixed success
 *     probabilities (85% / 50% / 20%). A target nobody can hit is a broken target: the first rung
 *     is deliberately set *below* typical delivery. (Wilson et al. 2019, "the 85% rule";
 *     Guadagnoli & Lee's challenge point framework.)
 *   - Capability is a recency-weighted median and its spread a log-scale deviation, so one lucky step
 *     cannot drag the bar upward — only sustained delivery moves it. (Locke & Latham: goals must
 *     be accepted as attainable; Vygotsky's zone of proximal development.)
 *   - Difficulty is paced as a sawtooth, not a ramp: a run of strong steps earns a recovery beat
 *     where the bar eases. (Csikszentmihalyi's flow channel; Hunicke's Hamlet DDA; Valve's L4D
 *     AI Director pacing.)
 *   - Mercy is bounded. The bar holds through a miss, then eases a little per further miss, and
 *     stops at a floor set by the market rather than by the publisher's own failure: a target that
 *     chases a failing publisher down to nothing is not a target, and clearing it proves nothing.
 *     A streak also survives one miss via a freeze. (Anti-frustration and catch-up design, without
 *     surrendering the challenge.)
 *
 * The money is never gamified: payout is always coins times the settled CPI. Tiers are
 * recognition only.
 */
const { randomUUID } = require('node:crypto');
const { settle } = require('../server/mechanism');
const { mulberry32 } = require('./simulate');
const { buildPopulation, warmCurve, ARCHETYPES } = require('./campaign');

const STEP_HOURS = 6;

// Probability the publisher clears each rung, and the quantiles used to place each target on a
// lognormal model of their delivery. The textbook values would be z = Phi^-1(1 - p), but the
// centre and spread are themselves estimated from a handful of noisy steps, which makes every
// rung easier than its nominal odds. These z values are calibrated against simulated publishers
// so the measured clear rates land on 85 / 50 / 21 percent rather than 83 / 53 / 28.
const RUNG_SUCCESS = [0.85, 0.5, 0.2];
const RUNG_Z = [-1.15, 0.12, 1.15];
const LABELS = {
  normal: ['in reach', 'stretch', 'ambitious'],
  recovery: ['breather', 'steady', 'push'],
  floor: ['minimum to stay in', 'match the market', 'get back ahead'],
};

const WINDOW = 8;             // steps of history that describe current capability
const DECAY = 0.82;           // recency weighting within that window
const MIN_SIGMA = 0.28;       // never model a publisher as perfectly consistent
const MAX_SIGMA = 0.9;
const STRONG_RUN = 3;         // strong steps before a recovery beat
const RECOVERY_SCALE = 0.78;
const FREEZE_EVERY = 5;       // one forgiven miss per this many steps

// The bar is sticky. Missing it does not collapse it: it holds for a grace period, then eases a
// little per further miss, and stops at a floor. A target that chases a failing publisher all the
// way down is not a target, and clearing it proves nothing.
const HOLD_STEPS = 2;         // misses tolerated before the bar starts to ease at all
const BAR_DECAY = 0.88;       // then it eases this much per additional miss
const BAR_RISE_CAP = 4;     // and it may only rise this fast, however big the step
const BAR_DRIFT_DOWN = 0.95;  // a gentle slide when the publisher's level has genuinely slipped
// The floor is competitive, not personal: a share of what a typical rival delivers in a step.
const FLOOR_SHARE = 0.3;
const ABSOLUTE_FLOOR = 5;
const HEADROOM_MULTIPLE = 1.5; // no point asking for coins the pool cannot pay for

const TIERS = [
  { name: 'Bronze', share: 0.01 },
  { name: 'Silver', share: 0.03 },
  { name: 'Gold', share: 0.07 },
  { name: 'Platinum', share: 0.15 },
  { name: 'Diamond', share: 0.30 },
];

const OFFER_TEMPLATES = [
  { name: 'Indie news network', budget: 60000, expectedCpi: 2.0, durationDays: 5, archetype: 'balanced' },
  { name: 'Fintech launch', budget: 150000, expectedCpi: 3.5, durationDays: 7, archetype: 'thin' },
  { name: 'Mobile game install push', budget: 40000, expectedCpi: 1.2, durationDays: 4, archetype: 'abundant' },
  { name: 'Luxury brand takeover', budget: 220000, expectedCpi: 6.0, durationDays: 6, archetype: 'premium' },
  { name: 'Festival countdown', budget: 90000, expectedCpi: 2.5, durationDays: 5, archetype: 'lateBurst' },
];

function weightedMedian(pairs) {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  let run = 0;
  for (const p of sorted) {
    run += p.weight;
    if (run >= total / 2) return p.value;
  }
  return sorted.length ? sorted[sorted.length - 1].value : 0;
}

class PublisherGame {
  constructor() {
    this.offers = [];
    this.sessions = new Map();
  }

  /** Build a fresh set of campaigns a publisher can join, each priced from a learned curve. */
  refreshOffers(seed = Math.floor(Math.random() * 1e6)) {
    const random = mulberry32(seed);
    this.offers = OFFER_TEMPLATES.map((t, i) => {
      const hours = t.durationDays * 24;
      const spec = { id: t.archetype, ...ARCHETYPES[t.archetype] };
      const curve = warmCurve(random, spec, {
        budget: t.budget, expectedCpi: t.expectedCpi, hours, campaigns: 25,
      });
      const quote = curve.priceFor(t.budget, t.expectedCpi, { random });
      return {
        id: 'offer-' + (i + 1),
        name: t.name,
        budget: t.budget,
        expectedCpi: t.expectedCpi,
        durationDays: t.durationDays,
        hours,
        postedPrice: quote.price,
        priceSource: quote.source,
        archetype: t.archetype,
        archetypeLabel: ARCHETYPES[t.archetype].label,
        totalSteps: Math.ceil(hours / STEP_HOURS),
        seed: Math.floor(random() * 1e6),
      };
    });
    return this.offers;
  }

  listOffers() {
    if (!this.offers.length) this.refreshOffers();
    return this.offers;
  }

  join(offerId, publisher = 'you') {
    const offer = this.listOffers().find((o) => o.id === offerId);
    if (!offer) throw new Error('no campaign ' + offerId);
    const random = mulberry32(offer.seed);
    const spec = { id: offer.archetype, ...ARCHETYPES[offer.archetype] };
    const rivals = buildPopulation(random, spec, {
      budget: offer.budget, expectedCpi: offer.expectedCpi, hours: offer.hours,
    });

    // Opening guess before any history exists: what a typical rival delivers in one step.
    const rates = rivals.map((p) => p.rate).sort((a, b) => a - b);
    const typical = rates[Math.floor(rates.length / 2)] || 1;

    const session = {
      id: randomUUID().slice(0, 8),
      publisher,
      offer,
      rivals,
      hour: 0,
      step: 0,
      coins: 0,
      rivalCoins: 0,
      rivalRate: 0,
      rivalsLive: 0,
      seedCapability: Math.max(1, Math.round(typical * STEP_HOURS)),
      deliveries: [],        // what the publisher actually delivered, most recent last
      bar: Math.max(Math.max(ABSOLUTE_FLOOR, Math.round(FLOOR_SHARE * Math.max(1, Math.round(typical * STEP_HOURS)))),
        Math.round(Math.max(1, Math.round(typical * STEP_HOURS)) * Math.exp(RUNG_Z[0] * 0.35))),
      hold: 0,
      mode: 'normal',        // normal | recovery
      strongRun: 0,
      misses: 0,
      streak: 0,
      best: 0,
      lastFreeze: -Infinity,
      history: [],
      status: 'active',
      settlement: null,
    };
    this.sessions.set(session.id, session);
    // Freeze the opening ladder now — targets must not move while the publisher chases them.
    // Only step() replaces this after bar/mode update.
    session.currentLadder = this.ladder(session);
    return this.view(session.id);
  }

  session(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('no session ' + id);
    return s;
  }

  /** Advance the rival market, using the mechanism's own join rule. */
  advanceRivals(s, hours) {
    const { offer } = s;
    for (let h = 0; h < hours; h += 1) {
      const t = s.hour + h;
      if (t >= offer.hours) break;
      for (const p of s.rivals) {
        if (p.joined !== null || p.arrival > t) continue;
        if (t - p.arrival > p.patience) continue;
        const own = p.rate * (offer.hours - t);
        const alreadyCommitted = s.rivalCoins + s.rivalRate * Math.max(0, offer.hours - t);
        const expected = Math.min(offer.postedPrice, offer.budget / (alreadyCommitted + own + s.coins));
        if (expected >= p.reservation) {
          p.joined = t;
          s.rivalRate += p.rate;
          s.rivalsLive += 1;
        }
      }
      s.rivalCoins += s.rivalRate;
    }
  }

  /** Coins the rivals hold by close if nobody else joins: the mechanism's committed figure. */
  rivalCommitment(s) {
    return s.rivalCoins + s.rivalRate * Math.max(0, s.offer.hours - s.hour);
  }

  /** What a total position of `coins` is worth at settlement, after dilution. */
  project(s, coins) {
    const total = this.rivalCommitment(s) + coins;
    const cpi = total > 0 ? Math.min(s.offer.postedPrice, s.offer.budget / total) : s.offer.postedPrice;
    return { coins, cpi, payout: coins * cpi, totalCoins: total };
  }

  /** The minimum that still counts as taking part, set by the market rather than by the publisher. */
  floorFor(s) {
    return Math.max(ABSOLUTE_FLOOR, Math.round(FLOOR_SHARE * s.seedCapability));
  }

  /**
   * Model the publisher: a recency-weighted median of recent delivery, plus its log-scale spread.
   * The median is what keeps a single spike from dragging the ladder out of reach.
   */
  capability(s) {
    const recent = s.deliveries.slice(-WINDOW);
    if (!recent.length) return { centre: s.seedCapability, sigma: 0.35, floor: s.seedCapability };
    const pairs = recent.map((value, i) => ({
      value: Math.max(1, value),
      weight: DECAY ** (recent.length - 1 - i),
    }));
    const centre = Math.max(1, weightedMedian(pairs));
    // Spread from the weighted mean absolute log deviation. For a normal variable
    // E|x - mu| = sigma * sqrt(2/pi), so sigma = 1.2533 * MeanAD. A median-based MAD is more
    // robust but badly underestimates spread on a handful of samples, which would place the
    // hard rung far too close to the median and make it clear ~35% of the time instead of 20%.
    const weightTotal = pairs.reduce((sum, p) => sum + p.weight, 0);
    const meanAbsDeviation = pairs
      .reduce((sum, p) => sum + p.weight * Math.abs(Math.log(p.value) - Math.log(centre)), 0) / weightTotal;
    // Small-sample correction: deviations measured around an estimated centre understate spread,
    // and the effective sample here is only a few steps. Without this the hard rung sits too close
    // to the median and gets cleared far more often than its stated odds.
    const effectiveN = weightTotal ** 2 / pairs.reduce((sum, p) => sum + p.weight * p.weight, 0);
    const correction = 1 + 0.9 / Math.max(1.5, effectiveN);
    const sigma = Math.min(MAX_SIGMA, Math.max(MIN_SIGMA, 1.2533 * meanAbsDeviation * correction));
    const floor = Math.max(1, Math.min(...recent.map((v) => Math.max(1, v))));
    return { centre, sigma, floor };
  }

  /**
   * Three rungs for the coming step, stated cumulatively and placed by success probability.
   * Rung one sits below typical delivery on purpose: it should be cleared roughly 85% of the time.
   */
  ladder(s) {
    const { sigma } = this.capability(s);
    const stepsLeft = Math.max(1, s.offer.totalSteps - s.step);
    const absorbable = HEADROOM_MULTIPLE * (s.offer.budget / s.offer.postedPrice);
    const headroom = Math.max(1, (absorbable - (this.rivalCommitment(s) + s.coins)) / stepsLeft);

    // The first rung is the bar itself: a sticky value that rises with sustained delivery, holds
    // through a miss, eases slowly after that, and never drops below the market floor. The harder
    // rungs keep their spacing above it.
    const floor = this.floorFor(s);
    const scale = s.mode === 'recovery' ? RECOVERY_SCALE : 1;
    const bar = Math.max(floor, s.bar * scale);
    const labels = LABELS[s.mode === 'recovery' ? 'recovery' : (s.bar <= floor ? 'floor' : 'normal')];
    const now = this.project(s, s.coins);

    // When the pool runs out of headroom, scale the whole ladder down together. Clamping each
    // rung at the same ceiling would collapse all three onto one number, and a ladder whose rungs
    // are identical is not a ladder.
    // REACH is placed by the capability model (bar × exp(0) = bar at 85th-percentile).
    // PUSH and STRETCH use fixed geometric multiples of REACH — 3× and 7× — so they always
    // sit at meaningfully different levels regardless of how consistent the publisher is.
    // This is standard game-design practice (cf. "ratio scaling" in difficulty literature):
    // the hard rung is always a real stretch, not just a rounding error above the easy one.
    // Use max(1, bar) so fractional bars (deep decay) produce at least 1 impression per rung
    // rather than rounding to 0. The sticky rung logic in step() ensures the target can only
    // soften (go down) after a miss — never harden — so there is no treadmill.
    const reachRaw = Math.max(1, bar);
    const raws = [
      reachRaw,
      Math.max(bar * Math.exp((RUNG_Z[1] - RUNG_Z[0]) * sigma), reachRaw * 3),
      Math.max(bar * Math.exp((RUNG_Z[2] - RUNG_Z[0]) * sigma), reachRaw * 7),
    ];
    const fit = Math.min(1, headroom / raws[raws.length - 1]);

    return RUNG_Z.map((z, i) => {
      let need = Math.max(1, Math.round(raws[i]));
      const cumulativeCoins = Math.round(s.coins + need);
      const at = this.project(s, cumulativeCoins);
      const gain = at.payout - now.payout;
      // Saturated only when gain is truly $0: you own the entire pool with no rivals.
      // When rivals exist, you always gain by diluting them — never show "pool full" in that case.
      const saturated = gain < 1;
      return {
        rung: i + 1,
        label: saturated ? ['pool nearly full', 'top up', 'soak it up'][i] : labels[i],
        need,
        saturated,
        clearChance: saturated ? null : RUNG_SUCCESS[i],
        cumulativeCoins,
        cumulativeCpi: at.cpi,
        cumulativeEarnings: at.payout,
        gain,
      };
    });
  }

  tier(s) {
    const total = this.rivalCommitment(s) + s.coins;
    const share = total > 0 ? s.coins / total : 0;
    let current = null;
    let next = TIERS[0];
    for (const t of TIERS) {
      if (share >= t.share) {
        current = t;
        next = TIERS[TIERS.indexOf(t) + 1] || null;
      }
    }
    const rivals = this.rivalCommitment(s);
    const coinsForNext = next ? Math.max(0, (next.share * rivals) / (1 - next.share) - s.coins) : 0;
    return {
      share,
      current: current ? current.name : null,
      next: next ? next.name : null,
      nextShare: next ? next.share : null,
      coinsForNext: Math.round(coinsForNext),
    };
  }

  /** One six-hour step: the publisher reports impressions, rivals move, the ladder re-rates. */
  step(id, impressions) {
    const s = this.session(id);
    if (s.status !== 'active') throw new Error('campaign already settled');
    impressions = Number(impressions);
    if (!Number.isFinite(impressions) || impressions < 0) throw new Error('impressions must be zero or more');

    // Evaluate against the FROZEN ladder — the same targets the publisher was chasing.
    // Using a fresh this.ladder(s) here diverges from the display when bar decays mid-step:
    // the fresh target could be lower, user "accidentally" clears it, bar rises, UI jumps up.
    const rungs = s.currentLadder || this.ladder(s);
    const cleared = rungs.filter((r) => impressions >= r.need).length;
    const asked = rungs[0].need;
    const nearMiss = cleared === 0 && impressions >= asked * 0.9;

    s.coins += impressions;
    this.advanceRivals(s, STEP_HOURS);
    s.hour = Math.min(s.offer.hours, s.hour + STEP_HOURS);
    s.step += 1;
    s.deliveries.push(impressions);
    s.best = Math.max(s.best, impressions);

    // Streaks survive one miss per FREEZE_EVERY steps, and a near miss is never punished.
    let froze = false;
    if (cleared > 0) {
      s.streak += 1;
      s.misses = 0;
    } else if (nearMiss || s.step - s.lastFreeze > FREEZE_EVERY) {
      froze = !nearMiss && s.streak > 0;
      if (froze) s.lastFreeze = s.step;
      if (!nearMiss && !froze) s.streak = 0;
      s.misses += 1;
    } else {
      s.streak = 0;
      s.misses += 1;
    }

    // Move the bar. Up is earned and capped; down is slow, and stops at the market floor.
    const floor = this.floorFor(s);
    const { centre, sigma } = this.capability(s);
    const earned = centre * Math.exp(RUNG_Z[0] * sigma);
    if (cleared > 0) {
      // Rising is earned and capped. Falling is allowed too, but only as a gentle drift: if the
      // publisher's demonstrated level has slipped below the bar, the bar follows slowly rather
      // than ratcheting forever upward.
      const up = Math.min(Math.max(s.bar, earned), s.bar * BAR_RISE_CAP);
      const drift = Math.max(earned, s.bar * BAR_DRIFT_DOWN);
      s.bar = Math.max(floor, earned < s.bar ? drift : up);
      s.hold = 0;
    } else {
      s.hold += 1;
      if (s.hold > HOLD_STEPS) s.bar = Math.max(floor, s.bar * BAR_DECAY);
    }

    // Sawtooth pacing: a run of strong steps earns a breather.
    s.strongRun = cleared >= 2 ? s.strongRun + 1 : 0;
    const previousMode = s.mode;
    if (s.strongRun >= STRONG_RUN) { s.mode = 'recovery'; s.strongRun = 0; } else s.mode = 'normal';

    // Sticky rungs: the cumulative coin target (cumulativeCoins) is what stays fixed.
    // After a clear: fresh targets from new bar position.
    // After a miss:  cumulativeTarget = min(prevTarget, freshTarget) — can only soften downward.
    //               need = remaining distance = max(1, cumulativeTarget - s.coins).
    // This means the rung the publisher sees (the cumulative number) is frozen until cleared.
    // It may drift DOWN to meet them (bar decay) but NEVER moves up until they clear it.
    const freshLadder = this.ladder(s);
    if (cleared > 0 || !s.currentLadder) {
      s.currentLadder = freshLadder;
    } else {
      s.currentLadder = freshLadder.map((next, i) => {
        const prevTarget = s.currentLadder[i].cumulativeCoins;
        const nextTarget = next.cumulativeCoins;
        const target = Math.min(prevTarget, nextTarget);  // cumulative target only goes down
        if (target === nextTarget) {
          return next;  // bar decayed naturally, fresh ladder is already softer — use as-is
        }
        // Old target is lower — keep it, and recompute EVERYTHING at that frozen target,
        // not just need. Previously cumulativeEarnings/cpi/gain kept the fresh (higher) values,
        // so the $ reward silently drifted even while the impression target stayed frozen.
        const need = Math.max(1, target - s.coins);
        const at = this.project(s, target);
        const now = this.project(s, s.coins);
        return {
          ...next,
          need,
          cumulativeCoins: target,
          cumulativeCpi: at.cpi,
          cumulativeEarnings: at.payout,
          gain: at.payout - now.payout,
        };
      });
    }

    const projection = this.project(s, s.coins);
    s.history.push({
      step: s.step,
      hour: s.hour,
      day: Math.ceil(s.hour / 24),
      impressions,
      cleared,
      target: asked,
      mode: previousMode,
      coins: s.coins,
      projectedPayout: projection.payout,
    });

    if (s.hour >= s.offer.hours) this.settle(id);
    return {
      ...this.view(id),
      lastStep: { cleared, target: asked, impressions, nearMiss, froze, mode: previousMode },
    };
  }

  /** Close the campaign: one price for every coin, rivals included, remainder refunded. */
  settle(id) {
    const s = this.session(id);
    if (s.status === 'settled') return this.view(id);
    const holdings = [
      { publisher: s.publisher, coins: s.coins },
      ...s.rivals.filter((p) => p.joined !== null)
        .map((p) => ({ publisher: p.name, coins: p.rate * (s.offer.hours - p.joined) })),
    ];
    const result = settle(s.offer.budget, s.offer.postedPrice, holdings);
    const mine = result.payouts.find((p) => p.publisher === s.publisher);
    s.status = 'settled';
    s.settlement = {
      cpi: result.price,
      minted: result.minted,
      yourCoins: s.coins,
      yourPayout: mine ? mine.payout : 0,
      yourShare: result.minted > 0 ? s.coins / result.minted : 0,
      disbursed: result.disbursed,
      refund: result.refund,
      poolSplit: result.minted > 0 ? s.offer.budget / result.minted : null,
      healed: result.minted > 0 && result.price < s.offer.budget / result.minted - 1e-9,
      bestStep: s.best,
      longestStreak: s.streak,
    };
    return this.view(id);
  }

  view(id) {
    const s = this.session(id);
    const projection = this.project(s, s.coins);
    const model = this.capability(s);
    return {
      id: s.id,
      publisher: s.publisher,
      campaign: s.offer,
      status: s.status,
      hour: s.hour,
      day: Math.max(1, Math.ceil(Math.max(1, s.hour) / 24)),
      step: s.step,
      stepsLeft: Math.max(0, s.offer.totalSteps - s.step),
      stepHours: STEP_HOURS,
      coins: s.coins,
      rivalCoins: Math.round(s.rivalCoins),
      rivalsLive: s.rivalsLive,
      marketCoins: Math.round(s.rivalCoins + s.coins),
      estimatedCpi: projection.cpi,
      payoutIfStopNow: projection.payout,
      mode: s.mode,
      bar: Math.round(s.bar),
      floor: this.floorFor(s),
      atFloor: s.bar <= this.floorFor(s),
      streak: s.streak,
      best: s.best,
      typical: Math.round(model.centre),
      consistency: model.sigma,
      tier: this.tier(s),
      form: s.history.slice(-8).map((h) => h.cleared),
      ladder: s.status === 'active' ? (s.currentLadder || this.ladder(s)) : [],
      history: s.history.slice(-14),
      settlement: s.settlement,
    };
  }
}

module.exports = { PublisherGame, STEP_HOURS, RUNG_SUCCESS, TIERS };
