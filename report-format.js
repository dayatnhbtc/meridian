export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function num(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "?";
  return n.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function money(value, { solMode = false, digits = 4 } = {}) {
  const prefix = solMode ? "◎" : "$";
  const n = Number(value);
  if (!Number.isFinite(n)) return `${prefix}?`;
  return `${prefix}${n.toFixed(digits)}`;
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "?";
  return `${num(n, digits)}%`;
}

function formatAge(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "?";
  const m = Math.round(Number(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function actionBadge(action = {}) {
  const a = String(action.action || "STAY").toUpperCase();
  if (a === "STAY") return "✅ STAY";
  if (a === "CLAIM") return "🟡 CLAIM";
  if (a === "CLOSE") return "🚨 CLOSE";
  if (a === "INSTRUCTION") return "📝 CHECK";
  return `ℹ️ ${a}`;
}

function rangePositionPct(position) {
  const lower = Number(position.lower_bin);
  const upper = Number(position.upper_bin);
  const active = Number(position.active_bin);
  if (![lower, upper, active].every(Number.isFinite) || upper <= lower) return null;
  const pctInRange = ((active - lower) / (upper - lower)) * 100;
  return Math.round(Math.max(0, Math.min(100, pctInRange)));
}

function rangeStatus(position) {
  const lower = Number(position.lower_bin);
  const upper = Number(position.upper_bin);
  const active = Number(position.active_bin);
  if (![lower, upper, active].every(Number.isFinite) || upper <= lower) {
    return position.in_range ? "🟢 IN" : `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m`;
  }
  if (position.in_range === false && active < lower) return `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m below ${Math.round(lower - active)} bins`;
  if (position.in_range === false && active > upper) return `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m above ${Math.round(active - upper)} bins`;
  if (position.in_range === false) return `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m`;
  return `🟢 IN ${rangePositionPct(position)}%`;
}

function signedMoney(value, { solMode = false, digits = 2 } = {}) {
  const prefix = solMode ? "◎" : "$";
  const n = Number(value);
  if (!Number.isFinite(n)) return `${prefix}?`;
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${prefix}${Math.abs(n).toFixed(digits)}`;
}

function signedIdrFromSol(solValue, idrPerSol) {
  const sol = Number(solValue);
  const rate = Number(idrPerSol);
  if (!Number.isFinite(sol) || !Number.isFinite(rate) || rate <= 0) return "";
  const value = sol * rate;
  const sign = value >= 0 ? "+" : "-";
  return ` (${sign}Rp${Math.round(Math.abs(value)).toLocaleString("id-ID")})`;
}

function signedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "?";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${num(n, digits)}%`;
}

function rangeBar(position, width = 22) {
  const lower = Number(position.lower_bin);
  const upper = Number(position.upper_bin);
  const active = Number(position.active_bin);
  if (![lower, upper, active].every(Number.isFinite) || upper <= lower) return null;

  const lowerLabel = String(Math.round(lower));
  const activeLabel = String(Math.round(active));
  const upperLabel = String(Math.round(upper));
  const ratio = Math.max(0, Math.min(1, (active - lower) / (upper - lower)));
  const marker = Math.max(0, Math.min(width - 1, Math.round(ratio * (width - 1))));
  const chars = Array.from({ length: width }, (_, i) => (i === marker ? "●" : "─"));
  const bar = `[${chars.join("")}]`;
  const lineWidth = Math.max(bar.length, lowerLabel.length + activeLabel.length + upperLabel.length + 2);
  const labels = Array.from({ length: lineWidth }, () => " ");

  function place(label, preferredStart) {
    const maxStart = Math.max(0, lineWidth - label.length);
    let start = Math.max(0, Math.min(maxStart, preferredStart));
    while (start < maxStart && labels.slice(start, start + label.length).some((c) => c !== " ")) start += 1;
    while (start > 0 && labels.slice(start, start + label.length).some((c) => c !== " ")) start -= 1;
    for (let i = 0; i < label.length; i += 1) labels[start + i] = label[i];
  }

  place(lowerLabel, 0);
  place(upperLabel, lineWidth - upperLabel.length);
  place(activeLabel, marker + 1 - Math.floor(activeLabel.length / 2));

  return `${bar}\n${labels.join("").trimEnd()}`;
}

export function formatPositionLine(position, action = {}, options = {}) {
  const inRange = rangeStatus(position);
  const pnlValue = openPnlValue(position, options);
  const valueOpts = { ...options, digits: options.solMode ? 4 : 2 };
  const lines = [
    `<b>${escapeHtml(position.pair || position.pool || "Unknown")}</b>  ${inRange}  ${actionBadge(action)}`,
    `Val: ${money(position.total_value_usd, valueOpts)}  PnL: ${signedMoney(pnlValue, valueOpts)} (${signedPct(openPnlPct(position))})`,
    `Fees: ${money(position.unclaimed_fees_usd, valueOpts)}  Yield: ${pct(position.fee_per_tvl_24h)}  Age: ${formatAge(position.age_minutes)}`,
  ];
  const bar = rangeBar(position);
  if (bar) lines.push(`<pre>${escapeHtml(bar)}</pre>`);
  if (position.instruction) lines.push(`Note: "${escapeHtml(position.instruction)}"`);
  if (action.action === "CLOSE" && action.reason) {
    lines.push(`Rule${action.rule ? ` ${escapeHtml(action.rule)}` : ""}: ${escapeHtml(action.reason)}`);
  }
  if (action.action === "CLAIM") lines.push("→ Claiming fees");
  return lines.join("\n");
}

export function formatPortfolioReport(positions = [], actionMap = new Map(), options = {}) {
  const solMode = Boolean(options.solMode);
  const idrPerSol = Number(options.idrPerSol);
  const title = options.title || "Portfolio 💼";
  if (!positions.length) {
    return [options.intro ? escapeHtml(options.intro) : null, `${escapeHtml(title)} 0 positions`, options.actionSummary ? `<i>${escapeHtml(options.actionSummary)}</i>` : null]
      .filter(Boolean)
      .join("\n\n");
  }

  const totalValue = positions.reduce((s, p) => s + (Number(p.total_value_usd) || 0), 0);
  const totalFees = positions.reduce((s, p) => s + (Number(p.unclaimed_fees_usd) || 0), 0);
  const totalPnl = positions.reduce((s, p) => s + openPnlValue(p, { solMode }), 0);
  const inRangeCount = positions.filter((p) => p.in_range).length;
  const avgRangePosition = (() => {
    const values = positions.filter((p) => p.in_range).map(rangePositionPct).filter((value) => value != null);
    if (!values.length) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  })();
  const actionFor = (p, i) => actionMap.get(p.position) || actionMap.get(String(i)) || actionMap.get(i) || { action: "STAY" };
  const actions = positions.map(actionFor);
  const closeCount = actions.filter((a) => a.action === "CLOSE").length;
  const claimCount = actions.filter((a) => a.action === "CLAIM").length;
  const instructionCount = actions.filter((a) => a.action === "INSTRUCTION").length;
  const body = positions.map((p, i) => formatPositionLine(p, actionFor(p, i), { solMode })).join("\n\n");
  const actionSummary = options.actionSummary || "no action";
  const slots = options.maxPositions ? `${positions.length}/${options.maxPositions}` : String(positions.length);
  const valueOpts = { solMode, digits: solMode ? 4 : 2 };
  const actionBits = [
    closeCount ? `🚨 ${closeCount} close` : null,
    claimCount ? `🟡 ${claimCount} claim` : null,
    instructionCount ? `📝 ${instructionCount} check` : null,
  ].filter(Boolean).join("  ") || "✅ all stay";

  return [
    options.intro ? escapeHtml(options.intro) : null,
    `<b>${escapeHtml(title)}</b>`,
    `Positions: ${slots}  Range: ${inRangeCount}/${positions.length} IN${avgRangePosition == null ? "" : ` (avg ${avgRangePosition}%)`}`,
    `Actions: ${actionBits}`,
    `Value: ${money(totalValue, valueOpts)}  PnL: ${signedMoney(totalPnl, valueOpts)}${solMode ? signedIdrFromSol(totalPnl, idrPerSol) : ""}  Fees: ${money(totalFees, valueOpts)}`,
    "",
    body,
    "",
    `<i>${escapeHtml(actionSummary)}</i>`,
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

export function formatScreeningSkipReport({ reason, positions = [], solMode = false, maxPositions = null, wallet = null } = {}) {
  const header = [
    "🔍 <b>Screening Cycle</b>",
    `Skipped: ${escapeHtml(reason || "pre-check guard")}`,
    maxPositions != null ? `Positions: ${positions.length}/${maxPositions}` : null,
    wallet?.sol != null ? `Wallet: ${num(wallet.sol, 3)} SOL` : null,
  ].filter(Boolean).join("\n");
  const portfolio = positions.length
    ? formatPortfolioReport(positions, new Map(), { solMode, actionSummary: "screening blocked until a slot opens" })
    : "Portfolio 💼 0 positions";
  return `${header}\n\n${portfolio}`;
}

function markdownishToHtml(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function formatScreeningAgentReport(report = "") {
  const raw = String(report || "").trim();
  if (!raw) return "";

  const headingMap = new Map([
    ["NO DEPLOY", "⛔ <b>NO DEPLOY</b>"],
    ["DEPLOYED", "✅ <b>DEPLOYED</b>"],
    ["BEST LOOKING CANDIDATE", "<b>Best looking candidate</b>"],
    ["WHY SKIPPED", "<b>Why skipped</b>"],
    ["REJECTED", "<b>Rejected</b>"],
    ["POSITION", "<b>Position</b>"],
    ["MARKET", "<b>Market</b>"],
    ["AUDIT", "<b>Audit</b>"],
    ["WHY THIS WON", "<b>Why this won</b>"],
  ]);

  return raw
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const normalized = trimmed.replace(/^[✅⛔🚀\s]+/, "").trim().toUpperCase();
      if (headingMap.has(normalized)) return headingMap.get(normalized);
      if (!trimmed) return "";
      if (/^-\s+/.test(trimmed)) return `• ${markdownishToHtml(trimmed.replace(/^-\s+/, ""))}`;
      return markdownishToHtml(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function pnlEmoji(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "⚪";
  return n > 0 ? "🟢" : "🔴";
}

function sum(values, field) {
  return values.reduce((total, item) => total + (Number(item?.[field]) || 0), 0);
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function openPnlValue(position, { solMode = false } = {}) {
  // A suspicious tick has no reliable cost basis (deposit history missing /
  // unpriced), so its pnl can be the full position value — exclude it from
  // totals rather than reporting a phantom profit.
  if (position?.pnl_pct_suspicious) return 0;
  if (solMode) return firstFinite(position?.pnl_usd) ?? 0;
  return firstFinite(position?.pnl_true_usd, position?.pnl_usd) ?? 0;
}

function openFeesValue(position, { solMode = false } = {}) {
  if (solMode) return firstFinite(position?.unclaimed_fees_usd) ?? 0;
  return firstFinite(position?.unclaimed_fees_true_usd, position?.unclaimed_fees_usd) ?? 0;
}

function openPnlPct(position) {
  const derived = firstFinite(position?.pnl_pct_derived);
  const reported = firstFinite(position?.pnl_pct);
  if (position?.pnl_pct_suspicious && derived != null) return derived;
  if ((reported == null || reported === 0) && derived != null && derived !== 0) return derived;
  return reported ?? derived;
}

function hasFinite(value) {
  return Number.isFinite(Number(value));
}

function realizedSolValue(position) {
  return hasFinite(position?.pnl_sol) ? Number(position.pnl_sol) : null;
}

function realizedSolPct(position) {
  return hasFinite(position?.pnl_sol_pct) ? Number(position.pnl_sol_pct) : null;
}

export function formatDailyPnlReport({ dateLabel, realizedPositions = [], openPositions = [], compact = false, title = "PnL Hari Ini", solMode = false, idrPerSol = null } = {}) {
  const realizedPnl = sum(realizedPositions, "pnl_usd");
  const realizedFees = sum(realizedPositions, "fees_earned_usd");
  const realizedWithSol = realizedPositions.filter((position) => realizedSolValue(position) != null);
  const realizedSolPnl = realizedWithSol.reduce((total, position) => total + realizedSolValue(position), 0);
  const openPnl = openPositions.reduce((total, position) => total + openPnlValue(position, { solMode }), 0);
  const openFees = openPositions.reduce((total, position) => total + openFeesValue(position, { solMode }), 0);
  const canTotalSol = solMode && realizedWithSol.length === realizedPositions.length;
  const totalPnl = solMode ? (canTotalSol ? realizedSolPnl + openPnl : null) : realizedPnl + openPnl;
  const valueOpts = { solMode, digits: solMode ? 4 : 2 };
  const usdOpts = { digits: 2 };

  const realizedLine = (() => {
    if (!solMode) {
      return `${pnlEmoji(realizedPnl)} Realized: <b>${signedMoney(realizedPnl, usdOpts)}</b> (${realizedPositions.length} closed)` + (realizedPositions.length ? `  Fees: ${money(realizedFees, { digits: 2 })}` : "");
    }
    if (!realizedPositions.length) return `⚪ Realized: <b>${signedMoney(0, valueOpts)}</b> (0 closed)`;
    if (canTotalSol) {
      return `${pnlEmoji(realizedSolPnl)} Realized: <b>${signedMoney(realizedSolPnl, valueOpts)}</b> (${realizedPositions.length} closed)  USD ref: ${signedMoney(realizedPnl, usdOpts)}`;
    }
    return `${pnlEmoji(realizedPnl)} Realized: <b>${signedMoney(realizedPnl, usdOpts)}</b> (${realizedPositions.length} closed, USD history)` + (realizedWithSol.length ? `  SOL-covered: ${signedMoney(realizedSolPnl, valueOpts)} (${realizedWithSol.length})` : "");
  })();

  const totalLine = totalPnl != null
    ? `${pnlEmoji(totalPnl)} <b>Total: ${signedMoney(totalPnl, valueOpts)}${solMode ? signedIdrFromSol(totalPnl, idrPerSol) : ""}</b>`
    : `⚪ <b>Total: mixed units</b> (Open ${signedMoney(openPnl, valueOpts)} + Realized ${signedMoney(realizedPnl, usdOpts)})`;

  const lines = [
    `📊 <b>${escapeHtml(title)}</b>`,
    dateLabel ? escapeHtml(dateLabel) : null,
    "",
    realizedLine,
    `${pnlEmoji(openPnl)} Open: <b>${signedMoney(openPnl, valueOpts)}</b> (${openPositions.length} open)` + (openPositions.length ? `  Fees: ${money(openFees, valueOpts)}` : ""),
    totalLine,
  ].filter((line) => line !== null && line !== undefined);

  if (compact) {
    return lines.join("\n");
  }

  if (realizedPositions.length) {
    lines.push("", "📕 <b>Closed today</b>");
    const latestRealized = [...realizedPositions].sort((a, b) => {
      const at = new Date(a?.closed_at || a?.recorded_at || 0).getTime();
      const bt = new Date(b?.closed_at || b?.recorded_at || 0).getTime();
      return bt - at;
    });
    for (const p of latestRealized.slice(0, 8)) {
      const solValue = solMode ? realizedSolValue(p) : null;
      const value = solValue ?? Number(p.pnl_usd);
      const opts = solValue != null ? valueOpts : usdOpts;
      const pctValue = solValue != null ? realizedSolPct(p) : p.pnl_pct;
      lines.push(`${pnlEmoji(value)} ${escapeHtml(p.pool_name || p.pair || p.pool || "Unknown")}  <b>${signedMoney(value, opts)}</b>  ${signedPct(pctValue)}`);
    }
  }

  if (openPositions.length) {
    lines.push("", "📗 <b>Open now</b>");
    for (const p of openPositions.slice(0, 8)) {
      const pnlValue = openPnlValue(p, { solMode });
      lines.push(`${pnlEmoji(pnlValue)} ${escapeHtml(p.pair || p.pool || "Unknown")}  <b>${signedMoney(pnlValue, valueOpts)}</b>  ${signedPct(openPnlPct(p))}`);
    }
  }

  if (!realizedPositions.length && !openPositions.length) {
    lines.push("", "Belum ada closed/open position yang punya PnL hari ini.");
  }

  return lines.join("\n");
}

export { money, pct, rangeBar, signedMoney, signedPct };
