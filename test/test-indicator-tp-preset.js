import assert from "node:assert/strict";
import { config } from "../config.js";
import { evaluatePreset } from "../tools/chart-indicators.js";

function payload({ rsi, close, upper, histogram, previousHistogram, macdFirstGreen } = {}) {
  const latest = {
    candle: { close },
    rsi: { value: rsi },
    bollinger: { upper },
  };
  if (histogram !== undefined) latest.macd = { histogram };
  if (previousHistogram !== undefined) latest.previousMacd = { histogram: previousHistogram };
  if (macdFirstGreen !== undefined) latest.states = { macdFirstGreenHistogram: macdFirstGreen };
  return { latest };
}

function testConfirmsRsiAndUpperBand() {
  const result = evaluatePreset("exit", "rsi_bb_or_macd_tp", payload({
    rsi: 91,
    close: 101,
    upper: 100,
  }));
  assert.equal(result.confirmed, true);
  assert.match(result.reason, /close above BB upper/);
  assert.match(result.reason, /MACD unavailable\/skipped/);
}

function testConfirmsRsiAndFirstGreenMacd() {
  const result = evaluatePreset("exit", "rsi_bb_or_macd_tp", payload({
    rsi: 91,
    close: 99,
    upper: 100,
    previousHistogram: -0.01,
    histogram: 0.02,
  }));
  assert.equal(result.confirmed, true);
  assert.match(result.reason, /MACD first green histogram/);
}

function testSkipsUnavailableMacdWithoutUpperBand() {
  const result = evaluatePreset("exit", "rsi_bb_or_macd_tp", payload({
    rsi: 91,
    close: 99,
    upper: 100,
  }));
  assert.equal(result.confirmed, false);
  assert.match(result.reason, /MACD unavailable\/skipped/);
}

function testRequiresStrictRsiThreshold() {
  const result = evaluatePreset("exit", "rsi_bb_or_macd_tp", payload({
    rsi: 90,
    close: 101,
    upper: 100,
  }));
  assert.equal(result.confirmed, false);
}

function main() {
  config.indicators.rsiTakeProfitOverbought = 90;
  testConfirmsRsiAndUpperBand();
  testConfirmsRsiAndFirstGreenMacd();
  testSkipsUnavailableMacdWithoutUpperBand();
  testRequiresStrictRsiThreshold();
  console.log("✅ RSI BB/MACD TP indicator preset works");
}

main();
