import { config } from "./config.js";
import { log } from "./logger.js";

const dedupeCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnabled() {
  return !!(config.telegram.botToken && config.telegram.chatId);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatTelegramMessage(title, fields = [], footer = null) {
  const lines = [`<b>${escapeHtml(title)}</b>`];

  for (const field of fields) {
    if (!field || field.value == null || field.value === "") continue;
    const label = `<b>${escapeHtml(field.label)}:</b>`;
    const value = field.code
      ? `<code>${escapeHtml(field.value)}</code>`
      : escapeHtml(field.value);
    lines.push(`${label} ${value}`);
  }

  if (footer) {
    lines.push("");
    lines.push(`<i>${escapeHtml(footer)}</i>`);
  }

  return lines.join("\n");
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
  const attempts = Math.max(1, (config.telegram.retryCount ?? 1) + 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.telegram.timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const reason = `Telegram send failed: ${res.status} ${body}`;
        if (attempt < attempts) {
          log("warn", `${reason}. Retrying ${attempt}/${attempts - 1}...`);
          await sleep(1000 * attempt);
          continue;
        }
        log("warn", reason);
        return { success: false, error: reason };
      }

      if (dedupeKey) {
        dedupeCache.set(dedupeKey, Date.now());
      }

      return { success: true };
    } catch (error) {
      const reason = error?.name === "AbortError"
        ? `Telegram send timed out after ${config.telegram.timeoutMs}ms`
        : `Telegram send failed: ${error.message}`;
      if (attempt < attempts) {
        log("warn", `${reason}. Retrying ${attempt}/${attempts - 1}...`);
        await sleep(1000 * attempt);
        continue;
      }
      log("warn", reason);
      return { success: false, error: reason };
    }
  }
}
