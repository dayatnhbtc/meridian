import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { buildPaperDashboardData, renderPaperDashboardHtml } from "../paper-dashboard.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-dashboard-"));
const statePath = path.join(tmpDir, "paper-positions.json");

const now = 1_780_820_000;
const openPosition = {
  id: "paper-open-1",
  pool_address: "PoolOpen1111111111111111111111111111111111",
  pool_name: "TEST-SOL",
  pair: "TEST-SOL",
  status: "open",
  strategy_type: "spot",
  strategy_preset: "evil_panda_safe_v1",
  deposit_amount: 100,
  entry_price: 1.0,
  lower_price: 0.8,
  upper_price: 1.2,
  opened_at: "2026-06-07T08:00:00.000Z",
  entry_timestamp: now - 3600,
  last_candle_timestamp: now - 600,
  last_price: 1.1,
  fees_earned: 1.5,
  il_usd: -0.4,
  net_pnl: 1.1,
  candles_total: 12,
  candles_in_range: 9,
};

const closedPosition = {
  ...openPosition,
  id: "paper-closed-1",
  status: "closed",
  pool_address: "PoolClosed111111111111111111111111111111111",
  deposit_amount: 50,
  net_pnl: -2,
  fees_earned: 0.2,
  il_usd: -2.2,
  closed_at: "2026-06-07T09:00:00.000Z",
};

fs.writeFileSync(statePath, JSON.stringify({ positions: { [openPosition.id]: openPosition, [closedPosition.id]: closedPosition } }, null, 2));

const requestedUrls = [];
const fetchFn = async (url) => {
  requestedUrls.push(url);
  assert(url.includes("/pools/PoolOpen1111111111111111111111111111111111/ohlcv"));
  assert(url.includes("timeframe=5m"));
  return {
    ok: true,
    async json() {
      return {
        data: [
          { timestamp: now - 900, open: 1.0, high: 1.08, low: 0.98, close: 1.05, volume: 1000 },
          { timestamp: now - 600, open: 1.05, high: 1.14, low: 1.04, close: 1.1, volume: 1400 },
        ],
      };
    },
  };
};

const dashboard = await buildPaperDashboardData({ statePath, fetchFn, now, candleLimit: 2 });

assert.equal(dashboard.summary.open_count, 1);
assert.equal(dashboard.summary.closed_count, 1);
assert.equal(dashboard.summary.total_open_deposit, 100);
assert.equal(dashboard.summary.total_open_net_pnl, 1.1);
assert.equal(dashboard.summary.total_open_fees, 1.5);
assert.equal(dashboard.positions.length, 2);

const renderedOpen = dashboard.positions.find((p) => p.id === openPosition.id);
assert.equal(renderedOpen.pnl_pct, 1.1);
assert.equal(renderedOpen.in_range_pct, 75);
assert.equal(renderedOpen.range_status, "in_range");
assert.equal(renderedOpen.candles.length, 2);
assert.equal(renderedOpen.candles[1].close, 1.1);
assert.equal(renderedOpen.chart_series.price.length, 2);
assert.equal(renderedOpen.chart_series.range_lower[0], 0.8);
assert.equal(renderedOpen.chart_series.range_upper[0], 1.2);
assert(requestedUrls.length === 1, "only open positions should fetch live candles by default");

const html = renderPaperDashboardHtml(dashboard);
assert(html.includes("Meridian Paper Trade Dashboard"));
assert(html.includes("TEST-SOL"));
assert(html.includes("chart.js"));
assert(html.includes("paper-open-1-chart"));
assert(html.includes("Range"));

console.log("✅ paper dashboard data shaping and HTML render are wired");
