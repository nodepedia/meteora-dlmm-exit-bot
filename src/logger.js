import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? 1;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function log(level, message) {
  const normalized = LEVELS[level] != null ? level : "info";
  if (LEVELS[normalized] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${normalized.toUpperCase()}] ${message}`;
  console.log(line);

  const dateStr = timestamp.slice(0, 10);
  const file = path.join(LOG_DIR, `bot-${dateStr}.log`);
  fs.appendFileSync(file, line + "\n");
}
