/**
 * Regression test: paper simulator should apply deterministic close rules
 * comparable to live management, so DRY_RUN can test exit behavior.
 *
 * Run: node test/test-paper-autoclose.js
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makePosition(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "paper-test",
    pool_address: "pool-test",
    pool_name: "TEST-SOL",
    pair: "TEST-SOL",
    deposit_amount: 100,
    lower_price: 90,
    upper_price: 110,
    entry_price: 100,
    last_price: 100,
    entry_timestamp: now - 7200,
    last_candle_timestamp: now,
    fees_earned: 1,
    il_usd: 0,
    net_pnl: 1,
    candles_total: 24,
    candles_in_range: 20,
    status: "open",
    opened_at: new Date((now - 7200) * 1000).toISOString(),
    closed_at: null,
    ...overrides,
  };
}

async function main() {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-autoclose-"));

  try {
    process.chdir(tmp);
    process.env.DRY_RUN = "true";
    const mod = await import(`../paper-positions.js?paper_autoclose_test=${Date.now()}`);
    const { evaluatePaperCloseRule, applyPaperAutoClose } = mod;

    assert.equal(typeof evaluatePaperCloseRule, "function", "paper close evaluator must be exported");
    assert.equal(typeof applyPaperAutoClose, "function", "paper auto-close applier must be exported");

    const mgmt = {
      stopLossPct: -10,
      takeProfitPct: 5,
      outOfRangeWaitMinutes: 30,
      minFeePerTvl24h: 7,
      minAgeBeforeYieldCheck: 60,
    };

    assert.deepEqual(
      evaluatePaperCloseRule(makePosition({ net_pnl: -11 }), mgmt),
      { action: "CLOSE", rule: 1, reason: "stop loss" },
    );

    assert.deepEqual(
      evaluatePaperCloseRule(makePosition({ net_pnl: 6 }), mgmt),
      { action: "CLOSE", rule: 2, reason: "take profit" },
    );

    assert.deepEqual(
      evaluatePaperCloseRule(makePosition({ last_price: 89, net_pnl: 1 }), mgmt),
      { action: "CLOSE", rule: 3, reason: "out of range below" },
    );

    assert.deepEqual(
      evaluatePaperCloseRule(makePosition({ last_price: 111, net_pnl: 1 }), mgmt),
      { action: "CLOSE", rule: 4, reason: "out of range above" },
    );

    assert.deepEqual(
      evaluatePaperCloseRule(makePosition({ fees_earned: 0.001, net_pnl: 0.001 }), mgmt),
      { action: "CLOSE", rule: 5, reason: "low yield" },
    );

    assert.equal(
      evaluatePaperCloseRule(makePosition({ fees_earned: 1, net_pnl: 1, last_price: 100 }), mgmt),
      null,
      "healthy in-range productive paper position should stay open",
    );

    fs.writeFileSync("paper-positions.json", JSON.stringify({
      positions: {
        "paper-close-me": makePosition({ id: "paper-close-me", last_price: 89, net_pnl: 1 }),
        "paper-keep-me": makePosition({ id: "paper-keep-me", last_price: 100, net_pnl: 1, fees_earned: 1 }),
      },
    }, null, 2));

    const closed = applyPaperAutoClose(mgmt);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].id, "paper-close-me");
    assert.match(closed[0].close_reason, /out of range below/);

    const state = JSON.parse(fs.readFileSync("paper-positions.json", "utf8"));
    assert.equal(state.positions["paper-close-me"].status, "closed");
    assert.ok(state.positions["paper-close-me"].closed_at);
    assert.equal(state.positions["paper-keep-me"].status, "open");

    console.log("✅ paper auto-close applies deterministic live-style exit rules");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
