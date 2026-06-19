import { config } from "../config.js";
import { log } from "../logger.js";

const USD_IDR_TTL_MS = 30 * 60 * 1000;
const SOL_USD_TTL_MS = 60 * 1000;

let usdIdrCache = null;
let solUsdCache = null;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getUsdIdrRate() {
  const now = Date.now();
  if (usdIdrCache && now - usdIdrCache.at < USD_IDR_TTL_MS) return usdIdrCache.rate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const rate = finite(data?.rates?.IDR);
    if (!rate) throw new Error("IDR rate missing");
    usdIdrCache = { rate, at: now };
    return rate;
  } catch (error) {
    log("fx_warn", `USD/IDR fetch failed: ${error.message}`);
    return usdIdrCache?.rate || null;
  }
}

export async function getSolUsdPrice({ fallback = null } = {}) {
  const fromFallback = finite(fallback);
  if (fromFallback) return fromFallback;

  const now = Date.now();
  if (solUsdCache && now - solUsdCache.at < SOL_USD_TTL_MS) return solUsdCache.price;
  try {
    const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(config.tokens.SOL)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const sol = Array.isArray(data) ? data.find((asset) => asset?.id === config.tokens.SOL) || data[0] : null;
    const price = finite(sol?.usdPrice);
    if (!price) throw new Error("SOL price missing");
    solUsdCache = { price, at: now };
    return price;
  } catch (error) {
    log("fx_warn", `SOL/USD fetch failed: ${error.message}`);
    return solUsdCache?.price || null;
  }
}

export async function getIdrPerSol({ solUsd = null } = {}) {
  const [price, usdIdr] = await Promise.all([
    getSolUsdPrice({ fallback: solUsd }),
    getUsdIdrRate(),
  ]);
  return price && usdIdr ? price * usdIdr : null;
}
