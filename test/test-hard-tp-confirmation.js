import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateFile = path.join(repoRoot, "state.json");

async function withStateFixture(fn) {
  const original = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8") : null;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      positions: {
        pos_tp: {
          position: "pos_tp",
          pool: "pool_tp",
          pool_name: "TEST-SOL",
          closed: false,
          notes: [],
        },
      },
      recentEvents: [],
      lastUpdated: null,
    }, null, 2));
    await fn();
  } finally {
    if (original == null) fs.rmSync(stateFile, { force: true });
    else fs.writeFileSync(stateFile, original);
  }
}

async function testHardTpRequiresConfirmationBeforeClose() {
  const originalLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "error";
  const {
    queueTakeProfitConfirmation,
    resolvePendingTakeProfit,
    consumeConfirmedTakeProfit,
  } = await import(`../state.js?hard_tp_test=${Date.now()}`);
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;

  assert.equal(queueTakeProfitConfirmation("pos_tp", 10.28, "[TP] PnL 10.28% >= takeProfitPct 5%"), true);

  assert.equal(
    consumeConfirmedTakeProfit("pos_tp"),
    null,
    "hard TP should not be consumable immediately after first tick",
  );

  const rejected = resolvePendingTakeProfit("pos_tp", 0.10, 0.85);
  assert.equal(rejected.confirmed, false, "one-tick TP spike should be rejected when recheck collapses");
  assert.equal(consumeConfirmedTakeProfit("pos_tp"), null);

  assert.equal(queueTakeProfitConfirmation("pos_tp", 8.00, "[TP] PnL 8.00% >= takeProfitPct 5%"), true);
  const confirmed = resolvePendingTakeProfit("pos_tp", 7.20, 0.85);
  assert.equal(confirmed.confirmed, true, "TP should confirm when recheck remains within tolerance");
  assert.match(consumeConfirmedTakeProfit("pos_tp"), /^\[TP\] PnL 8\.00%/);
  assert.match(
    consumeConfirmedTakeProfit("pos_tp"),
    /^\[TP\] PnL 8\.00%/,
    "confirmed TP reason remains available during the short management handoff window",
  );
}

async function main() {
  await withStateFixture(testHardTpRequiresConfirmationBeforeClose);
  console.log("✅ hard TP requires recheck confirmation before close");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
