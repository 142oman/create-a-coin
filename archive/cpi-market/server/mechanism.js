'use strict';
/**
 * Mint-only CPI price discovery.
 *
 * A campaign cannot price itself: minting is the only observable, and "no coins" is
 * ambiguous between "price too low" and "nobody there". Discovery therefore happens
 * across campaigns. Each campaign posts one price and reports the coins it minted;
 * pooled, those pairs trace the supply curve that prices the next campaign.
 *
 * See REPORT.md for the derivation.
 */

const DEFAULTS = {
  bandwidth: 0.18,        // kernel width in log-price
  minObservations: 15,    // campaigns needed before the curve is trusted
  saturation: 0.95,       // "buys essentially all available supply"
  gridPoints: 61,
  wide: 2.0,              // log-range of the warmup sweep
  wideShare: 0.10,        // share of campaigns priced exploratively
  exploration: 0.10,      // jitter around the learned price
};

class SupplyCurve {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.observations = [];
  }

  /** One campaign's outcome: it posted `price` and the market delivered `coins`. */
  record(price, coins) {
    if (!(price > 0) || !(coins >= 0)) throw new Error('invalid observation');
    this.observations.push({ price, coins, at: new Date().toISOString() });
  }

  get learned() {
    return this.observations.length >= this.config.minObservations;
  }

  /** Kernel-smoothed coins delivered at a posted price. */
  coinsAt(price) {
    const { bandwidth } = this.config;
    let weight = 0;
    let weighted = 0;
    for (const o of this.observations) {
      const d = (Math.log(o.price) - Math.log(price)) / bandwidth;
      const w = Math.exp(-(d * d) / 2);
      weight += w;
      weighted += o.coins * w;
    }
    return weight > 1e-9 ? weighted / weight : null;
  }

  grid() {
    if (!this.observations.length) return [];
    const prices = this.observations.map((o) => o.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const n = this.config.gridPoints;
    const points = [];
    for (let i = 0; i < n; i += 1) {
      const p = hi === lo ? lo : lo * (hi / lo) ** (i / (n - 1));
      const coins = this.coinsAt(p);
      if (coins !== null) points.push({ price: p, coins });
    }
    return points;
  }

  /**
   * Two candidate prices; the cheaper one governs.
   *   exhaust  cheapest price at which delivery would spend the whole budget
   *   saturate cheapest price that already buys essentially all available supply
   * Paying past saturation buys no extra supply. Testing exhaust first would charge a
   * thin market the whole budget divided by whatever showed up: the pool-split absurdity.
   */
  clearingPrice(budget, prior) {
    if (!this.learned) return { price: prior, source: 'prior', exhaust: null, saturate: null };
    const curve = this.grid();
    if (!curve.length) return { price: prior, source: 'prior', exhaust: null, saturate: null };

    const exhaust = curve.find((p) => p.price * p.coins >= budget)?.price ?? null;
    // Robust ceiling: the plateau of the smoothed curve, read as the median of its top price
    // decile. Taking the maximum instead would be the max of a noisy estimate, which is biased
    // upward and drags the saturation point with it.
    const ceiling = plateau(curve);
    const saturate = curve.find((p) => p.coins >= this.config.saturation * ceiling)?.price ?? null;

    const candidates = [exhaust, saturate].filter((p) => p !== null);
    if (!candidates.length) return { price: prior, source: 'prior', exhaust, saturate };
    const price = Math.min(...candidates);
    return {
      price,
      source: price === exhaust ? 'budget-exhausted' : 'supply-saturated',
      exhaust,
      saturate,
    };
  }

  /**
   * Price the next campaign. `wantedCpi` is a warmup prior only: once the curve exists it
   * is ignored. Exploration is symmetric and never anchored on the advertiser's quote, so a
   * highballed or lowballed prior cannot steer the search.
   */
  priceFor(budget, wantedCpi, { random = Math.random, explore = true } = {}) {
    const { wide, wideShare } = this.config;
    if (!this.learned) {
      // Warmup sweep. The advertiser's quote sets only the centre of the sweep; the band is
      // wide enough (e^±wide) that a badly lowballed or highballed quote still brackets the
      // answer, so the prior cannot decide where the search looks.
      const price = explore ? wantedCpi * Math.exp(uniform(random, -wide, wide)) : wantedCpi;
      return { price, source: 'warmup sweep', exploring: explore, exhaust: null, saturate: null };
    }
    const base = this.clearingPrice(budget, wantedCpi);
    if (!explore) return { ...base, exploring: false };
    if (random() < wideShare) {
      return { ...base, price: base.price * Math.exp(uniform(random, -wide, wide)), exploring: 'wide' };
    }
    return { ...base, price: base.price * Math.exp(gauss(random) * this.config.exploration), exploring: 'local' };
  }
}

/** Settlement: one price for every coin, budget conserved exactly, in integer cents. */
function settle(budget, postedPrice, holdings) {
  const budgetCents = Math.round(budget * 100);
  const minted = holdings.reduce((sum, h) => sum + h.coins, 0);
  if (minted <= 0) {
    return { price: 0, minted: 0, disbursed: 0, refund: budgetCents / 100, payouts: [] };
  }
  const price = Math.min(postedPrice, budget / minted);
  let spent = 0;
  const payouts = holdings.map((h) => {
    const cents = Math.floor(h.coins * price * 100); // round toward the pool
    spent += cents;
    return { ...h, payout: cents / 100 };
  });
  if (spent > budgetCents) throw new Error('budget conservation violated');
  return {
    price,
    minted,
    disbursed: spent / 100,
    refund: (budgetCents - spent) / 100,
    payouts,
  };
}

/** What a coin is worth if the campaign closed right now. Can only fall as more is minted. */
function estimatedPrice(budget, postedPrice, minted) {
  if (minted <= 0) return postedPrice;
  return Math.min(postedPrice, budget / minted);
}

/** Delivery on the high-price plateau of the smoothed supply curve. */
function plateau(curve) {
  const tail = curve.slice(Math.floor(curve.length * 0.8));
  return median((tail.length ? tail : curve).map((p) => p.coins));
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function uniform(random, lo, hi) {
  return lo + random() * (hi - lo);
}

function gauss(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

module.exports = { SupplyCurve, settle, estimatedPrice, gauss, uniform, plateau, DEFAULTS };
