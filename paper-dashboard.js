import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";

export const METEORA_DLMM_API = "https://dlmm.datapi.meteora.ag";
export const DEFAULT_STATE_PATH = "./paper-positions.json";

function readState(statePath = DEFAULT_STATE_PATH) {
  if (!fs.existsSync(statePath)) return { positions: {} };
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return +n.toFixed(digits);
}

function pct(numerator, denominator, digits = 2) {
  const a = Number(numerator);
  const b = Number(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return round((a / b) * 100, digits);
}

function durationHours(position, now) {
  const start = Number(position.entry_timestamp ?? 0);
  const end = Number(position.last_candle_timestamp ?? now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round((end - start) / 3600, 2);
}

function rangeStatus(position) {
  if (position.status !== "open") return "closed";
  const last = Number(position.last_price);
  const lower = Number(position.lower_price);
  const upper = Number(position.upper_price);
  if (![last, lower, upper].every(Number.isFinite)) return "unknown";
  if (last < lower) return "below_range";
  if (last > upper) return "above_range";
  return "in_range";
}

function normalizeCandle(candle) {
  return {
    timestamp: Number(candle.timestamp),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume ?? 0),
  };
}

async function fetchCandles({ poolAddress, fromTimestamp, toTimestamp, timeframe, fetchFn }) {
  const url = `${METEORA_DLMM_API}/pools/${poolAddress}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&start_time=${fromTimestamp}&end_time=${toTimestamp}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`OHLCV fetch failed for ${poolAddress}: ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map(normalizeCandle).filter((c) => Number.isFinite(c.timestamp));
}

function positionToDashboard(position, candles, now) {
  const deposit = Number(position.deposit_amount ?? position.deposit ?? 0);
  const netPnl = Number(position.net_pnl ?? 0);
  const fees = Number(position.fees_earned ?? 0);
  const il = Number(position.il_usd ?? 0);
  const lower = Number(position.lower_price ?? 0);
  const upper = Number(position.upper_price ?? 0);
  const last = Number(position.last_price ?? 0);
  const candleTimes = candles.map((c) => new Date(c.timestamp * 1000).toISOString());

  return {
    id: position.id,
    pool: position.pool_name ?? position.pool ?? position.pool_address?.slice(0, 8),
    pair: position.pair ?? position.pool_name ?? "Unknown",
    pool_address: position.pool_address,
    status: position.status ?? "unknown",
    strategy: position.strategy_type ?? position.strategy ?? null,
    strategy_preset: position.strategy_preset ?? null,
    entry_signal: position.entry_signal ?? null,
    exit_signal: position.exit_signal ?? null,
    deposit: round(deposit, 4),
    fees_earned: round(fees, 4),
    il_usd: round(il, 4),
    net_pnl: round(netPnl, 4),
    pnl_pct: pct(netPnl, deposit, 2),
    range: { lower, upper },
    entry_price: Number(position.entry_price ?? 0),
    last_price: last,
    distance_to_lower_pct: pct(last - lower, last, 2),
    distance_to_upper_pct: pct(upper - last, last, 2),
    range_status: rangeStatus(position),
    opened_at: position.opened_at ?? null,
    closed_at: position.closed_at ?? null,
    duration_hours: durationHours(position, now),
    in_range_pct: pct(position.candles_in_range ?? 0, position.candles_total ?? 0, 1),
    candles_total: Number(position.candles_total ?? 0),
    candles_in_range: Number(position.candles_in_range ?? 0),
    close_rule: position.close_rule ?? null,
    close_reason: position.close_reason ?? null,
    candles,
    chart_series: {
      labels: candleTimes,
      price: candles.map((c) => c.close),
      range_lower: candles.map(() => lower),
      range_upper: candles.map(() => upper),
      volume: candles.map((c) => c.volume),
    },
  };
}

export async function buildPaperDashboardData({
  statePath = DEFAULT_STATE_PATH,
  fetchFn = globalThis.fetch,
  now = Math.floor(Date.now() / 1000),
  timeframe = "5m",
  lookbackHours = 6,
  candleLimit = 72,
  includeClosedCandles = false,
} = {}) {
  if (typeof fetchFn !== "function") throw new Error("fetch is required to load dashboard candles");

  const state = readState(statePath);
  const rawPositions = Object.values(state.positions ?? {}).sort((a, b) => Number(b.entry_timestamp ?? 0) - Number(a.entry_timestamp ?? 0));
  const positions = [];

  for (const position of rawPositions) {
    let candles = [];
    if (position.pool_address && (position.status === "open" || includeClosedCandles)) {
      const fromTimestamp = Math.max(0, now - Math.round(lookbackHours * 3600));
      try {
        candles = await fetchCandles({
          poolAddress: position.pool_address,
          fromTimestamp,
          toTimestamp: now,
          timeframe,
          fetchFn,
        });
        candles = candles.slice(-candleLimit);
      } catch (error) {
        candles = [];
        position.dashboard_error = error.message;
      }
    }
    const rendered = positionToDashboard(position, candles, now);
    if (position.dashboard_error) rendered.dashboard_error = position.dashboard_error;
    positions.push(rendered);
  }

  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const summary = {
    generated_at: new Date(now * 1000).toISOString(),
    open_count: open.length,
    closed_count: closed.length,
    total_count: positions.length,
    total_open_deposit: round(open.reduce((sum, p) => sum + p.deposit, 0), 4),
    total_open_net_pnl: round(open.reduce((sum, p) => sum + p.net_pnl, 0), 4),
    total_open_fees: round(open.reduce((sum, p) => sum + p.fees_earned, 0), 4),
    total_open_il: round(open.reduce((sum, p) => sum + p.il_usd, 0), 4),
    open_in_range: open.filter((p) => p.range_status === "in_range").length,
    open_out_of_range: open.filter((p) => ["below_range", "above_range"].includes(p.range_status)).length,
  };
  summary.total_open_pnl_pct = pct(summary.total_open_net_pnl, summary.total_open_deposit, 2);

  return { summary, positions };
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(4)}`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

export function renderPaperDashboardHtml(data) {
  const safeJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const positionCards = data.positions.map((p) => `
    <article class="card position ${esc(p.range_status)}">
      <div class="position-head">
        <div>
          <p class="eyebrow">${esc(p.status)} · ${esc(p.strategy || "-")}${p.strategy_preset ? ` · ${esc(p.strategy_preset)}` : ""}</p>
          <h2>${esc(p.pair)}</h2>
          <p class="muted">${esc(p.id)}</p>
        </div>
        <div class="pnl ${p.net_pnl >= 0 ? "positive" : "negative"}">${money(p.net_pnl)} <span>${p.pnl_pct ?? 0}%</span></div>
      </div>
      <div class="metrics-grid">
        <div><span>Deposit</span><strong>${money(p.deposit)}</strong></div>
        <div><span>Fees</span><strong>${money(p.fees_earned)}</strong></div>
        <div><span>IL</span><strong>${money(p.il_usd)}</strong></div>
        <div><span>In range</span><strong>${p.in_range_pct ?? "n/a"}%</strong></div>
        <div><span>Last price</span><strong>${p.last_price || "n/a"}</strong></div>
        <div><span>Range</span><strong>${p.range.lower} – ${p.range.upper}</strong></div>
      </div>
      <div class="status-line ${esc(p.range_status)}">${esc(p.range_status.replaceAll("_", " "))}${p.close_reason ? ` · ${esc(p.close_reason)}` : ""}</div>
      ${p.candles.length > 0 ? `<canvas id="${esc(p.id)}-chart" height="120"></canvas>` : `<p class="muted">No recent candle chart loaded for this ${esc(p.status)} position.</p>`}
      ${p.dashboard_error ? `<p class="warning">Chart fetch error: ${esc(p.dashboard_error)}</p>` : ""}
    </article>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Meridian Paper Trade Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root { color-scheme: dark; --bg:#08111f; --panel:#111c2e; --panel2:#16243a; --text:#e7eefc; --muted:#8fa4c2; --green:#46d887; --red:#ff5d73; --yellow:#ffd166; --blue:#63a8ff; --line:#253650; }
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top left,#19365c 0,#08111f 38%,#060a12 100%);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);}
    main{width:min(1180px,94vw);margin:32px auto 56px}.hero{display:flex;gap:20px;justify-content:space-between;align-items:flex-end;margin-bottom:20px}.eyebrow{margin:0 0 6px;color:var(--blue);text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700}.hero h1{margin:0;font-size:clamp(28px,4vw,48px);letter-spacing:-.04em}.muted{color:var(--muted);font-size:13px}.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.09);box-shadow:0 20px 60px rgba(0,0,0,.28);border-radius:22px;padding:18px}.summary .card span,.metrics-grid span{display:block;color:var(--muted);font-size:12px}.summary .card strong{display:block;font-size:24px;margin-top:4px}.positions{display:grid;grid-template-columns:1fr;gap:18px}.position-head{display:flex;justify-content:space-between;gap:18px;margin-bottom:12px}.position h2{margin:0;font-size:26px}.pnl{text-align:right;font-size:28px;font-weight:800}.pnl span{display:block;font-size:13px;color:var(--muted)}.positive{color:var(--green)}.negative{color:var(--red)}.metrics-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:14px 0 12px}.metrics-grid div{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:10px}.metrics-grid strong{display:block;margin-top:4px;font-size:13px;word-break:break-word}.status-line{display:inline-flex;margin-bottom:12px;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.status-line.in_range{background:rgba(70,216,135,.12);color:var(--green)}.status-line.below_range,.status-line.above_range{background:rgba(255,93,115,.12);color:var(--red)}.status-line.closed{background:rgba(143,164,194,.12);color:var(--muted)}.warning{color:var(--yellow)}canvas{background:rgba(0,0,0,.15);border-radius:14px;padding:8px}@media(max-width:900px){.summary,.metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero,.position-head{display:block}.pnl{text-align:left;margin-top:12px}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">Meridian</p>
        <h1>Paper Trade Dashboard</h1>
        <p class="muted">Generated ${esc(data.summary.generated_at)} · auto-refresh every 60s</p>
      </div>
      <p class="muted">Source: local paper-positions.json + Meteora DLMM OHLCV 5m</p>
    </section>
    <section class="summary">
      <div class="card"><span>Open</span><strong>${data.summary.open_count}</strong></div>
      <div class="card"><span>Closed</span><strong>${data.summary.closed_count}</strong></div>
      <div class="card"><span>Open Deposit</span><strong>${money(data.summary.total_open_deposit)}</strong></div>
      <div class="card"><span>Open Net PnL</span><strong class="${data.summary.total_open_net_pnl >= 0 ? "positive" : "negative"}">${money(data.summary.total_open_net_pnl)}</strong></div>
      <div class="card"><span>Fees</span><strong>${money(data.summary.total_open_fees)}</strong></div>
      <div class="card"><span>Out of range</span><strong>${data.summary.open_out_of_range}</strong></div>
    </section>
    <section class="positions">${positionCards || `<div class="card"><h2>No paper positions yet</h2><p class="muted">Open a paper position first, then refresh this dashboard.</p></div>`}</section>
  </main>
  <script id="dashboard-data" type="application/json">${safeJson}</script>
  <script>
    const dashboard = JSON.parse(document.getElementById('dashboard-data').textContent);
    const css = getComputedStyle(document.documentElement);
    for (const p of dashboard.positions) {
      const el = document.getElementById(p.id + '-chart');
      if (!el || !p.chart_series || p.chart_series.price.length === 0) continue;
      new Chart(el, { type: 'line', data: { labels: p.chart_series.labels, datasets: [
        { label: 'Price', data: p.chart_series.price, borderColor: css.getPropertyValue('--blue').trim(), backgroundColor: 'rgba(99,168,255,.12)', tension: .25, pointRadius: 0 },
        { label: 'Range lower', data: p.chart_series.range_lower, borderColor: css.getPropertyValue('--red').trim(), borderDash: [6,6], pointRadius: 0 },
        { label: 'Range upper', data: p.chart_series.range_upper, borderColor: css.getPropertyValue('--green').trim(), borderDash: [6,6], pointRadius: 0 }
      ]}, options: { responsive: true, interaction: { mode:'index', intersect:false }, plugins: { legend: { labels: { color:'#e7eefc' } } }, scales: { x: { ticks: { color:'#8fa4c2', maxTicksLimit: 8 }, grid: { color:'rgba(255,255,255,.06)' } }, y: { ticks: { color:'#8fa4c2' }, grid: { color:'rgba(255,255,255,.06)' } } } } });
    }
    setTimeout(() => location.reload(), 60000);
  </script>
</body>
</html>`;
}

export async function startPaperDashboardServer({ port = Number(process.env.PAPER_DASHBOARD_PORT ?? 8787), host = process.env.PAPER_DASHBOARD_HOST ?? "127.0.0.1", statePath = DEFAULT_STATE_PATH } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/api/paper-dashboard") {
        const data = await buildPaperDashboardData({ statePath });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(data, null, 2));
        return;
      }
      if (url.pathname === "/" || url.pathname === "/paper") {
        const data = await buildPaperDashboardData({ statePath });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(renderPaperDashboardHtml(data));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error.stack || error.message);
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--once") ? "once" : "server";
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : "./paper-dashboard.html";

  if (mode === "once") {
    const data = await buildPaperDashboardData();
    fs.writeFileSync(outPath, renderPaperDashboardHtml(data));
    console.log(`Paper dashboard written to ${outPath}`);
    return;
  }

  const server = await startPaperDashboardServer();
  const address = server.address();
  console.log(`Paper dashboard running at http://${address.address}:${address.port}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
