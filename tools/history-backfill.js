import fs from "fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "../config.js";
import { repoPath } from "../repo-root.js";

const LESSONS_FILE = repoPath("lessons.json");
const STATE_FILE = repoPath("state.json");
const POOL_MEMORY_FILE = repoPath("pool-memory.json");
const METEORA_BASE = "https://dlmm.datapi.meteora.ag";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  const n = finite(value);
  if (n == null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function isoFromUnix(value) {
  const n = finite(value);
  if (n == null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function resolveWallet(wallet) {
  if (wallet) return wallet;
  if (!process.env.WALLET_PRIVATE_KEY) throw new Error("wallet required or WALLET_PRIVATE_KEY not set");
  return Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY)).publicKey.toString();
}

function pairName(poolMeta = {}, pnlData = {}) {
  const x = poolMeta.tokenX || pnlData.tokenX || "TOKEN";
  const y = poolMeta.tokenY || pnlData.tokenY || "SOL";
  return `${x}-${y}`;
}

function buildKnownPools({ lessons, state, poolMemory }) {
  const pools = new Map();
  for (const p of lessons.performance || []) {
    if (p?.pool) pools.set(p.pool, { poolAddress: p.pool, tokenX: null, tokenY: "SOL", known: true });
  }
  for (const p of Object.values(state.positions || {})) {
    if (p?.pool) pools.set(p.pool, { ...(pools.get(p.pool) || {}), poolAddress: p.pool, tokenX: null, tokenY: "SOL", known: true });
  }
  for (const [poolAddress, entry] of Object.entries(poolMemory || {})) {
    pools.set(poolAddress, {
      ...(pools.get(poolAddress) || {}),
      poolAddress,
      tokenX: entry?.name ? String(entry.name).split("-")[0] : null,
      tokenY: "SOL",
      tokenXMint: entry?.base_mint || null,
      known: true,
    });
  }
  return pools;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchClosedPortfolioPools(wallet, { maxPages = 20 } = {}) {
  const pools = new Map();
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${METEORA_BASE}/portfolio?user=${encodeURIComponent(wallet)}&status=closed&page=${page}`;
    const data = await fetchJson(url);
    for (const pool of data.pools || []) {
      if (pool?.poolAddress) pools.set(pool.poolAddress, pool);
    }
    if (!data.hasNext) break;
  }
  return pools;
}

async function fetchClosedPoolPositions(wallet, poolAddress, { maxPages = 10 } = {}) {
  const positions = [];
  let lastData = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${METEORA_BASE}/positions/${encodeURIComponent(poolAddress)}/pnl?user=${encodeURIComponent(wallet)}&status=closed&page=${page}`;
    const data = await fetchJson(url);
    lastData = data;
    positions.push(...(data.positions || []));
    if (!data.hasNext) break;
  }
  return { positions, meta: lastData || {} };
}

function makeBackfillRecord({ pos, poolAddress, poolMeta, pnlMeta, existing, tracked, now }) {
  const deposits = pos.allTimeDeposits?.total || {};
  const withdrawals = pos.allTimeWithdrawals?.total || {};
  const fees = pos.allTimeFees?.total || {};
  const initialUsd = finite(deposits.usd);
  const initialSol = finite(deposits.sol);
  const finalUsd = finite(withdrawals.usd);
  const finalSol = finite(withdrawals.sol);
  const feesUsd = finite(fees.usd);
  const feesSol = finite(fees.sol);
  const pnlUsd = finite(pos.pnlUsd);
  const pnlSol = finite(pos.pnlSol);
  const pnlUsdPct = finite(pos.pnlPctChange);
  const pnlSolPct = finite(pos.pnlSolPctChange);
  const createdAt = isoFromUnix(pos.createdAt);
  const closedAt = isoFromUnix(pos.closedAt);
  const minutesHeld = createdAt && closedAt
    ? Math.max(0, Math.round((new Date(closedAt).getTime() - new Date(createdAt).getTime()) / 60000))
    : existing?.minutes_held ?? null;
  const source = existing?.source || (tracked ? "meridian" : "wallet_manual");

  return {
    ...existing,
    position: pos.positionAddress,
    pool: poolAddress,
    pool_name: existing?.pool_name || tracked?.pool_name || pairName(poolMeta, pnlMeta),
    base_mint: existing?.base_mint || tracked?.base_mint || poolMeta.tokenXMint || null,
    strategy: existing?.strategy || tracked?.strategy || null,
    bin_range: existing?.bin_range || tracked?.bin_range || null,
    bin_step: existing?.bin_step || tracked?.bin_step || finite(poolMeta.binStep),
    amount_sol: existing?.amount_sol ?? tracked?.amount_sol ?? initialSol,
    initial_value_usd: round(initialUsd, 6),
    initial_value_sol: round(initialSol, 9),
    final_value_usd: round(finalUsd, 6),
    final_value_sol: round(finalSol, 9),
    fees_earned_usd: round(feesUsd, 6),
    fees_earned_sol: round(feesSol, 9),
    fee_earned_pct: initialUsd && feesUsd != null ? round((feesUsd / initialUsd) * 100, 4) : existing?.fee_earned_pct ?? null,
    pnl_usd: round(pnlUsd, 4),
    pnl_usd_pct: round(pnlUsdPct, 4),
    pnl_sol: round(pnlSol, 9),
    pnl_sol_pct: round(pnlSolPct, 4),
    pnl_pct: round(pnlUsdPct, 4),
    sol_price_at_close: finalSol && finalUsd != null ? round(finalUsd / finalSol, 4) : existing?.sol_price_at_close ?? null,
    range_efficiency: existing?.range_efficiency ?? null,
    minutes_held: minutesHeld,
    close_reason: existing?.close_reason || (source === "wallet_manual" ? "[Manual] wallet history backfill" : "[Manual] Meteora history backfill"),
    source,
    exclude_from_learning: source === "wallet_manual" ? true : existing?.exclude_from_learning ?? false,
    meteora_created_at: createdAt,
    meteora_closed_at: closedAt,
    recorded_at: existing?.recorded_at || closedAt || now,
    backfilled_from: "meteora",
    backfilled_at: now,
  };
}

function mergePerformance({ lessons, state, closedByPool, now }) {
  const byPosition = new Map();
  const performance = Array.isArray(lessons.performance) ? lessons.performance : [];
  for (const record of performance) {
    if (record?.position) byPosition.set(record.position, record);
  }

  let inserted = 0;
  let updated = 0;
  let manualInserted = 0;
  let meridianUpdated = 0;
  const samples = [];

  for (const item of closedByPool) {
    const existing = byPosition.get(item.pos.positionAddress) || null;
    const tracked = state.positions?.[item.pos.positionAddress] || null;
    const next = makeBackfillRecord({ ...item, existing, tracked, now });
    if (existing) {
      Object.assign(existing, next);
      updated += 1;
      if (next.source === "meridian") meridianUpdated += 1;
    } else {
      performance.push(next);
      byPosition.set(next.position, next);
      inserted += 1;
      if (next.source === "wallet_manual") manualInserted += 1;
    }
    if (samples.length < 8) {
      samples.push({
        position: next.position,
        pool_name: next.pool_name,
        source: next.source,
        pnl_usd: next.pnl_usd,
        pnl_sol: next.pnl_sol,
        closed_at: next.recorded_at,
      });
    }
  }

  performance.sort((a, b) => String(a.recorded_at || "").localeCompare(String(b.recorded_at || "")));
  lessons.performance = performance;
  return { inserted, updated, manualInserted, meridianUpdated, samples };
}

function backupLessons() {
  if (!fs.existsSync(LESSONS_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const backupPath = repoPath(`lessons.json.bak-meteora-backfill-${stamp}`);
  fs.copyFileSync(LESSONS_FILE, backupPath);
  return backupPath;
}

export async function backfillMeteoraHistory({ wallet, execute = false, limit = null } = {}) {
  const resolvedWallet = resolveWallet(wallet);
  const lessons = readJson(LESSONS_FILE, { lessons: [], performance: [] });
  const state = readJson(STATE_FILE, { positions: {} });
  const poolMemory = readJson(POOL_MEMORY_FILE, {});
  const knownPools = buildKnownPools({ lessons, state, poolMemory });
  const portfolioPools = await fetchClosedPortfolioPools(resolvedWallet);
  const pools = new Map([...knownPools, ...portfolioPools]);
  const poolList = [...pools.values()].filter((pool) => pool?.poolAddress);
  const selectedPools = limit ? poolList.slice(0, Number(limit)) : poolList;

  const closedByPool = [];
  const errors = [];
  for (const poolMeta of selectedPools) {
    try {
      const { positions, meta } = await fetchClosedPoolPositions(resolvedWallet, poolMeta.poolAddress);
      for (const pos of positions) {
        if (pos?.positionAddress) closedByPool.push({ poolAddress: poolMeta.poolAddress, poolMeta, pnlMeta: meta, pos });
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (error) {
      errors.push({ pool: poolMeta.poolAddress, error: error.message });
    }
  }

  const beforeCount = lessons.performance?.length || 0;
  const merge = mergePerformance({ lessons, state, closedByPool, now: new Date().toISOString() });
  const afterCount = lessons.performance?.length || 0;
  let backupPath = null;
  if (execute) {
    backupPath = backupLessons();
    writeJson(LESSONS_FILE, lessons);
  }

  return {
    success: errors.length === 0,
    dry_run: !execute,
    wallet: resolvedWallet,
    pools_discovered: pools.size,
    pools_scanned: selectedPools.length,
    meteora_closed_positions: closedByPool.length,
    performance_before: beforeCount,
    performance_after: afterCount,
    inserted: merge.inserted,
    updated: merge.updated,
    manual_inserted: merge.manualInserted,
    meridian_updated: merge.meridianUpdated,
    backup: backupPath,
    errors,
    samples: merge.samples,
  };
}
