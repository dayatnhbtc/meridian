const LABELS = new Set(["TP", "SL", "Trailing TP", "OOR", "Low Yield", "Manual"]);

function cleanupDetail(text) {
  return String(text || "")
    .replace(/^\s*[-—:]+\s*/, "")
    .replace(/\s*[-—]\s*⚡?\s*Trailing TP(?: exit)?(?: alert| triggered)?\.?\s*$/i, "")
    .replace(/\s*\.\s*⚡?\s*Trailing TP(?: exit)?(?: alert| triggered)?\.?\s*$/i, "")
    .replace(/^triggered:\s*/i, "")
    .replace(/^exit:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegacyPrefix(reason, label) {
  let detail = String(reason || "").trim();

  if (label === "TP") {
    detail = detail.replace(/^\s*(?:take profit|tp)\s*[:—-]?\s*/i, "");
  } else if (label === "SL") {
    detail = detail.replace(/^\s*(?:stop loss|stop-loss|sl)\s*(?:triggered)?\s*[:—-]?\s*/i, "");
  } else if (label === "Trailing TP") {
    detail = detail.replace(/^\s*⚡?\s*trailing\s*tp\s*(?:exit)?\s*[:—-]?\s*/i, "");
  } else if (label === "OOR") {
    detail = detail.replace(/^\s*(?:oor|out of range)\s*[:—-]?\s*/i, "");
  } else if (label === "Low Yield") {
    detail = detail.replace(/^\s*(?:⚡?\s*trailing\s*tp\s*exit\s*[:—-]?\s*)?low\s*yield\s*[:—-]?\s*/i, "");
  } else if (label === "Manual") {
    detail = detail.replace(/^\s*(?:manual|agent decision)\s*[:—-]?\s*/i, "");
  }

  return cleanupDetail(detail) || String(reason || "").trim() || "agent decision";
}

export function classifyCloseReason(reason) {
  const text = String(reason || "").trim();
  const lower = text.toLowerCase();
  const existing = text.match(/^\[(TP|SL|Trailing TP|OOR|Low Yield|Manual)\]/i);
  if (existing) {
    const normalized = existing[1].toLowerCase();
    if (normalized === "tp") return "TP";
    if (normalized === "sl") return "SL";
    if (normalized === "trailing tp") return "Trailing TP";
    if (normalized === "oor") return "OOR";
    if (normalized === "low yield") return "Low Yield";
    return "Manual";
  }

  if (lower.includes("low yield") || lower.includes("fee/tvl")) return "Low Yield";
  if (lower.includes("stop loss") || lower.includes("stop-loss") || lower === "sl") return "SL";
  if (lower.includes("out of range") || lower.includes("pumped far above range") || lower === "oor" || lower.startsWith("oor:")) return "OOR";
  if (lower.includes("trailing tp") || lower.includes("trailing take profit")) return "Trailing TP";
  if (lower.includes("take profit") || lower.startsWith("tp:") || lower === "tp") return "TP";
  return "Manual";
}

export function formatCloseReason(label, detail = "") {
  const normalizedLabel = LABELS.has(label) ? label : classifyCloseReason(label);
  const cleanDetail = cleanupDetail(detail) || "agent decision";
  return `[${normalizedLabel}] ${cleanDetail}`;
}

export function ensureCloseReasonLabel(reason) {
  const text = String(reason || "agent decision").trim();
  const existing = text.match(/^\[(TP|SL|Trailing TP|OOR|Low Yield|Manual)\]\s*(.*)$/i);
  if (existing) {
    const label = classifyCloseReason(existing[0]);
    const detail = cleanupDetail(existing[2]);
    return `[${label}] ${detail || "agent decision"}`;
  }
  const label = classifyCloseReason(text);
  return formatCloseReason(label, stripLegacyPrefix(text, label));
}
