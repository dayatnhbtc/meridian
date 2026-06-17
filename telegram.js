import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";
import { getTrackedPosition } from "./state.js";

const USER_CONFIG_PATH = repoPath("user-config.json");
const OFFSET_PATH = repoPath(".telegram-offset");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const BASE  = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const ALLOWED_USER_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

let chatId = null;
let _offset  = 0;
let _polling = false;
let _liveMessageDepth = 0;
const _activeLiveMessages = new Set();

// Persist Telegram update offset so /stop doesn't replay on restart
try { const raw = fs.readFileSync(OFFSET_PATH, "utf8"); _offset = parseInt(raw, 10) || 0; } catch {}
function saveOffset() { try { fs.writeFileSync(OFFSET_PATH, String(_offset)); } catch {} }
let _warnedMissingChatId = false;
let _warnedMissingAllowedUsers = false;

function nonEmptyChatId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

// ─── chatId persistence ──────────────────────────────────────────
function resolveChatId() {
  const fromEnv = nonEmptyChatId(process.env.TELEGRAM_CHAT_ID);
  let fromConfig = null;
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      fromConfig = nonEmptyChatId(cfg.telegramChatId);
    }
  } catch (error) {
    log("telegram_warn", `Invalid user-config.json; chatId not loaded: ${error.message}`);
  }
  // user-config wins when set; otherwise fall back to .env
  const resolved = fromConfig || fromEnv || null;
  return resolved != null ? String(resolved) : null;
}

function loadChatId() {
  chatId = resolveChatId();
}

function saveChatId(id) {
  try {
    let cfg = fs.existsSync(USER_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
      : {};
    cfg.telegramChatId = id;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    log("telegram_error", `Failed to persist chatId: ${e.message}`);
  }
}

loadChatId();

function isAuthorizedIncomingMessage(msg) {
  const incomingChatId = String(msg.chat?.id || "");
  const senderUserId = msg.from?.id != null ? String(msg.from.id) : null;
  const chatType = msg.chat?.type || "unknown";

  if (!chatId) {
    if (!_warnedMissingChatId) {
      log("telegram_warn", "Ignoring inbound Telegram messages because TELEGRAM_CHAT_ID / user-config.telegramChatId is not configured. Auto-registration is disabled for safety.");
      _warnedMissingChatId = true;
    }
    return false;
  }

  if (incomingChatId !== String(chatId)) return false;

  if (chatType !== "private" && ALLOWED_USER_IDS.size === 0) {
    if (!_warnedMissingAllowedUsers) {
      log("telegram_warn", "Ignoring group Telegram messages because TELEGRAM_ALLOWED_USER_IDS is not configured. Set explicit allowed user IDs for command/control.");
      _warnedMissingAllowedUsers = true;
    }
    return false;
  }

  if (ALLOWED_USER_IDS.size > 0) {
    if (!senderUserId || !ALLOWED_USER_IDS.has(senderUserId)) return false;
  }

  return true;
}

// ─── Core send ───────────────────────────────────────────────────
export function isEnabled() {
  return !!TOKEN;
}

async function postTelegram(method, body) {
  if (!TOKEN || !chatId) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...body }),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN in .env (invalid, revoked, or encrypted without .envrypt key)`);
      } else {
        log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    log("telegram_error", `${method} failed: ${e.message}`);
    return null;
  }
}

async function postTelegramRaw(method, body) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN in .env (invalid, revoked, or encrypted without .envrypt key)`);
      } else {
        log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    log("telegram_error", `${method} failed: ${e.message}`);
    return null;
  }
}

export async function sendMessage(text) {
  if (!TOKEN || !chatId) return;
  // Convert markdown-style formatting to HTML for Telegram
  const html = String(text)
    .slice(0, 4096)
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')     // **bold** → <b>bold</b>
    .replace(/`([^`]+)`/g, '<code>$1</code>');      // `code` → <code>code</code>
  return postTelegram("sendMessage", { text: html, parse_mode: "HTML" });
}

export async function sendMessageWithButtons(text, inlineKeyboard) {
  if (!TOKEN || !chatId) return;
  const html = String(text)
    .slice(0, 4096)
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return postTelegram("sendMessage", {
    text: html,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

export function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendHTML(html) {
  if (!TOKEN || !chatId) return;
  const safe = String(html).replace(/"/g, "&quot;").slice(0, 4096);
  return postTelegram("sendMessage", { text: safe, parse_mode: "HTML" });
}

export async function editMessage(text, messageId) {
  if (!TOKEN || !chatId || !messageId) return null;
  const html = String(text)
    .slice(0, 4096)
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return postTelegram("editMessageText", {
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
  });
}

export async function editHTML(html, messageId) {
  if (!TOKEN || !chatId || !messageId) return null;
  const safe = String(html).replace(/"/g, "&quot;").slice(0, 4096);
  return postTelegram("editMessageText", {
    message_id: messageId,
    text: safe,
    parse_mode: "HTML",
  });
}

export async function editMessageWithButtons(text, messageId, inlineKeyboard) {
  if (!TOKEN || !chatId || !messageId) return null;
  const html = String(text)
    .slice(0, 4096)
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return postTelegram("editMessageText", {
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

// ─── Rich Message (Bot API 10.1+) ────────────────────────────────────
// Supports GFM + block-level HTML: headings, tables, lists, blockquotes,
// task lists, collapsible details, formulas. Up to 32768 chars, 500 blocks.

const RICH_MSG_LIMIT = 32768;

export async function sendRichMarkdown(text) {
  if (!TOKEN || !chatId) return;
  const safe = String(text).slice(0, RICH_MSG_LIMIT);
  return postTelegram("sendRichMessage", {
    rich_message: { markdown: safe },
  });
}

export async function sendRichHTML(text) {
  if (!TOKEN || !chatId) return;
  const safe = String(text).replace(/"/g, "&quot;").slice(0, RICH_MSG_LIMIT);
  return postTelegram("sendRichMessage", {
    rich_message: { html: safe },
  });
}

export async function editRichMarkdown(text, messageId) {
  if (!TOKEN || !chatId || !messageId) return null;
  const safe = String(text).slice(0, RICH_MSG_LIMIT);
  return postTelegram("editMessageText", {
    message_id: messageId,
    rich_message: { markdown: safe },
  });
}

export async function editRichHTML(text, messageId) {
  if (!TOKEN || !chatId || !messageId) return null;
  const safe = String(text).replace(/"/g, "&quot;").slice(0, RICH_MSG_LIMIT);
  return postTelegram("editMessageText", {
    message_id: messageId,
    rich_message: { html: safe },
  });
}

// ─── Callback Query ──────────────────────────────────────────────

export async function answerCallbackQuery(callbackQueryId, text = "") {
  if (!TOKEN || !callbackQueryId) return null;
  return postTelegramRaw("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text).slice(0, 200) } : {}),
  });
}

export function hasActiveLiveMessage() {
  return _liveMessageDepth > 0;
}

function createTypingIndicator() {
  if (!TOKEN || !chatId) {
    return { stop() {} };
  }

  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    await postTelegram("sendChatAction", { action: "typing" });
    timer = setTimeout(() => {
      tick().catch(() => null);
    }, 4000);
  }

  tick().catch(() => null);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function toolLabel(name) {
  const labels = {
    get_token_info: "get token info",
    get_token_narrative: "get token narrative",
    get_token_holders: "get token holders",
    get_top_candidates: "get top candidates",
    get_pool_detail: "get pool detail",
    get_active_bin: "get active bin",
    deploy_position: "deploy position",
    close_position: "close position",
    claim_fees: "claim fees",
    swap_token: "swap token",
    update_config: "update config",
    get_my_positions: "get positions",
    get_wallet_balance: "get wallet balance",
    check_smart_wallets_on_pool: "check smart wallets",
    study_top_lpers: "study top LPers",
    get_top_lpers: "get top LPers",
    search_pools: "search pools",
    discover_pools: "discover pools",
  };
  return labels[name] || name.replace(/_/g, " ");
}

function summarizeToolResult(name, result) {
  if (!result) return "";
  if (result.error) return result.error;
  if (result.reason && result.blocked) return result.reason;
  switch (name) {
    case "deploy_position":
      return result.position ? `position ${String(result.position).slice(0, 8)}...` : "submitted";
    case "close_position":
      return result.success ? "closed" : (result.reason || "failed");
    case "claim_fees":
      return result.claimed_amount != null ? `claimed ${result.claimed_amount}` : "done";
    case "update_config":
      return Object.keys(result.applied || {}).join(", ") || "updated";
    case "get_top_candidates":
      return `${result.candidates?.length ?? 0} candidates`;
    case "get_my_positions":
      return `${result.total_positions ?? result.positions?.length ?? 0} positions`;
    case "get_wallet_balance":
      return `${result.sol ?? "?"} SOL`;
    case "study_top_lpers":
    case "get_top_lpers":
      return `${result.lpers?.length ?? 0} LPers`;
    default:
      return result.success === false ? "failed" : "done";
  }
}

export async function createLiveMessage(title, intro = "Starting...", options = {}) {
  if (!TOKEN || !chatId) return null;
  const typing = createTypingIndicator();
  const useHTML = options.parseMode === "HTML";
  const useRich = options.richMode ?? true; // default to rich markdown

  const state = {
    title,
    intro,
    toolLines: [],
    footer: "",
    messageId: null,
    flushTimer: null,
    flushPromise: null,
    flushRequested: null,
  };

  function render() {
    // In HTML mode the plain-text parts (title/intro/tool progress) must be escaped;
    // the footer is caller-provided pre-formatted HTML, so it is passed through as-is.
    const esc = (s) => (useHTML ? escapeHtml(String(s)) : s);
    const sections = [esc(state.title)];
    if (state.intro) sections.push(esc(state.intro));
    if (state.toolLines.length > 0) sections.push(esc(state.toolLines.join("\n")));
    if (state.footer) sections.push(state.footer);
    return sections.join("\n\n").slice(0, RICH_MSG_LIMIT);
  }

  async function flushNow() {
    state.flushTimer = null;
    state.flushRequested = false;
    const text = render();
    if (!state.messageId) {
      let sent;
      if (useRich) sent = await sendRichMarkdown(text);
      else if (useHTML) sent = await sendHTML(text);
      else sent = await sendMessage(text);
      state.messageId = sent?.result?.message_id ?? null;
      return;
    }
    if (useRich) await editRichMarkdown(text, state.messageId);
    else if (useHTML) await editHTML(text, state.messageId);
    else await editMessage(text, state.messageId);
  }

  function scheduleFlush(delay = 300) {
    if (state.flushTimer) {
      state.flushRequested = true;
      return;
    }
    state.flushTimer = setTimeout(() => {
      state.flushPromise = flushNow().catch(() => null);
    }, delay);
  }

  async function upsertToolLine(name, icon, suffix = "") {
    const label = toolLabel(name);
    const line = `${icon} ${label}${suffix ? ` ${suffix}` : ""}`;
    const idx = state.toolLines.findIndex((entry) => entry.includes(` ${label}`));
    if (idx >= 0) state.toolLines[idx] = line;
    else state.toolLines.push(line);
    scheduleFlush();
  }

  function finishLiveMessage(handle) {
    if (state.done) return;
    state.done = true;
    _activeLiveMessages.delete(handle);
    _liveMessageDepth = Math.max(0, _liveMessageDepth - 1);
    typing.stop();
  }

  _liveMessageDepth += 1;
  await flushNow();

  const handle = {
    async toolStart(name) {
      await upsertToolLine(name, "ℹ️", "...");
    },
    async toolFinish(name, result, success) {
      const icon = success ? "✅" : "❌";
      const summary = summarizeToolResult(name, result);
      await upsertToolLine(name, icon, summary ? `— ${summary}` : "");
    },
    async note(text) {
      state.intro = text;
      scheduleFlush();
    },
    async finalize(finalText) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.flushPromise) await state.flushPromise;
      state.footer = finalText;
      await flushNow();
      finishLiveMessage(handle);
    },
    async fail(errorText) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.flushPromise) await state.flushPromise;
      state.footer = `❌ ${useHTML ? escapeHtml(String(errorText)) : errorText}`;
      await flushNow();
      finishLiveMessage(handle);
    },
  };

  _activeLiveMessages.add(handle);
  return handle;
}

export async function failActiveLiveMessages(reason = "Interrupted before completion.") {
  const handles = [..._activeLiveMessages];
  await Promise.allSettled(handles.map((handle) => handle.fail(reason)));
}


// ─── Long polling ────────────────────────────────────────────────
async function poll(onMessage) {
  while (_polling) {
    try {
      const res = await fetch(
        `${BASE}/getUpdates?offset=${_offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );
      if (!res.ok) { await sleep(5000); continue; }
      const data = await res.json();
      for (const update of data.result || []) {
        _offset = update.update_id + 1;
        saveOffset();
        const callback = update.callback_query;
        if (callback?.data && callback?.message) {
          const callbackMsg = {
            chat: callback.message.chat,
            from: callback.from,
            text: callback.data,
          };
          if (!isAuthorizedIncomingMessage(callbackMsg)) continue;
          await onMessage({
            ...callbackMsg,
            isCallback: true,
            callbackQueryId: callback.id,
            callbackData: callback.data,
            messageId: callback.message.message_id,
          });
          continue;
        }
        const msg = update.message;
        if (!msg?.text) continue;
        if (!isAuthorizedIncomingMessage(msg)) continue;
        await onMessage(msg);
      }
    } catch (e) {
      if (!e.message?.includes("aborted")) {
        log("telegram_error", `Poll error: ${e.message}`);
      }
      await sleep(5000);
    }
  }
}

export const BOT_COMMANDS = [
  { command: "help",       description: "Show commands" },
  { command: "status",     description: "Wallet + rich portfolio snapshot" },
  { command: "wallet",     description: "Wallet, deploy amount, HiveMind status" },
  { command: "positions",  description: "Rich open-position report" },
  { command: "pnl",        description: "Today PnL summary" },
  { command: "pnltoday",   description: "Today PnL detail" },
  { command: "pool",       description: "Detailed info for one open position" },
  { command: "close",      description: "Close one position by index" },
  { command: "closeall",   description: "Close all open positions" },
  { command: "set",        description: "Set note/instruction on position" },
  { command: "config",     description: "Show important runtime config" },
  { command: "settings",   description: "Button menu for common config" },
  { command: "menu",       description: "Alias for settings menu" },
  { command: "setcfg",     description: "Update persisted config key" },
  { command: "screen",     description: "Refresh deterministic candidate list" },
  { command: "candidates", description: "Show latest cached candidates" },
  { command: "deploy",     description: "Deploy candidate by cached index" },
  { command: "briefing",   description: "Morning briefing" },
  { command: "lessons",    description: "List learned lessons" },
  { command: "learning",   description: "Alias for lessons" },
  { command: "learn",      description: "Study top LPers and save lessons" },
  { command: "hive",       description: "HiveMind sync status" },
  { command: "pause",      description: "Stop cron cycles" },
  { command: "resume",     description: "Start cron cycles again" },
  { command: "stop",       description: "Stop PM2 process" },
];

async function registerCommands() {
  if (!BASE) return;
  try {
    await fetch(`${BASE}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    log("telegram", "Bot commands registered");
  } catch (e) {
    log("telegram_warn", `Failed to register bot commands: ${e.message}`);
  }
}

export async function startPolling(onMessage) {
  if (!TOKEN) return;
  loadChatId();
  if (!chatId) {
    log("telegram_warn", "TELEGRAM_CHAT_ID not set in .env or user-config.telegramChatId — outbound notifications and inbound control disabled until configured.");
  }
  _polling = true;
  // Flush any stale updates queued while the bot was offline
  try {
    const flush = await fetch(`${BASE}/getUpdates?offset=-1&timeout=1`, { signal: AbortSignal.timeout(3000) });
    if (flush.ok) {
      const data = await flush.json();
      const updates = data.result || [];
      if (updates.length > 0) {
        _offset = Math.max(_offset, updates[updates.length - 1].update_id + 1);
        saveOffset();
        log("telegram", `Flushed ${updates.length} stale update(s) on startup`);
      }
    }
  } catch { /* best-effort */ }
  poll(onMessage); // fire-and-forget
  registerCommands();
  log("telegram", "Bot polling started");
}

export function stopPolling() {
  _polling = false;
}

// ─── Notification helpers ────────────────────────────────────────
export async function notifyDeploy({ pair, amountSol, position, tx, priceRange, rangeCoverage, binStep, baseFee }) {
  if (hasActiveLiveMessage()) return;
  const priceStr = priceRange
    ? `Price range: ${priceRange.min < 0.0001 ? priceRange.min.toExponential(3) : priceRange.min.toFixed(6)} – ${priceRange.max < 0.0001 ? priceRange.max.toExponential(3) : priceRange.max.toFixed(6)}\n`
    : "";
  const coverageStr = rangeCoverage
    ? `Range cover: ${fmtPct(rangeCoverage.downside_pct)} downside | ${fmtPct(rangeCoverage.upside_pct)} upside | ${fmtPct(rangeCoverage.width_pct)} total\n`
    : "";
  const poolStr = (binStep || baseFee)
    ? `Bin step: ${binStep ?? "?"}  |  Base fee: ${baseFee != null ? baseFee + "%" : "?"}\n`
    : "";
  await sendHTML(
    `✅ <b>Deployed</b> ${escapeHtml(pair)}\n` +
    `Amount: ${amountSol} SOL\n` +
    priceStr +
    coverageStr +
    poolStr +
    `Position: <code>${position?.slice(0, 8)}...</code>\n` +
    `Tx: <code>${tx?.slice(0, 16)}...</code>`
  );
}

export async function notifyClose({ pair, pnlUsd, pnlSol, pnlUsdPct, pnlSolPct, pnlPct, reason, positionAddress }) {
  if (hasActiveLiveMessage()) return;

  // Look up tracked position for extra data
  let tracked = null;
  if (positionAddress) {
    tracked = getTrackedPosition(positionAddress);
  }

  const solMode = !!tracked?.amount_sol;
  const netSol = (pnlSol ?? 0);
  const netUsdRaw = (pnlUsd ?? 0);
  const feesUsd = tracked?.total_fees_claimed_usd ?? 0;
  const netUsdTotal = netUsdRaw + feesUsd;
  const netSign = netUsdRaw >= 0 ? "+" : "";
  const netLabel = netUsdRaw >= 0 ? "✅" : "❌";
  const netTotalSign = netUsdTotal >= 0 ? "+" : "";
  const netTotalLabel = netUsdTotal >= 0 ? "✅" : "❌";

  // SOL PnL line
  const solSign = netSol >= 0 ? "+" : "";
  const solLabel = netSol >= 0 ? "✅" : "❌";

  // USD PnL line
  const usdSign = netUsdRaw >= 0 ? "+" : "";
  const usdLabel = netUsdRaw >= 0 ? "✅" : "❌";

  // Duration & in-range
  let durationStr = "?";
  let inRangePct = null;
  if (tracked?.deployed_at) {
    const heldMs = Date.now() - new Date(tracked.deployed_at).getTime();
    const heldMin = Math.floor(heldMs / 60000);
    const h = Math.floor(heldMin / 60);
    const m = heldMin % 60;
    durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

    const storedOorMin = Math.max(0, Number(tracked.total_minutes_out_of_range) || 0);
    const currentOorMin = tracked.out_of_range_since
      ? Math.max(0, Math.floor((Date.now() - new Date(tracked.out_of_range_since).getTime()) / 60000))
      : 0;
    const totalOorMin = storedOorMin + currentOorMin;
    const inRangeMin = Math.max(0, heldMin - totalOorMin);
    inRangePct = heldMin > 0 ? Math.round((inRangeMin / heldMin) * 100) : 100;
  }
  const inRangeIcon = inRangePct !== null && inRangePct >= 80 ? "🎯" : "⚠️";
  const inRangeStr = inRangePct !== null ? `${inRangePct}% In-Range ${inRangeIcon}` : "";

  // Exit reason (HTML-safe)
  const rawExit = reason || tracked?.notes?.filter(n => n.includes("Closed"))?.pop()?.replace(/^Closed at[^:]+:\s*/, "") || "agent decision";
  const exitLabel = rawExit.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Meta
  const metaParts = [];
  if (tracked?.volatility != null) metaParts.push(`vol = ${tracked.volatility}`);
  if (tracked?.fee_tvl_ratio != null) metaParts.push(`fee/TVL = ${tracked.fee_tvl_ratio}%`);
  const metaStr = metaParts.length > 0 ? `📊 Meta : ${metaParts.join(" | ")}` : "";

  const icon = netSol >= 0 ? "🟢" : "🔴";

  const lines = [
    `${icon} <b>CLOSED</b> | ${escapeHtml(pair)}`,
    `◎ ${solSign}${netSol.toFixed(4)} (${solSign}${(pnlSolPct ?? 0).toFixed(2)}%) ${solLabel}`,
    `💵 ${usdSign}$${(pnlUsd ?? 0).toFixed(2)} (${usdSign}${(pnlUsdPct ?? 0).toFixed(2)}%) ${usdLabel}`,
    `💰 Net : ${netTotalSign}$${netUsdTotal.toFixed(2)} ${netTotalLabel}`,
  ];
  // Fees if any
  if (tracked?.total_fees_claimed_usd > 0) {
    lines.splice(3, 0, `💸 Fees : $${tracked.total_fees_claimed_usd.toFixed(2)}`);
  }
  lines.push(`🤖 Exit : ${exitLabel}`);
  lines.push(`⏱️ Duration : ${durationStr}${inRangeStr ? ` | ${inRangeStr}` : ""}`);
  if (metaStr) lines.push(metaStr);

  await sendHTML(lines.join("\n"));
}

export async function notifySwap({ inputSymbol, outputSymbol, amountIn, amountOut, tx }) {
  if (hasActiveLiveMessage()) return;
  await sendHTML(
    `🔄 <b>Swapped</b> ${inputSymbol} → ${outputSymbol}\n` +
    `In: ${amountIn ?? "?"} | Out: ${amountOut ?? "?"}\n` +
    `Tx: <code>${tx?.slice(0, 16)}...</code>`
  );
}

export async function notifyOutOfRange({ pair, minutesOOR }) {
  if (hasActiveLiveMessage()) return;
  await sendHTML(
    `⚠️ <b>Out of Range</b> ${escapeHtml(pair)}\n` +
    `Been OOR for ${minutesOOR} minutes`
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "?";
}
