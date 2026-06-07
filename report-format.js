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

  const ratio = Math.max(0, Math.min(1, (active - lower) / (upper - lower)));
  const marker = Math.max(0, Math.min(width - 1, Math.round(ratio * (width - 1))));
  const chars = Array.from({ length: width }, (_, i) => (i === marker ? "▮" : "─"));
  const pointer = `${" ".repeat(marker + 1)}▼`;
  return `${pointer}\n[${chars.join("")}]\n${Math.round(lower)}${" ".repeat(Math.max(1, width - String(Math.round(lower)).length - String(Math.round(upper)).length + 2))}${Math.round(upper)}`;
}

export function formatPositionLine(position, action = {}, options = {}) {
  const inRange = position.in_range ? "🟢 IN" : `🔴 OOR ${Math.round(Number(position.minutes_out_of_range ?? 0))}m`;
  const lines = [
    `**${position.pair || position.pool || "Unknown"}**  ${inRange}  ${actionBadge(action)}`,
    `Val: ${money(position.total_value_usd, options)}  📈 PnL: ${pct(position.pnl_pct)}`,
    `Fees: ${money(position.unclaimed_fees_usd, options)}  Yield: ${pct(position.fee_per_tvl_24h)}  Age: ${position.age_minutes ?? "?"}m`,
  ];
  const bar = rangeBar(position);
  if (bar) lines.push(bar);
  if (position.instruction) lines.push(`Note: "${position.instruction}"`);
  if (action.action === "CLOSE" && action.reason) {
    lines.push(`Rule${action.rule ? ` ${action.rule}` : ""}: ${action.reason}`);
  }
  if (action.action === "CLAIM") lines.push("→ Claiming fees");
  return lines.join("\n");
}

export function formatPortfolioReport(positions = [], actionMap = new Map(), options = {}) {
  const solMode = Boolean(options.solMode);
  if (!positions.length) {
    return [options.intro, "Portfolio 💼 0 positions", options.actionSummary ? `*${options.actionSummary}*` : null]
      .filter(Boolean)
      .join("\n\n");
  }

  const totalValue = positions.reduce((s, p) => s + (Number(p.total_value_usd) || 0), 0);
  const totalFees = positions.reduce((s, p) => s + (Number(p.unclaimed_fees_usd) || 0), 0);
  const actionFor = (p, i) => actionMap.get(p.position) || actionMap.get(String(i)) || actionMap.get(i) || { action: "STAY" };
  const body = positions.map((p, i) => formatPositionLine(p, actionFor(p, i), { solMode })).join("\n\n");
  const actionSummary = options.actionSummary || "no action";

  return [
    options.intro,
    `Portfolio 💼 ${positions.length} position${positions.length === 1 ? "" : "s"}`,
    `Total: ${money(totalValue, { solMode })}  Fees: ${money(totalFees, { solMode })}`,
    "",
    body,
    "",
    `*${actionSummary}*`,
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

export function formatScreeningSkipReport({ reason, positions = [], solMode = false, maxPositions = null, wallet = null } = {}) {
  const header = [
    "🔍 Screening Cycle",
    `Skipped: ${reason || "pre-check guard"}`,
    maxPositions != null ? `Positions: ${positions.length}/${maxPositions}` : null,
    wallet?.sol != null ? `Wallet: ${num(wallet.sol, 3)} SOL` : null,
  ].filter(Boolean).join("\n");
  const portfolio = positions.length
    ? formatPortfolioReport(positions, new Map(), { solMode, actionSummary: "screening blocked until a slot opens" })
    : "Portfolio 💼 0 positions";
  return `${header}\n\n${portfolio}`;
}

export { money, pct, rangeBar };
