import pino, { Logger } from "pino";

export function makeLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "mcp-gateway" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
