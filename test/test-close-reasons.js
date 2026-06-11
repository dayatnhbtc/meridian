import assert from "node:assert/strict";
import {
  classifyCloseReason,
  formatCloseReason,
  ensureCloseReasonLabel,
} from "../close-reasons.js";

function testClassifiesLegacyReasons() {
  assert.equal(classifyCloseReason("take profit: PnL +3.11%"), "TP");
  assert.equal(classifyCloseReason("Stop loss triggered: PnL -17.96% <= -15%"), "SL");
  assert.equal(classifyCloseReason("⚡ Trailing TP: peak 3.02% → current 1.44%"), "Trailing TP");
  assert.equal(classifyCloseReason("OOR: Out of range for 30m (limit: 30m)"), "OOR");
  assert.equal(classifyCloseReason("Low yield: fee/TVL 0.50% < min 7%"), "Low Yield");
  assert.equal(classifyCloseReason("agent decision"), "Manual");
}

function testFormatsDeterministicReasons() {
  assert.equal(
    formatCloseReason("TP", "PnL +3.11% >= takeProfitPct 3%"),
    "[TP] PnL +3.11% >= takeProfitPct 3%",
  );
  assert.equal(
    formatCloseReason("SL", "PnL -10.20% <= stopLossPct -10%"),
    "[SL] PnL -10.20% <= stopLossPct -10%",
  );
  assert.equal(
    formatCloseReason("OOR", "out of range 30m"),
    "[OOR] out of range 30m",
  );
}

function testNormalizesLegacyAndPreservesExistingLabels() {
  assert.equal(
    ensureCloseReasonLabel("take profit: PnL +3.11%"),
    "[TP] PnL +3.11%",
  );
  assert.equal(
    ensureCloseReasonLabel("Stop loss triggered: PnL -17.96% <= -15%. ⚡ Trailing TP exit alert."),
    "[SL] PnL -17.96% <= -15%",
  );
  assert.equal(
    ensureCloseReasonLabel("⚡ Trailing TP exit: Low yield fee/TVL 1.16% < min 7% (age: 60m). Immediate close."),
    "[Low Yield] fee/TVL 1.16% < min 7% (age: 60m). Immediate close.",
  );
  assert.equal(
    ensureCloseReasonLabel("OOR: Out of range for 30m (limit: 30m) — ⚡ Trailing TP exit alert"),
    "[OOR] Out of range for 30m (limit: 30m)",
  );
  assert.equal(
    ensureCloseReasonLabel("[TP] PnL +3.11%"),
    "[TP] PnL +3.11%",
  );
}

function main() {
  testClassifiesLegacyReasons();
  testFormatsDeterministicReasons();
  testNormalizesLegacyAndPreservesExistingLabels();
  console.log("✅ close reasons are labeled consistently");
}

main();
