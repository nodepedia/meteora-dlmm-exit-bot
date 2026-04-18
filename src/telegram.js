import { config } from "./config.js";
import { log } from "./logger.js";

const dedupeCache = new Map();

function isEnabled() {
  return !!(config.telegram.botToken && config.telegram.chatId);
}

export async function sendTelegramMessage(text, { dedupeKey = null, dedupeMs = 120000 } = {}) {
  if (!isEnabled()) return { skipped: true, reason: "telegram_not_configured" };

  if (dedupeKey) {
    const last = dedupeCache.get(dedupeKey) || 0;
    if (Date.now() - last < dedupeMs) {
      return { skipped: true, reason: "deduped" };
    }
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log("warn", `Telegram send failed: ${res.status} ${body}`);
    return { success: false, error: `Telegram send failed: ${res.status}` };
  }

  if (dedupeKey) {
    dedupeCache.set(dedupeKey, Date.now());
  }

  return { success: true };
}
