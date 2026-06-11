import assert from "node:assert/strict";
import {
  formatPositionLine,
  formatPortfolioReport,
  formatScreeningSkipReport,
  formatScreeningAgentReport,
  formatDailyPnlReport,
} from "../report-format.js";

const position = {
  pair: "Bountywork-SOL",
  total_value_usd: 2.5004,
  unclaimed_fees_usd: 0.0393,
  pnl_pct: 1.56,
  fee_per_tvl_24h: 20.87,
  age_minutes: 109,
  in_range: false,
  minutes_out_of_range: 17,
  lower_bin: -570,
  upper_bin: -470,
  active_bin: -505,
};

const line = formatPositionLine(position, { action: "STAY" }, { solMode: true });
assert.match(line, /<b>Bountywork-SOL<\/b>/);
assert.doesNotMatch(line, /\*\*Bountywork-SOL\*\*/);
assert.match(line, /🔴 OOR 17m/);
assert.match(line, /✅ STAY/);
assert.match(line, /Val: ◎2\.5004/);
assert.match(line, /PnL: \+\$0\.00 \(\+1\.56%\)/);
assert.match(line, /Fees: ◎0\.0393/);
assert.match(line, /Yield: 20\.87%/);
assert.match(line, /Age: 1h 49m/);
assert.match(line, /\[[─●]+\]/);
assert.doesNotMatch(line, /▼/);
assert.match(line, /-570\s+-505\s+-470/);

const portfolio = formatPortfolioReport([position], new Map([["pos1", { action: "STAY" }]]), {
  solMode: true,
  intro: "No tool actions needed.",
  actionSummary: "no action",
});
assert.match(portfolio, /^No tool actions needed\./);
assert.match(portfolio, /<b>Portfolio 💼<\/b>/);
assert.match(portfolio, /Positions: 1  Range: 0\/1 IN  Actions: ✅ all stay/);
assert.match(portfolio, /Value: ◎2\.5004  PnL: \+\$0\.00  Fees: ◎0\.0393/);
assert.match(portfolio, /<i>no action<\/i>/);
assert.doesNotMatch(portfolio, /\*no action\*/);

const skip = formatScreeningSkipReport({
  reason: "max positions reached",
  positions: [position],
  solMode: true,
  maxPositions: 1,
});
assert.match(skip, /🔍 <b>Screening Cycle<\/b>/);
assert.match(skip, /Skipped: max positions reached/);
assert.match(skip, /<b>Portfolio 💼<\/b>/);

const screening = formatScreeningAgentReport(`⛔ NO DEPLOY

Cycle finished with no valid entry.

BEST LOOKING CANDIDATE
BABYTROLL-SOL — barely survived disqualifiers.

WHY SKIPPED
PARQ was strongest but unsafe.

REJECTED
- **PARQ-SOL**: fees_sol=7 < 30
- HeavyPulp-SOL: \`fee/TVL\` 0.19`);
assert.match(screening, /⛔ <b>NO DEPLOY<\/b>/);
assert.match(screening, /<b>Best looking candidate<\/b>/);
assert.match(screening, /<b>Why skipped<\/b>/);
assert.match(screening, /<b>Rejected<\/b>/);
assert.match(screening, /• <b>PARQ-SOL<\/b>: fees_sol=7 &lt; 30/);
assert.match(screening, /<code>fee\/TVL<\/code>/);
assert.doesNotMatch(screening, /\*\*/);

const daily = formatDailyPnlReport({
  dateLabel: "2026-06-08 WIB",
  realizedPositions: [
    { pool_name: "Bountywork-SOL", pnl_usd: 1.23, pnl_pct: 2.4, fees_earned_usd: 0.45 },
    { pool_name: "Other-SOL", pnl_usd: -0.5, pnl_pct: -1.1, fees_earned_usd: 0.05 },
  ],
  openPositions: [
    { pair: "Open-SOL", pnl_usd: 0.75, pnl_pct: 1.5, unclaimed_fees_usd: 0.12 },
  ],
});
assert.match(daily, /📊 <b>PnL Hari Ini<\/b>/);
assert.match(daily, /2026-06-08 WIB/);
assert.match(daily, /🟢 Realized: <b>\+\$0\.73<\/b>/);
assert.match(daily, /🟢 Open: <b>\+\$0\.75<\/b>/);
assert.match(daily, /🟢 <b>Total: \+\$1\.48<\/b>/);
assert.match(daily, /Bountywork-SOL/);
assert.match(daily, /🔴 Other-SOL  <b>-\$0\.50<\/b>/);
assert.doesNotMatch(daily, /\*\*/);

const compactDaily = formatDailyPnlReport({
  title: "PnL Ringkas",
  dateLabel: "2026-06-08 WIB · detail: /pnltoday",
  realizedPositions: [
    { pool_name: "Bountywork-SOL", pnl_usd: 1.23, pnl_pct: 2.4, fees_earned_usd: 0.45 },
  ],
  openPositions: [],
  compact: true,
});
assert.match(compactDaily, /📊 <b>PnL Ringkas<\/b>/);
assert.match(compactDaily, /detail: \/pnltoday/);
assert.doesNotMatch(compactDaily, /Bountywork-SOL/);

const dailyLiveFields = formatDailyPnlReport({
  dateLabel: "2026-06-08 WIB",
  realizedPositions: [],
  openPositions: [
    {
      pair: "unc-SOL",
      pnl_usd: 0,
      pnl_true_usd: -0.0228,
      pnl_pct: 0,
      pnl_pct_derived: 0.1,
      unclaimed_fees_usd: 0,
      unclaimed_fees_true_usd: 0.0007,
    },
  ],
});
assert.match(dailyLiveFields, /🔴 Open: <b>-\$0\.02<\/b> \(1 open\)  Fees: 💵0\.00/);
assert.match(dailyLiveFields, /🔴 unc-SOL  <b>-\$0\.02<\/b>  \+0\.1%/);

const manyClosedDaily = formatDailyPnlReport({
  dateLabel: "2026-06-08 WIB",
  realizedPositions: Array.from({ length: 9 }, (_, i) => ({
    pool_name: i === 8 ? "LATEST-SOL" : `OLD${i + 1}-SOL`,
    pnl_usd: i,
    pnl_pct: i,
    fees_earned_usd: 0,
    closed_at: `2026-06-08T0${i}:00:00.000Z`,
  })),
  openPositions: [],
});
assert.match(manyClosedDaily, /LATEST-SOL/);
assert.doesNotMatch(manyClosedDaily, /OLD1-SOL/);

console.log("✅ report formatter renders compact Telegram reports");
