import assert from "node:assert/strict";
import {
  formatPositionLine,
  formatPortfolioReport,
  formatScreeningSkipReport,
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

console.log("✅ report formatter renders compact Telegram reports");
