/**
 * Evil Panda strategy helpers.
 *
 * Phase 1: codify the strategy preset in strategy-library.json.
 * Phase 2: provide deterministic paper/simulator defaults and signal evaluators.
 *
 * This module is intentionally deterministic. The AI can choose whether to use
 * the preset, but the preset's ranges, single-side SOL shape, and exit
 * confluence are code-level rules once selected.
 */

export const EVIL_PANDA_PRESET_ID = "evil_panda_safe_v1";

export const EVIL_PANDA_DEFAULTS = Object.freeze({
  timeframe: "15m",
  lpStrategy: "spot",
  singleSide: "sol",
  defaultDownsidePct: 86,
  maxDownsidePct: 94,
  minMcap: 250_000,
  minVolume24h: 1_000_000,
  minTokenFeesSol: 30,
  maxBundlePct: 60,
  maxTop10Pct: 30,
  maxInsiderPct: 10,
  maxPhishingPct: 30,
  minBinStep: 80,
  maxBinStep: 125,
  rsiLength: 2,
  rsiOverbought: 90,
});

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readAny(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] != null) return obj[key];
  }
  return null;
}

/**
 * Convert downside coverage to approximate Meteora bin count for a bin step.
 * Formula: price lower = price / (1 + binStep / 10000) ^ bins.
 */
export function binsBelowForDownside(binStep, downsidePct) {
  const step = numberOrNull(binStep);
  const downside = numberOrNull(downsidePct);
  if (step == null || step <= 0) throw new Error("binStep must be a positive number");
  if (downside == null || downside < 0 || downside >= 100) {
    throw new Error("downsidePct must be >= 0 and < 100");
  }
  if (downside === 0) return 0;
  const bins = Math.log(1 - downside / 100) / Math.log(1 / (1 + step / 10_000));
  return Math.round(bins);
}

export function isEvilPandaCandidateEligible(candidate = {}, criteria = EVIL_PANDA_DEFAULTS) {
  const mcap = numberOrNull(readAny(candidate, ["mcap", "market_cap", "marketCap"]));
  const volume24h = numberOrNull(readAny(candidate, ["volume_24h", "volume24h", "volume", "volume_window"]));
  const tokenFeesSol = numberOrNull(readAny(candidate, ["token_fees_sol", "tokenFeesSol", "fees_sol", "feesSol"]));
  const bundlePct = numberOrNull(readAny(candidate, ["bundle_pct", "bundlePct", "bundling_pct", "bundlingPct"]));
  const top10Pct = numberOrNull(readAny(candidate, ["top10_pct", "top10Pct", "top_10_pct"]));
  const insiderPct = numberOrNull(readAny(candidate, ["insider_pct", "insiderPct", "insiders_pct", "insidersPct"]));
  const phishingPct = numberOrNull(readAny(candidate, ["phishing_pct", "phishingPct"]));
  const binStep = numberOrNull(readAny(candidate, ["bin_step", "binStep"]));
  const hasProfileImage = readAny(candidate, ["has_profile_image", "hasProfileImage", "profile_image", "profileImage"]);

  if (mcap == null || mcap < criteria.minMcap) return false;
  if (volume24h == null || volume24h < criteria.minVolume24h) return false;
  if (tokenFeesSol == null || tokenFeesSol < criteria.minTokenFeesSol) return false;
  if (binStep == null || binStep < criteria.minBinStep || binStep > criteria.maxBinStep) return false;
  if (bundlePct != null && bundlePct > criteria.maxBundlePct) return false;
  if (top10Pct != null && top10Pct > criteria.maxTop10Pct) return false;
  if (insiderPct != null && insiderPct > criteria.maxInsiderPct) return false;
  if (phishingPct != null && phishingPct > criteria.maxPhishingPct) return false;
  if (hasProfileImage === false || hasProfileImage === "false" || hasProfileImage === "") return false;

  return true;
}

/**
 * Entry rule: 15m candle closes across Supertrend from below to above.
 */
export function evaluateEvilPandaEntry(candles = []) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return { shouldEnter: false, reason: "need at least two 15m candles with supertrend values" };
  }
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const prevClose = numberOrNull(prev.close);
  const prevSupertrend = numberOrNull(prev.supertrend);
  const close = numberOrNull(curr.close);
  const supertrend = numberOrNull(curr.supertrend);

  if ([prevClose, prevSupertrend, close, supertrend].some((v) => v == null)) {
    return { shouldEnter: false, reason: "missing close/supertrend values" };
  }

  const crossedAbove = prevClose <= prevSupertrend && close > supertrend;
  return crossedAbove
    ? { shouldEnter: true, reason: "evil panda entry: 15m close broke above Supertrend" }
    : { shouldEnter: false, reason: "no fresh Supertrend break above" };
}

/**
 * Exit rule: RSI(2)>90 plus one of the bounce confirmations.
 */
export function evaluateEvilPandaExit(snapshot = {}) {
  const close = numberOrNull(snapshot.close);
  const bollingerUpper = numberOrNull(readAny(snapshot, ["bollingerUpper", "bb_upper", "bbUpper"]));
  const rsi2 = numberOrNull(readAny(snapshot, ["rsi2", "rsi", "rsi_2"]));
  const macdHistogram = numberOrNull(readAny(snapshot, ["macdHistogram", "macd_histogram", "macdHist"]));
  const previousMacdHistogram = numberOrNull(readAny(snapshot, ["previousMacdHistogram", "previous_macd_histogram", "prevMacdHistogram", "prev_macd_histogram"]));

  if (rsi2 == null || rsi2 <= EVIL_PANDA_DEFAULTS.rsiOverbought) {
    return { shouldExit: false, reason: "RSI(2) has not closed above 90" };
  }

  if (close != null && bollingerUpper != null && close > bollingerUpper) {
    return { shouldExit: true, reason: "evil panda exit: RSI(2)>90 + close above Bollinger upper" };
  }

  if (previousMacdHistogram != null && macdHistogram != null && previousMacdHistogram <= 0 && macdHistogram > 0) {
    return { shouldExit: true, reason: "evil panda exit: RSI(2)>90 + MACD histogram first green" };
  }

  return { shouldExit: false, reason: "RSI(2)>90 but no BB upper/MACD first-green confluence" };
}

/**
 * Apply safe paper-trade defaults for deploy_position/open-paper flows.
 */
export function applyEvilPandaDeployDefaults(args = {}, management = {}) {
  const downsidePct = numberOrNull(args.downside_pct) ?? EVIL_PANDA_DEFAULTS.defaultDownsidePct;
  if (downsidePct > EVIL_PANDA_DEFAULTS.maxDownsidePct) {
    throw new Error(`Evil Panda downside_pct ${downsidePct} exceeds max ${EVIL_PANDA_DEFAULTS.maxDownsidePct}`);
  }
  const binStep = numberOrNull(args.bin_step ?? args.binStep);
  const defaults = {
    ...args,
    strategy_preset: EVIL_PANDA_PRESET_ID,
    strategy: args.strategy ?? EVIL_PANDA_DEFAULTS.lpStrategy,
    amount_x: 0,
    amount_y: numberOrNull(args.amount_y ?? args.amount_sol) ?? numberOrNull(management.deployAmountSol) ?? 0.1,
    bins_above: 0,
    downside_pct: downsidePct,
  };
  if (binStep != null) {
    defaults.evil_panda_bins_below_estimate = binsBelowForDownside(binStep, downsidePct);
  }
  return defaults;
}
