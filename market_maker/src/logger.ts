import { config } from "./config";

type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = levels[config.logLevel as LogLevel] ?? 1;

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] ${level.toUpperCase()} ${message}${metaStr}`;
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= levels.debug) console.log(formatMessage("debug", message, meta));
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= levels.info) console.log(formatMessage("info", message, meta));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= levels.warn) console.warn(formatMessage("warn", message, meta));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= levels.error) console.error(formatMessage("error", message, meta));
  },
};