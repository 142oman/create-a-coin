'use strict';
const { randomUUID } = require('node:crypto');
const { SupplyCurve, settle, estimatedPrice } = require('./mechanism');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Market {
  constructor(options = {}) {
    this.curve = new SupplyCurve(options.curve);
    this.campaigns = new Map();
  }

  createCampaign({ budget, wantedCpi, durationHours = 240, advertiser = 'advertiser', explore = true }) {
    budget = Number(budget);
    wantedCpi = Number(wantedCpi);
    durationHours = Number(durationHours);
    if (!(budget > 0)) throw new HttpError(400, 'budget must be positive');
    if (!(wantedCpi > 0)) throw new HttpError(400, 'wantedCpi must be positive');
    if (!(durationHours > 0)) throw new HttpError(400, 'durationHours must be positive');

    const quote = this.curve.priceFor(budget, wantedCpi, { explore });
    const campaign = {
      id: randomUUID().slice(0, 8),
      advertiser,
      budget,
      wantedCpi,
      durationHours,
      postedPrice: quote.price,
      priceSource: quote.source,
      exploring: quote.exploring,
      status: 'open',
      createdAt: new Date().toISOString(),
      closesAt: new Date(Date.now() + durationHours * 3600_000).toISOString(),
      publishers: new Map(),
      settlement: null,
    };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  campaign(id) {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new HttpError(404, `no campaign ${id}`);
    return campaign;
  }

  /** Joining is sticky: content goes up and stays up. There is no price to renegotiate. */
  join(id, { publisher, note = '' }) {
    const campaign = this.campaign(id);
    if (campaign.status !== 'open') throw new HttpError(409, 'campaign is settled');
    if (!publisher) throw new HttpError(400, 'publisher name required');
    if (campaign.publishers.has(publisher)) throw new HttpError(409, `${publisher} already joined`);
    campaign.publishers.set(publisher, {
      publisher,
      note,
      coins: 0,
      impressions: 0,
      joinedAt: new Date().toISOString(),
    });
    return this.view(id);
  }

  /** Each verified impression mints one coin. Minting is the only thing the market observes. */
  mint(id, { publisher, impressions }) {
    const campaign = this.campaign(id);
    if (campaign.status !== 'open') throw new HttpError(409, 'campaign is settled');
    const holding = campaign.publishers.get(publisher);
    if (!holding) throw new HttpError(404, `${publisher} has not joined`);
    impressions = Number(impressions);
    if (!Number.isFinite(impressions) || impressions <= 0) {
      throw new HttpError(400, 'impressions must be positive');
    }
    holding.impressions += impressions;
    holding.coins += impressions;
    return this.view(id);
  }

  /**
   * Settling pays one price for every coin and refunds what the market could not absorb,
   * then reports the outcome to the platform curve. That report is how discovery happens.
   */
  settleCampaign(id) {
    const campaign = this.campaign(id);
    if (campaign.status !== 'open') throw new HttpError(409, 'already settled');
    const holdings = [...campaign.publishers.values()];
    const result = settle(campaign.budget, campaign.postedPrice, holdings);
    for (const payout of result.payouts) {
      campaign.publishers.get(payout.publisher).payout = payout.payout;
    }
    campaign.status = 'settled';
    campaign.settledAt = new Date().toISOString();
    campaign.settlement = {
      price: result.price,
      minted: result.minted,
      disbursed: result.disbursed,
      refund: result.refund,
      poolSplit: result.minted > 0 ? campaign.budget / result.minted : null,
      healed: result.minted > 0 && result.price < campaign.budget / result.minted,
    };
    this.curve.record(campaign.postedPrice, result.minted);
    return this.view(id);
  }

  view(id) {
    const c = this.campaign(id);
    const minted = [...c.publishers.values()].reduce((s, h) => s + h.coins, 0);
    const price = c.settlement ? c.settlement.price : estimatedPrice(c.budget, c.postedPrice, minted);
    const publishers = [...c.publishers.values()].map((h) => ({
      publisher: h.publisher,
      note: h.note,
      impressions: h.impressions,
      coins: h.coins,
      joinedAt: h.joinedAt,
      estimatedPayout: h.payout ?? h.coins * price,
      settled: h.payout !== undefined,
    }));
    return {
      id: c.id,
      advertiser: c.advertiser,
      status: c.status,
      budget: c.budget,
      wantedCpi: c.wantedCpi,
      durationHours: c.durationHours,
      postedPrice: c.postedPrice,
      priceSource: c.priceSource,
      exploring: c.exploring,
      createdAt: c.createdAt,
      closesAt: c.closesAt,
      minted,
      estimatedCpi: price,
      poolSplit: minted > 0 ? c.budget / minted : null,
      committed: minted * price,
      projectedRefund: Math.max(0, c.budget - minted * price),
      publishers,
      settlement: c.settlement,
    };
  }

  list() {
    return [...this.campaigns.keys()].map((id) => this.view(id)).reverse();
  }

  state() {
    const clearing = this.curve.clearingPrice(100000, 0);
    return {
      observations: this.curve.observations.length,
      needed: this.curve.config.minObservations,
      learned: this.curve.learned,
      curve: this.curve.grid().map((p) => ({ price: p.price, coins: p.coins })),
      points: this.curve.observations.map((o) => ({ price: o.price, coins: o.coins })),
      candidates: { exhaust: clearing.exhaust, saturate: clearing.saturate },
    };
  }
}

module.exports = { Market, HttpError };
