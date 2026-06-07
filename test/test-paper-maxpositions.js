/**
 * Regression test: paper simulator opens must respect maxPositions before
 * doing any network/SDK work. This protects all tool-call paths (/learn,
 * manual open_paper_position, etc.), not only the scheduled screener.
 *
 * Run: node test/test-paper-maxpositions.js
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-guard-"));

  try {
    process.chdir(tmp);
    fs.writeFileSync("paper-positions.json", JSON.stringify({
      positions: {
        "paper-existing": {
          id: "paper-existing",
          pool_address: "existing-pool",
          pool_name: "Existing-SOL",
          pair: "Existing-SOL",
          deposit_amount: 10,
          status: "open",
          opened_at: new Date().toISOString(),
        },
      },
    }, null, 2));

    process.env.DRY_RUN = "true";

    const { openPaperPosition } = await import(`../paper-positions.js?paper_guard_test=${Date.now()}`);

    await assert.rejects(
      () => openPaperPosition({
        pool_address: "dummy-pool-address",
        deposit_amount: 100,
        lower_price: 0.9,
        upper_price: 1.1,
        strategy_type: "spot",
      }),
      /max positions reached \(1\/1\)/i,
    );

    const state = JSON.parse(fs.readFileSync("paper-positions.json", "utf8"));
    assert.equal(Object.keys(state.positions).length, 1, "guard must not create another paper position");

    console.log("✅ paper maxPositions guard rejects extra paper opens");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
