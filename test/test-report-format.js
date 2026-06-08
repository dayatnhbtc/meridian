import assert from "node:assert/strict";
import {
  formatPositionLine,
  formatPortfolioReport,
  formatScreeningSkipReport,
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
assert.match(line, /📈 PnL: 1\.56%/);
assert.match(line, /Fees: ◎0\.0393/);
assert.match(line, /Yield: 20\.87%/);
assert.match(line, /Age: 109m/);
assert.match(line, /\[[─●]+\]/);
assert.doesNotMatch(line, /▼/);
assert.match(line, /-570\s+-505\s+-470/);

const portfolio = formatPortfolioReport([position], new Map([["pos1", { action: "STAY" }]]), {
  solMode: true,
  intro: "No tool actions needed.",
  actionSummary: "no action",
});
assert.match(portfolio, /^No tool actions needed\./);
assert.match(portfolio, /Portfolio 💼 1 position/);
assert.match(portfolio, /Total: ◎2\.5004  Fees: ◎0\.0393/);
assert.match(portfolio, /<i>no action<\/i>/);
assert.doesNotMatch(portfolio, /\*no action\*/);

const skip = formatScreeningSkipReport({
  reason: "max positions reached",
  positions: [position],
  solMode: true,
  maxPositions: 1,
});
assert.match(skip, /🔍 Screening Cycle/);
assert.match(skip, /Skipped: max positions reached/);
assert.match(skip, /Portfolio 💼 1 position/);

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
assert.match(daily, /Realized: \+\$0\.73/);
assert.match(daily, /Open: \+\$0\.75/);
assert.match(daily, /Total: \+\$1\.48/);
assert.match(daily, /Bountywork-SOL/);
assert.doesNotMatch(daily, /\*\*/);

console.log("✅ report formatter renders compact Telegram reports");
