/**
 * Central live-trading safety guards.
 *
 * Any code path that can sign/submit/broadcast a live transaction must call
 * assertLiveTradingAllowed before signing/submitting. This is intentionally
 * independent of LLM prompts and tool descriptions.
 */

export function isTruthyFlag(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function assertLiveTradingAllowed(action = "live transaction", walletPublicKey = null) {
  if (isTruthyFlag(process.env.DRY_RUN)) {
    throw new Error(`${action} blocked: DRY_RUN=true; no live transaction signing or submission is allowed.`);
  }

  if (!isTruthyFlag(process.env.LIVE_TRADING_ENABLED)) {
    throw new Error(`${action} blocked: set LIVE_TRADING_ENABLED=true only after manual live-trading review.`);
  }

  const allowedWallet = String(process.env.LIVE_ALLOWED_WALLET || "").trim();
  const actualWallet = walletPublicKey?.toString?.() || (walletPublicKey == null ? "" : String(walletPublicKey));
  if (allowedWallet && actualWallet && actualWallet !== allowedWallet) {
    throw new Error(`${action} blocked: wallet ${actualWallet.slice(0, 8)} is not the allowed live wallet.`);
  }

  return true;
}
