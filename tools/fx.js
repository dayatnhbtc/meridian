import fs from "fs";
import { config } from "../config.js";
import { log } from "../logger.js";
import { repoPath } from "../repo-root.js";

const FX_CACHE_FILE = repoPath(".fx-cache.json");
const DEFAULT_USD_IDR_TTL_MS = 24 * 60 * 60 * 1000;
const SOL_USD_TTL_MS = 60 * 1000;

let usdIdrCache = null;
let solUsdCache = null;
let diskCacheLoaded = false;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadDiskCache() {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    if (!fs.existsSync(FX_CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(FX_CACHE_FILE, "utf8"));
    const rate = finite(data?.usd_idr?.rate);
    const nextUpdateMs = finite(data?.usd_idr?.next_update_ms);
    const fetchedAt = finite(data?.usd_idr?.fetched_at);
    if (rate && fetchedAt) {
      usdIdrCache = {
        rate,
        at: fetchedAt,
        nextUpdateMs: nextUpdateMs || fetchedAt + DEFAULT_USD_IDR_TTL_MS,
      };
    }
  } catch (error) {
    log("fx_warn", `FX cache read failed: ${error.message}`);
  }
}

function saveDiskCache() {
  try {
    fs.writeFileSync(FX_CACHE_FILE, JSON.stringify({
      usd_idr: usdIdrCache ? {
        rate: usdIdrCache.rate,
        fetched_at: usdIdrCache.at,
        next_update_ms: usdIdrCache.nextUpdateMs,
      } : null,
    }, null, 2));
  } catch (error) {
    log("fx_warn", `FX cache write failed: ${error.message}`);
  }
}

function usdIdrCacheValid(now) {
  if (!usdIdrCache?.rate) return false;
  const nextUpdateMs = finite(usdIdrCache.nextUpdateMs) || (Number(usdIdrCache.at) + DEFAULT_USD_IDR_TTL_MS);
  return now < nextUpdateMs;
}

export async function getUsdIdrRate() {
  loadDiskCache();
  const now = Date.now();
  if (usdIdrCacheValid(now)) return usdIdrCache.rate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const rate = finite(data?.rates?.IDR);
    if (!rate) throw new Error("IDR rate missing");
    const nextUpdateMs = finite(data?.time_next_update_unix)
      ? Number(data.time_next_update_unix) * 1000
      : now + DEFAULT_USD_IDR_TTL_MS;
    usdIdrCache = { rate, at: now, nextUpdateMs };
    saveDiskCache();
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
