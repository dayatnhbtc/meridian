import assert from "node:assert/strict";

function makePool({ tvl, mcap, volume = 1000, volatility = 2.5, feeActiveTvlRatio = 1 }) {
  return {
    pool_address: "UNIT_POOL",
    name: "UNIT-SOL",
    pool_type: "dlmm",
    tvl,
    active_tvl: tvl,
    volume,
    volatility,
    fee_active_tvl_ratio: feeActiveTvlRatio,
    base_token_holders: 1000,
    base_token_has_high_supply_concentration: false,
    base_token_has_critical_warnings: false,
    quote_token_has_critical_warnings: false,
    base_token_has_high_single_ownership: false,
    dlmm_params: { bin_step: 100 },
    token_x: {
      symbol: "UNIT",
      address: "UNIT_MINT",
      market_cap: mcap,
      organic_score: 80,
    },
    token_y: {
      symbol: "SOL",
      address: "So11111111111111111111111111111111111111112",
      organic_score: 90,
    },
  };
}

async function testTvlMcapRiskClassification() {
  const { evaluateTvlMcapRisk } = await import(`../tools/screening.js?tvl_mcap_risk=${Date.now()}`);

  assert.deepEqual(evaluateTvlMcapRisk({ tvl: 50_000, mcap: 500_000, volatility: 2.5 }), {
    ratio: 0.1,
    ratioPct: 10,
    requiredTvl: 50_000,
    level: "ok",
    hardReject: false,
    reason: null,
  });

  const highRisk = evaluateTvlMcapRisk({ tvl: 16_512.85, mcap: 336_838.38, volatility: 3.1276 });
  assert.equal(highRisk.level, "high");
  assert.equal(highRisk.hardReject, false, "3–5% TVL/mcap should warn/penalize, not hard reject by itself");
  assert.match(highRisk.reason, /TVL\/mcap 4\.90% below preferred 10%/);

  const hardReject = evaluateTvlMcapRisk({ tvl: 11_095.98, mcap: 529_650.05, volatility: 3.4165 });
  assert.equal(hardReject.level, "critical");
  assert.equal(hardReject.hardReject, true, "<3% TVL/mcap with volatility >3 should be hard rejected");
  assert.match(hardReject.reason, /TVL\/mcap 2\.09%.*volatility 3\.42/);
}

async function testRawScreeningRejectsThinHighVolatilityPools() {
  const { getRawPoolScreeningRejectReason } = await import(`../tools/screening.js?raw_tvl_mcap_gate=${Date.now()}`);
  const { config } = await import(`../config.js?raw_tvl_mcap_gate=${Date.now()}`);

  const reason = getRawPoolScreeningRejectReason(
    makePool({ tvl: 11_095.98, mcap: 529_650.05, volatility: 3.4165 }),
    config.screening,
  );
  assert.match(reason, /TVL\/mcap 2\.09%.*hardRejectTvlMcapRatio 3%/);
}

async function testRawScreeningKeepsThinButNotCriticalPoolsForLlmPenalty() {
  const { getRawPoolScreeningRejectReason, condensePool } = await import(`../tools/screening.js?raw_tvl_mcap_penalty=${Date.now()}`);
  const { config } = await import(`../config.js?raw_tvl_mcap_penalty=${Date.now()}`);

  const slabLike = makePool({ tvl: 16_512.85, mcap: 336_838.38, volatility: 3.1276 });
  const reason = getRawPoolScreeningRejectReason(slabLike, config.screening);
  assert.equal(reason, null, "3–5% TVL/mcap should be passed to LLM as high-risk, not filtered out here");

  const condensed = condensePool(slabLike);
  assert.equal(condensed.tvl_mcap_risk, "high");
  assert.equal(condensed.tvl_mcap_pct, 4.9);
  assert.match(condensed.tvl_mcap_reason, /below preferred 10%/);
}

async function main() {
  await testTvlMcapRiskClassification();
  await testRawScreeningRejectsThinHighVolatilityPools();
  await testRawScreeningKeepsThinButNotCriticalPoolsForLlmPenalty();
  console.log("✅ TVL/mcap risk gates classify, reject, and annotate candidates");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
