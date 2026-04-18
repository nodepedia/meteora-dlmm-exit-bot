import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? 1;
const TIMEZONE = process.env.TIMEZONE || "Asia/Jakarta";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms} ${TIMEZONE}`;
}

export function log(level, message) {
  const normalized = LEVELS[level] != null ? level : "info";
  if (LEVELS[normalized] < currentLevel) return;

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const line = `[${timestamp}] [${normalized.toUpperCase()}] ${message}`;
  console.log(line);

  const dateStr = timestamp.slice(0, 10);
  const file = path.join(LOG_DIR, `bot-${dateStr}.log`);
  fs.appendFileSync(file, line + "\n");
}
