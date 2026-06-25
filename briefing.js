import fs from "fs";
import { log } from "./logger.js";
import { getPerformanceSummary } from "./lessons.js";
import { config } from "./config.js";
import { repoPath } from "./repo-root.js";
import { getUsdIdrRate } from "./tools/fx.js";

const STATE_FILE = repoPath("state.json");
const LESSONS_FILE = repoPath("lessons.json");
const DECISION_LOG_FILE = repoPath("decision-log.json");

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateBriefing() {
  const state = loadJson(STATE_FILE) || { positions: {}, recentEvents: [] };
  const lessonsData = loadJson(LESSONS_FILE) || { lessons: [], performance: [] };
  const decisionData = loadJson(DECISION_LOG_FILE) || { decisions: [] };

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const todayWib = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter(p => new Date(p.deployed_at) > last24h);
  const closedLast24h = allPositions.filter(p => p.closed && new Date(p.closed_at) > last24h);
  const perfLast24h = (lessonsData.performance || []).filter(p => new Date(p.recorded_at) > last24h);
  const totalPnLUsd = perfLast24h.reduce((sum, p) => sum + (p.pnl_usd || 0), 0);
  const totalFeesUsd = perfLast24h.reduce((sum, p) => sum + (p.fees_earned_usd || 0), 0);
  const wins24h = perfLast24h.filter(p => (p.pnl_usd || 0) > 0).length;
  const avgHoldMin = avg(perfLast24h.map(p => Number(p.minutes_held)).filter(Number.isFinite));
  const avgRangeEff = avg(perfLast24h.map(p => Number(p.range_efficiency)).filter(Number.isFinite));
  const sortedPerf = [...perfLast24h].sort((a, b) => (b.pnl_usd || 0) - (a.pnl_usd || 0));
  const bestClose = sortedPerf[0] || null;
  const worstClose = sortedPerf[sortedPerf.length - 1] || null;
  const openPositions = allPositions.filter(p => !p.closed);
  const activeInstructions = openPositions.filter(p => p.instruction).length;
  const recentDecisions = (decisionData.decisions || [])
    .filter(d => new Date(d.ts) > last24h)
    .slice(0, 3);
  const perfSummary = getPerformanceSummary();
  const pnlIcon = totalPnLUsd > 0 ? "🟢" : totalPnLUsd < 0 ? "🔴" : "⚪";
  const usdIdrRate = await getUsdIdrRate().catch(() => null);

  const lines = [
    `☀️ <b>Morning Briefing</b>` ,
    `${todayWib} WIB · last 24h`,
    "",
    `<b>📊 Performance</b>`,
    `${pnlIcon} Net PnL: <b>${signedUsd(totalPnLUsd)}</b>${signedIdr(totalPnLUsd, usdIdrRate)}` ,
    `💵 Fees: $${totalFeesUsd.toFixed(2)}`,
    `🎯 Win rate: ${perfLast24h.length ? `${Math.round((wins24h / perfLast24h.length) * 100)}% (${wins24h}/${perfLast24h.length})` : "N/A"}`,
    `⌛ Avg hold: ${avgHoldMin == null ? "N/A" : formatDuration(avgHoldMin)}`,
    `📍 Avg in-range: ${avgRangeEff == null ? "N/A" : `${Math.round(avgRangeEff)}%`}`,
    "",
    `<b>💼 Activity</b>`,
    `📥 Opened: ${openedLast24h.length}`,
    `📤 Closed: ${closedLast24h.length}`,
    `📂 Open now: ${openPositions.length}/${config.risk.maxPositions}`,
    activeInstructions ? `📝 Active instructions: ${activeInstructions}` : null,
    "",
    `<b>🏆 Best / Worst Close</b>`,
    bestClose ? `🟢 Best: ${escapeHtml(bestClose.pool_name || bestClose.pool || "Unknown")} ${signedUsd(bestClose.pnl_usd)} (${signedPct(bestClose.pnl_pct)})` : "• No closes yet",
    worstClose && worstClose !== bestClose ? `${(worstClose.pnl_usd || 0) >= 0 ? "🟢" : "🔴"} Worst: ${escapeHtml(worstClose.pool_name || worstClose.pool || "Unknown")} ${signedUsd(worstClose.pnl_usd)} (${signedPct(worstClose.pnl_pct)})` : null,
  ].filter(line => line !== null && line !== undefined);

  if (openPositions.length) {
    lines.push("", `<b>📌 Open Positions</b>`);
    for (const p of openPositions.slice(0, 5)) {
      const ageMin = (now.getTime() - new Date(p.deployed_at).getTime()) / 60000;
      const oor = p.out_of_range_since ? " 🔴 OOR" : " 🟢 IN";
      lines.push(`• ${escapeHtml(p.pool_name || p.pool || "Unknown")} · ${formatDuration(ageMin)} · ${p.strategy || "?"}${oor}`);
    }
  }

  if (recentDecisions.length) {
    lines.push("", `<b>🧭 Recent Decisions</b>`);
    for (const d of recentDecisions) {
      const label = d.type === "deploy" ? "🚀" : d.type === "close" ? "🔒" : "⛔";
      lines.push(`${label} ${escapeHtml(d.summary || d.reason || d.type)}${d.pool_name ? ` · ${escapeHtml(d.pool_name)}` : ""}`);
    }
  }

  if (perfSummary) {
    lines.push(
      "",
      `<b>📈 All-Time</b>`,
      `Closed: ${perfSummary.total_positions_closed} · Win: ${perfSummary.win_rate_pct}%`,
      `PnL: ${signedUsd(perfSummary.total_pnl_usd)} · Avg: ${signedPct(perfSummary.avg_pnl_pct)}`,
      `Lessons: ${perfSummary.total_lessons} · detail: /lessons`
    );
  }

  return lines.join("\n");
}

export function generateLessonsReport({ limit = 20 } = {}) {
  const lessonsData = loadJson(LESSONS_FILE) || { lessons: [], performance: [] };
  const lessons = [...(lessonsData.lessons || [])]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const pinned = lessons.filter(l => l.pinned).slice(0, 5);
  const recent = lessons.filter(l => !l.pinned).slice(0, limit);
  const badCount = lessons.filter(l => ["bad", "poor", "failed"].includes(String(l.outcome || "").toLowerCase())).length;
  const goodCount = lessons.filter(l => ["good", "worked", "evolution"].includes(String(l.outcome || "").toLowerCase())).length;

  const lines = [
    "🧠 <b>Lessons</b>",
    `Total: ${lessons.length} · Good: ${goodCount} · Bad: ${badCount}`,
    "",
  ];

  if (!lessons.length) {
    lines.push("Belum ada lessons.");
    return lines.join("\n");
  }

  if (pinned.length) {
    lines.push("📌 <b>Pinned</b>");
    for (const lesson of pinned) appendTelegramLine(lines, formatLessonLine(lesson));
    lines.push("");
  }

  lines.push(`🕒 <b>Recent ${Math.min(recent.length, limit)}</b>`);
  let shownRecent = 0;
  for (const lesson of recent) {
    if (!appendTelegramLine(lines, formatLessonLine(lesson))) break;
    shownRecent += 1;
  }
  if (shownRecent < recent.length) lines.push(`… ${recent.length - shownRecent} more. Use /lessons ${Math.min(40, limit + 10)} for another batch later.`);
  lines.push("", "Tip: pinned lessons stay in agent prompt; this report is read-only.");
  return lines.join("\n");
}

function appendTelegramLine(lines, line, maxChars = 3900) {
  const next = [...lines, line].join("\n");
  if (next.length > maxChars) return false;
  lines.push(line);
  return true;
}

function formatLessonLine(lesson) {
  const outcome = String(lesson.outcome || "neutral").toLowerCase();
  const icon = ["bad", "poor", "failed"].includes(outcome) ? "🔴" : ["good", "worked", "evolution"].includes(outcome) ? "🟢" : "⚪";
  const date = lesson.created_at ? lesson.created_at.slice(0, 10) : "unknown";
  const role = lesson.role ? ` · ${escapeHtml(lesson.role)}` : "";
  const tags = Array.isArray(lesson.tags) && lesson.tags.length ? ` · #${lesson.tags.slice(0, 3).map(escapeHtml).join(" #")}` : "";
  const rule = escapeHtml(String(lesson.rule || "").slice(0, 260));
  return `${icon} <code>${lesson.id || "?"}</code> · ${date}${role}${tags}\n${rule}`;
}

function signedUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$?";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function signedIdr(usdValue, usdIdrRate) {
  const usd = Number(usdValue);
  const rate = Number(usdIdrRate);
  if (!Number.isFinite(usd) || !Number.isFinite(rate) || rate <= 0) return "";
  const value = usd * rate;
  return ` (${value >= 0 ? "+" : "-"}Rp${Math.round(Math.abs(value)).toLocaleString("id-ID")})`;
}

function signedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "?";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2).replace(/\.00$/, "")}%`;
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    log("briefing_error", `Failed to read ${file}: ${err.message}`);
    return null;
  }
}
