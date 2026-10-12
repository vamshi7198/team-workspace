import pino from "pino";

// Structured JSON logs to stdout. Never log document bodies, passwords, tokens or cookies.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  redact: {
    paths: ["password", "*.password", "token", "*.token", "headers.cookie", "headers.authorization"],
    censor: "[redacted]",
  },
});
