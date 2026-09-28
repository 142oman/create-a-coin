'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Market, HttpError } = require('./store');
const { runMarket, population, runCampaignAt, trueValue, MARKETS, mulberry32 } = require('../sim/simulate');
const { simulateOneCampaign, ARCHETYPES } = require('../sim/campaign');
const { PublisherGame } = require('../sim/ladder');

const game = new PublisherGame();

const PORT = Number(process.env.PORT) || 3000;
const market = new Market();

const routes = [
  ['GET', /^\/api\/market$/, () => market.state()],

  ['POST', /^\/api\/market\/seed$/, (_m, body) => {
    // Run simulated campaigns through the live curve so the page can show a learned market.
    const name = body.market || 'balanced';
    const spec = MARKETS[name];
    if (!spec) throw new HttpError(400, `unknown market ${name}`);
    const count = Math.min(Number(body.campaigns) || 30, 400);
    const random = mulberry32(Date.now() % 100000);
    for (let i = 0; i < count; i += 1) {
      const publishers = population(mulberry32(Math.floor(random() * 1e6)), spec);
      const quote = market.curve.priceFor(100000, spec.wantedCpi, { random });
      const { settlement } = runCampaignAt(publishers, 100000, quote.price);
      market.curve.record(quote.price, settlement.minted);
    }
    return market.state();
  }],

  ['GET', /^\/api\/campaigns$/, () => market.list()],
  ['POST', /^\/api\/campaigns$/, (_m, body) => market.view(market.createCampaign(body).id)],
  ['GET', /^\/api\/campaigns\/([\w-]+)$/, (m) => market.view(m[1])],
  ['POST', /^\/api\/campaigns\/([\w-]+)\/join$/, (m, body) => market.join(m[1], body)],
  ['POST', /^\/api\/campaigns\/([\w-]+)\/mint$/, (m, body) => market.mint(m[1], body)],
  ['POST', /^\/api\/campaigns\/([\w-]+)\/settle$/, (m) => market.settleCampaign(m[1])],

  ['POST', /^\/api\/simulate$/, (_m, body) => {
    const name = body.market || 'thin';
    if (!MARKETS[name]) throw new HttpError(400, `unknown market ${name}`);
    const campaigns = Math.min(Math.max(Number(body.campaigns) || 150, 40), 600);
    const result = runMarket(name, { campaigns, seed: Number(body.seed) || 1 });
    return { market: name, campaigns, spec: result.spec, summary: result.summary, series: result.series };
  }],

  ['GET', /^\/api\/markets$/, () => Object.entries(MARKETS).map(([id, spec]) => ({ id, ...spec }))],

  ['GET', /^\/api\/archetypes$/, () => Object.entries(ARCHETYPES).map(([id, a]) => ({ id, label: a.label }))],

  // One campaign, hour by hour: warm a curve from this market, price the campaign from it, run it.
  ['POST', /^\/api\/simulate\/campaign$/, (_m, body) => {
    try {
      return simulateOneCampaign(body);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }],

  // Publisher game: join a campaign, deliver impressions six hours at a time, get paid at close.
  ['GET', /^\/api\/game\/offers$/, () => game.listOffers()],
  ['POST', /^\/api\/game\/offers$/, () => game.refreshOffers()],
  ['POST', /^\/api\/game\/join$/, (_m, body) => {
    try {
      return game.join(body.offerId, body.publisher || 'you');
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }],
  ['GET', /^\/api\/game\/([\w-]+)$/, (m) => {
    try {
      return game.view(m[1]);
    } catch (err) {
      throw new HttpError(404, err.message);
    }
  }],
  ['POST', /^\/api\/game\/([\w-]+)\/step$/, (m, body) => {
    try {
      return game.step(m[1], body.impressions);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }],
  ['POST', /^\/api\/game\/([\w-]+)\/settle$/, (m) => {
    try {
      return game.settle(m[1]);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }],
];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(__dirname, '..', 'public', file);
  if (!full.startsWith(path.join(__dirname, '..', 'public'))) return send(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : 'text/plain';
    res.writeHead(200, { 'content-type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
    }
    for (const [method, pattern, handler] of routes) {
      const match = url.pathname.match(pattern);
      if (match && req.method === method) {
        try {
          return send(res, 200, handler(match, body));
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 500;
          if (status === 500) console.error(err);
          return send(res, status, { error: err.message });
        }
      }
    }
    send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  CPI market running at http://localhost:${PORT}\n`);
    console.log('  POST /api/campaigns              { budget, wantedCpi, durationHours }');
    console.log('  POST /api/campaigns/:id/join     { publisher }');
    console.log('  POST /api/campaigns/:id/mint     { publisher, impressions }');
    console.log('  POST /api/campaigns/:id/settle');
    console.log('  GET  /api/market                 learned supply curve');
    console.log('  POST /api/market/seed            { market, campaigns }');
    console.log('  POST /api/simulate               { market, campaigns }');
    console.log('  POST /api/simulate/campaign      { budget, expectedCpi, durationDays, archetype }\n');
  });
}

module.exports = { server, market };
