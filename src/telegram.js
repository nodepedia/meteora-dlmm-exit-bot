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

function pad(value, width) {
  const text = String(value ?? "");
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function formatTelegramTableMessage(title, columns, rows = [], footer = null) {
  const widths = columns.map((col, index) => {
    const headerWidth = String(col.header).length;
    const cellWidth = Math.max(
      0,
      ...rows.map((row) => String(row[index] ?? "").length)
    );
    return Math.min(col.width || Math.max(headerWidth, cellWidth), 36);
  });

  const header = columns.map((col, index) => pad(col.header, widths[index])).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  const body = rows.map((row) =>
    row.map((cell, index) => pad(String(cell ?? ""), widths[index])).join(" | ")
  );

  const lines = [`<b>${escapeHtml(title)}</b>`, "", "<pre>"];
  lines.push(escapeHtml(header));
  lines.push(escapeHtml(divider));
  for (const line of body) {
    lines.push(escapeHtml(line));
  }
  lines.push("</pre>");

  if (footer) {
    lines.push("");
    lines.push(`<i>${escapeHtml(footer)}</i>`);
  }

  return lines.join("\n");
}

export function formatTelegramReportMessage(title, metaLines = [], columns, rows = [], footer = null) {
  const widths = columns.map((col, index) => {
    const headerWidth = String(col.header).length;
    const cellWidth = Math.max(0, ...rows.map((row) => String(row[index] ?? "").length));
    return Math.min(col.width || Math.max(headerWidth, cellWidth), 24);
  });

  const header = columns.map((col, index) => pad(col.header, widths[index])).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  const body = rows.map((row) =>
    row.map((cell, index) => pad(String(cell ?? ""), widths[index])).join(" | ")
  );

  const lines = [`<b>${escapeHtml(title)}</b>`];
  for (const line of metaLines) {
    if (!line) continue;
    lines.push(escapeHtml(line));
  }
  lines.push("");
  lines.push("<pre>");
  lines.push(escapeHtml(header));
  lines.push(escapeHtml(divider));
  for (const line of body) {
    lines.push(escapeHtml(line));
  }
  lines.push("</pre>");

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
