/**
 * Regression tests for live-trading safety guards.
 * These are pure/early guards: no RPC, wallet signing, or transaction submit should be needed.
 */

import assert from "node:assert/strict";

async function testLiveKillSwitch() {
  const { assertLiveTradingAllowed } = await import(`../safety.js?live_safety_test=${Date.now()}`);

  const originalDryRun = process.env.DRY_RUN;
  const originalEnabled = process.env.LIVE_TRADING_ENABLED;
  const originalAllowedWallet = process.env.LIVE_ALLOWED_WALLET;

  try {
    process.env.DRY_RUN = "true";
    delete process.env.LIVE_TRADING_ENABLED;
    assert.throws(
      () => assertLiveTradingAllowed("unit-test", "wallet-a"),
      /DRY_RUN=true/i,
    );

    process.env.DRY_RUN = "false";
    delete process.env.LIVE_TRADING_ENABLED;
    assert.throws(
      () => assertLiveTradingAllowed("unit-test", "wallet-a"),
      /LIVE_TRADING_ENABLED=true/i,
    );

    process.env.LIVE_TRADING_ENABLED = "true";
    process.env.LIVE_ALLOWED_WALLET = "wallet-b";
    assert.throws(
      () => assertLiveTradingAllowed("unit-test", "wallet-a"),
      /not the allowed live wallet/i,
    );

    assert.doesNotThrow(() => assertLiveTradingAllowed("unit-test", "wallet-b"));
  } finally {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    if (originalEnabled === undefined) delete process.env.LIVE_TRADING_ENABLED;
    else process.env.LIVE_TRADING_ENABLED = originalEnabled;
    if (originalAllowedWallet === undefined) delete process.env.LIVE_ALLOWED_WALLET;
    else process.env.LIVE_ALLOWED_WALLET = originalAllowedWallet;
  }
}

async function testRiskConfigLockedFromAgentTool() {
  const { executeTool } = await import(`../tools/executor.js?live_safety_test=${Date.now()}`);

  const result = await executeTool("update_config", {
    changes: { maxDeployAmount: 999, lpAgentRelayEnabled: true },
    reason: "unit test should be blocked",
  });

  assert.equal(result.success, false);
  assert.match(result.error, /locked.*manual/i);
  assert.deepEqual(result.locked.sort(), ["lpAgentRelayEnabled", "maxDeployAmount"].sort());
}

async function testSwapPolicyIsTokenToSolOnlyAndBalanceBounded() {
  const { validateLiveSwapRequest } = await import(`../tools/wallet.js?live_safety_test=${Date.now()}`);

  assert.throws(
    () => validateLiveSwapRequest({
      input_mint: "So11111111111111111111111111111111111111112",
      output_mint: "TOKEN",
      amount: 1,
      balances: { tokens: [] },
    }),
    /only allowed to swap non-SOL tokens back to SOL/i,
  );

  assert.throws(
    () => validateLiveSwapRequest({
      input_mint: "TOKEN",
      output_mint: "USDC",
      amount: 1,
      balances: { tokens: [{ mint: "TOKEN", balance: 2 }] },
    }),
    /only allowed to swap non-SOL tokens back to SOL/i,
  );

  assert.throws(
    () => validateLiveSwapRequest({
      input_mint: "TOKEN",
      output_mint: "So11111111111111111111111111111111111111112",
      amount: 3,
      balances: { tokens: [{ mint: "TOKEN", balance: 2 }] },
    }),
    /exceeds wallet balance/i,
  );

  assert.doesNotThrow(() => validateLiveSwapRequest({
    input_mint: "TOKEN",
    output_mint: "So11111111111111111111111111111111111111112",
    amount: 2,
    balances: { tokens: [{ mint: "TOKEN", balance: 2 }] },
  }));
}

async function testCloseClaimPositionOwnershipPureGuard() {
  const { assertPositionInWalletPositions } = await import(`../tools/dlmm.js?live_safety_test=${Date.now()}`);

  assert.throws(
    () => assertPositionInWalletPositions("missing-position", { positions: [] }),
    /not found in this wallet/i,
  );

  assert.doesNotThrow(() => assertPositionInWalletPositions("owned-position", {
    positions: [{ position: "owned-position" }],
  }));
}

async function main() {
  await testLiveKillSwitch();
  await testRiskConfigLockedFromAgentTool();
  await testSwapPolicyIsTokenToSolOnlyAndBalanceBounded();
  await testCloseClaimPositionOwnershipPureGuard();
  console.log("✅ live safety guards block unsafe live trade paths");
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
