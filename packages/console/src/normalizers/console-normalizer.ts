import type { DevLensEventInput, EventSeverity } from "@devlens/core";
import type { ConsoleMethod } from "../types";

const TITLES: Record<ConsoleMethod, string> = {
  log: "Console Log",
  info: "Console Info",
  debug: "Console Debug",
  warn: "Console Warning",
  error: "Console Error",
};

const SEVERITIES: Record<ConsoleMethod, EventSeverity> = {
  log: "info",
  info: "info",
  debug: "debug",
  warn: "warn",
  error: "error",
};

/**
 * Best-effort string coercion for the first console argument, used as the
 * event's `message`. Same fallback strategy already established in Runtime
 * for unhandled rejection reasons: strings pass through, numbers/booleans
 * coerce directly, everything else attempts JSON.stringify and falls back
 * to String() (handles circular objects, which JSON.stringify throws on).
 */
function describeFirstArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
  if (arg === undefined) return "undefined";
  if (arg === null) return "null";
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Pure function: console method + raw arguments -> DevLensEventInput.
 * No side effects, no bus access — testable entirely in isolation.
 */
export function normalizeConsoleCall(
  method: ConsoleMethod,
  args: unknown[]
): DevLensEventInput {
  const [first] = args;
  const message = args.length === 0 ? "" : describeFirstArg(first);
  const stack = first instanceof Error ? first.stack : undefined;

  return {
    origin: `console.${method}`,
    category: "console",
    severity: SEVERITIES[method],
    title: TITLES[method],
    message,
    stack,
    // Full, untouched argument list preserved as structured data — not
    // stringified. Per ADR-0007, object snapshotting vs. live references
    // is intentionally deferred until the Panel consumes this.
    metadata: { args },
  };
}