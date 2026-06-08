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

function actionBadge(action = {}) {
  const a = String(action.action || "STAY").toUpperCase();
  if (a === "STAY") return "✅ STAY";
  if (a === "CLAIM") return "🟡 CLAIM";
  if (a === "CLOSE") return "🚨 CLOSE";
  if (a === "INSTRUCTION") return "📝 CHECK";
  return `ℹ️ ${a}`;
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
  const inRange = position.in_range ? "🟢 IN" : `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m`;
  const lines = [
    `<b>${escapeHtml(position.pair || position.pool || "Unknown")}</b>  ${inRange}  ${actionBadge(action)}`,
    `Val: ${money(position.total_value_usd, options)}  📈 PnL: ${pct(position.pnl_pct)}`,
    `Fees: ${money(position.unclaimed_fees_usd, options)}  Yield: ${pct(position.fee_per_tvl_24h)}  Age: ${position.age_minutes ?? "?"}m`,
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
  if (!positions.length) {
    return [options.intro ? escapeHtml(options.intro) : null, "Portfolio 💼 0 positions", options.actionSummary ? `<i>${escapeHtml(options.actionSummary)}</i>` : null]
      .filter(Boolean)
      .join("\n\n");
  }

  const totalValue = positions.reduce((s, p) => s + (Number(p.total_value_usd) || 0), 0);
  const totalFees = positions.reduce((s, p) => s + (Number(p.unclaimed_fees_usd) || 0), 0);
  const actionFor = (p, i) => actionMap.get(p.position) || actionMap.get(String(i)) || actionMap.get(i) || { action: "STAY" };
  const body = positions.map((p, i) => formatPositionLine(p, actionFor(p, i), { solMode })).join("\n\n");
  const actionSummary = options.actionSummary || "no action";

  return [
    options.intro ? escapeHtml(options.intro) : null,
    `Portfolio 💼 ${positions.length} position${positions.length === 1 ? "" : "s"}`,
    `Total: ${money(totalValue, { solMode })}  Fees: ${money(totalFees, { solMode })}`,
    "",
    body,
    "",
    `<i>${escapeHtml(actionSummary)}</i>`,
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

export function formatScreeningSkipReport({ reason, positions = [], solMode = false, maxPositions = null, wallet = null } = {}) {
  const header = [
    "🔍 Screening Cycle",
    `Skipped: ${escapeHtml(reason || "pre-check guard")}`,
    maxPositions != null ? `Positions: ${positions.length}/${maxPositions}` : null,
    wallet?.sol != null ? `Wallet: ${num(wallet.sol, 3)} SOL` : null,
  ].filter(Boolean).join("\n");
  const portfolio = positions.length
    ? formatPortfolioReport(positions, new Map(), { solMode, actionSummary: "screening blocked until a slot opens" })
    : "Portfolio 💼 0 positions";
  return `${header}\n\n${portfolio}`;
}

export { money, pct, rangeBar };
