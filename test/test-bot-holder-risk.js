import assert from "node:assert/strict";
import { evaluateBotHolderRisk } from "../tools/screening.js";

const thresholds = {
  maxBotHoldersPct: 35,
  botHoldersCautionPct: 30,
  botHoldersCautionMinOrganic: 80,
  botHoldersCautionMaxTop10Pct: 20,
  botHoldersCautionMinTvl: 100_000,
  botHoldersCautionMinFeeActiveTvlRatio: 1.0,
};

assert.deepEqual(
  evaluateBotHolderRisk({ botPct: 29.9 }, thresholds),
  { level: "ok", reject: false, reason: null },
);

const bountyworkLike = evaluateBotHolderRisk({
  botPct: "31.97",
  organic: 88,
  top10Pct: "14.5",
  tvl: 138_874,
  feeActiveTvlRatio: 1.25,
}, thresholds);
assert.equal(bountyworkLike.level, "caution_pass");
assert.equal(bountyworkLike.reject, false);

const highBots = evaluateBotHolderRisk({
  botPct: 35.01,
  organic: 95,
  top10Pct: 10,
  tvl: 300_000,
  feeActiveTvlRatio: 2,
}, thresholds);
assert.equal(highBots.level, "critical");
assert.equal(highBots.reject, true);

const weakCaution = evaluateBotHolderRisk({
  botPct: 32,
  organic: 88,
  top10Pct: 25,
  tvl: 138_874,
  feeActiveTvlRatio: 1.25,
}, thresholds);
assert.equal(weakCaution.level, "caution_reject");
assert.equal(weakCaution.reject, true);
assert.match(weakCaution.reason, /top10 25% >= 20%/);

console.log("bot-holder risk tests passed");
