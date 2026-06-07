/**
 * Phase 1/2 regression tests for Evil Panda paper strategy support.
 *
 * Run: node test/test-evil-panda.js
 */

import assert from "node:assert/strict";
import fs from "node:fs";

async function main() {
  const strategyLibrary = JSON.parse(fs.readFileSync("strategy-library.json", "utf8"));
  const preset = strategyLibrary.strategies?.evil_panda_safe_v1;

  assert.ok(preset, "strategy-library.json must include evil_panda_safe_v1 preset");
  assert.equal(preset.id, "evil_panda_safe_v1");
  assert.equal(preset.paper_only_until_verified, true);
  assert.equal(preset.lp_strategy, "spot");
  assert.equal(preset.entry.single_side, "sol");
  assert.equal(preset.entry.timeframe, "15m");
  assert.equal(preset.entry.condition, "supertrend_break_above");
  assert.equal(preset.range.type, "single_side_sol_downside_pct");
  assert.equal(preset.range.default_downside_pct, 86);
  assert.equal(preset.range.max_downside_pct, 94);
  assert.equal(preset.exit.rsi_length, 2);
  assert.equal(preset.exit.rsi_overbought, 90);
  assert.deepEqual(preset.exit.confluence_any, ["close_above_bollinger_upper", "macd_histogram_first_green"]);
  assert.equal(preset.token_criteria.min_mcap, 250000);
  assert.equal(preset.token_criteria.min_volume_24h, 1000000);
  assert.equal(preset.token_criteria.max_top10_pct, 30);
  assert.equal(preset.risk.max_positions, 1);

  const evil = await import(`../evil-panda.js?test=${Date.now()}`);
  assert.equal(evil.EVIL_PANDA_PRESET_ID, "evil_panda_safe_v1");

  assert.equal(evil.binsBelowForDownside(100, 86), 198, "100 bin step should need ~198 bins for -86% coverage");
  assert.equal(evil.binsBelowForDownside(80, 86), 247, "80 bin step should need ~247 bins for -86% coverage");
  assert.equal(evil.binsBelowForDownside(125, 94), 226, "125 bin step should need ~226 bins for -94% coverage");

  assert.equal(evil.isEvilPandaCandidateEligible({
    mcap: 250000,
    volume_24h: 1000000,
    token_fees_sol: 30,
    top10_pct: 30,
    insider_pct: 10,
    phishing_pct: 30,
    bundle_pct: 60,
    bin_step: 100,
    has_profile_image: true,
  }), true);

  assert.equal(evil.isEvilPandaCandidateEligible({
    mcap: 249999,
    volume_24h: 1000000,
    token_fees_sol: 30,
    top10_pct: 30,
    insider_pct: 10,
    phishing_pct: 30,
    bundle_pct: 60,
    bin_step: 100,
    has_profile_image: true,
  }), false, "candidate below min market cap should be rejected");

  assert.equal(evil.evaluateEvilPandaEntry([
    { close: 9.8, supertrend: 10.0 },
    { close: 10.4, supertrend: 10.1 },
  ]).shouldEnter, true, "entry requires close crossing above supertrend");

  assert.equal(evil.evaluateEvilPandaEntry([
    { close: 10.2, supertrend: 10.0 },
    { close: 10.4, supertrend: 10.1 },
  ]).shouldEnter, false, "already-above supertrend is not a fresh break");

  assert.deepEqual(evil.evaluateEvilPandaExit({
    close: 12,
    bollingerUpper: 11,
    rsi2: 91,
    macdHistogram: -0.02,
    previousMacdHistogram: -0.03,
  }), {
    shouldExit: true,
    reason: "evil panda exit: RSI(2)>90 + close above Bollinger upper",
  });

  assert.deepEqual(evil.evaluateEvilPandaExit({
    close: 10,
    bollingerUpper: 11,
    rsi2: 91,
    macdHistogram: 0.01,
    previousMacdHistogram: -0.01,
  }), {
    shouldExit: true,
    reason: "evil panda exit: RSI(2)>90 + MACD histogram first green",
  });

  assert.equal(evil.evaluateEvilPandaExit({
    close: 12,
    bollingerUpper: 11,
    rsi2: 89,
    macdHistogram: 0.01,
    previousMacdHistogram: -0.01,
  }).shouldExit, false, "exit requires RSI(2)>90 confluence");

  assert.deepEqual(evil.applyEvilPandaDeployDefaults({ pool_address: "pool-test", bin_step: 100 }, { deployAmountSol: 0.1 }), {
    pool_address: "pool-test",
    bin_step: 100,
    strategy_preset: "evil_panda_safe_v1",
    strategy: "spot",
    amount_x: 0,
    amount_y: 0.1,
    bins_above: 0,
    downside_pct: 86,
    evil_panda_bins_below_estimate: 198,
  });

  console.log("✅ evil panda phase 1/2 preset and paper helpers are wired");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
