/**
 * Regression tests for hard post-loss guards.
 * These guards must live in code/config, not only in LLM prompt/learning text.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { repoPath } from "../repo-root.js";

const MEMORY_PATH = repoPath("pool-memory.json");

function readMemory() {
  return fs.existsSync(MEMORY_PATH)
    ? JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"))
    : {};
}

function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

async function withIsolatedPoolMemory(fn) {
  const existed = fs.existsSync(MEMORY_PATH);
  const backup = existed ? fs.readFileSync(MEMORY_PATH, "utf8") : null;
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify({}, null, 2));
    await fn();
  } finally {
    if (existed) fs.writeFileSync(MEMORY_PATH, backup);
    else if (fs.existsSync(MEMORY_PATH)) fs.unlinkSync(MEMORY_PATH);
  }
}

function baseDeploy(overrides = {}) {
  return {
    pool_name: "UNIT-SOL",
    base_mint: "UNIT_BASE_MINT",
    deployed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    closed_at: new Date().toISOString(),
    pnl_pct: 0,
    pnl_usd: 0,
    fees_earned_usd: 0,
    fees_earned_sol: 0,
    fee_earned_pct: 0,
    range_efficiency: 100,
    minutes_held: 60,
    close_reason: "manual",
    strategy: "bid_ask",
    volatility: 2,
    ...overrides,
  };
}

async function testConfigHardFloors() {
  const { config } = await import(`../config.js?post_loss_guard_test=${Date.now()}`);
  assert.equal(config.management.stopLossPct, -10, "live stop-loss should be tightened to -10%");
  assert.ok(
    Number(config.screening.minFeeActiveTvlRatio) >= 2.5,
    "entry fee/active-TVL floor should reject weak 1–2% pools before the LLM sees them",
  );
}

async function testLowYieldLossBlocksPoolAndTokenFor12h() {
  await withIsolatedPoolMemory(async () => {
    const { recordPoolDeploy, isPoolOnCooldown, isBaseMintOnCooldown } = await import(`../pool-memory.js?low_yield_loss_test=${Date.now()}`);
    recordPoolDeploy("LOW_YIELD_POOL", baseDeploy({
      pool_name: "LOWYIELD-SOL",
      base_mint: "LOW_YIELD_MINT",
      close_reason: "low yield",
      pnl_pct: -1.7,
      pnl_usd: -0.11,
    }));

    const entry = readMemory().LOW_YIELD_POOL;
    assert.equal(isPoolOnCooldown("LOW_YIELD_POOL"), true);
    assert.equal(isBaseMintOnCooldown("LOW_YIELD_MINT"), true);
    assert.match(entry.cooldown_reason, /low yield.*loss/i);
    assert.match(entry.base_mint_cooldown_reason, /low yield.*loss/i);
    assert.ok(hoursUntil(entry.cooldown_until) > 11.5 && hoursUntil(entry.cooldown_until) <= 12.1);
    assert.ok(hoursUntil(entry.base_mint_cooldown_until) > 11.5 && hoursUntil(entry.base_mint_cooldown_until) <= 12.1);
  });
}

async function testStopLossBlocksPoolAndTokenFor24h() {
  await withIsolatedPoolMemory(async () => {
    const { recordPoolDeploy, isPoolOnCooldown, isBaseMintOnCooldown } = await import(`../pool-memory.js?stop_loss_test=${Date.now()}`);
    recordPoolDeploy("STOP_POOL", baseDeploy({
      pool_name: "STOP-SOL",
      base_mint: "STOP_MINT",
      close_reason: "stop loss",
      pnl_pct: -17.92,
      pnl_usd: -1.19,
    }));

    const entry = readMemory().STOP_POOL;
    assert.equal(isPoolOnCooldown("STOP_POOL"), true);
    assert.equal(isBaseMintOnCooldown("STOP_MINT"), true);
    assert.match(entry.cooldown_reason, /stop loss/i);
    assert.match(entry.base_mint_cooldown_reason, /stop loss/i);
    assert.ok(hoursUntil(entry.cooldown_until) > 23.5 && hoursUntil(entry.cooldown_until) <= 24.1);
    assert.ok(hoursUntil(entry.base_mint_cooldown_until) > 23.5 && hoursUntil(entry.base_mint_cooldown_until) <= 24.1);
  });
}

async function testTwoLossesSamePoolWithin24hBlocksFor48h() {
  await withIsolatedPoolMemory(async () => {
    const { recordPoolDeploy, isPoolOnCooldown, isBaseMintOnCooldown } = await import(`../pool-memory.js?two_loss_test=${Date.now()}`);
    recordPoolDeploy("REPEAT_LOSS_POOL", baseDeploy({
      pool_name: "REPEATLOSS-SOL",
      base_mint: "REPEAT_LOSS_MINT",
      closed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      pnl_pct: -1,
      pnl_usd: -0.05,
      close_reason: "manual close",
    }));
    recordPoolDeploy("REPEAT_LOSS_POOL", baseDeploy({
      pool_name: "REPEATLOSS-SOL",
      base_mint: "REPEAT_LOSS_MINT",
      pnl_pct: -2,
      pnl_usd: -0.10,
      close_reason: "out of range",
    }));

    const entry = readMemory().REPEAT_LOSS_POOL;
    assert.equal(isPoolOnCooldown("REPEAT_LOSS_POOL"), true);
    assert.equal(isBaseMintOnCooldown("REPEAT_LOSS_MINT"), true);
    assert.match(entry.cooldown_reason, /2 losses.*24h/i);
    assert.match(entry.base_mint_cooldown_reason, /2 losses.*24h/i);
    assert.ok(hoursUntil(entry.cooldown_until) > 47.5 && hoursUntil(entry.cooldown_until) <= 48.1);
  });
}

async function main() {
  await testConfigHardFloors();
  await testLowYieldLossBlocksPoolAndTokenFor12h();
  await testStopLossBlocksPoolAndTokenFor24h();
  await testTwoLossesSamePoolWithin24hBlocksFor48h();
  console.log("✅ hard post-loss guards enforce cooldowns and live thresholds");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
