import assert from "node:assert/strict";
import { BOT_COMMANDS } from "../telegram.js";

const commands = new Set(BOT_COMMANDS.map((entry) => entry.command));
for (const cmd of [
  "help",
  "status",
  "wallet",
  "positions",
  "pnl",
  "pnltoday",
  "paper",
  "paperclose",
  "pool",
  "close",
  "closeall",
  "set",
  "config",
  "settings",
  "setcfg",
  "screen",
  "candidates",
  "deploy",
  "briefing",
  "hive",
  "pause",
  "resume",
  "stop",
]) {
  assert.ok(commands.has(cmd), `missing Telegram bot command: ${cmd}`);
}

assert.ok(BOT_COMMANDS.length <= 100, "Telegram setMyCommands supports up to 100 commands");
console.log("✅ Telegram command registry includes all documented commands");
