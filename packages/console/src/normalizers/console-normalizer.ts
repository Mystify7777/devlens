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
 *
 * TODO(v2): only the FIRST argument is inspected for message/stack
 * extraction. console.error("failed", err) currently loses err.stack,
 * since the Error is args[1], not args[0]. Worth scanning all args for
 * an Error instance in a future revision — deferred for v1 since the
 * common case (console.error(err) alone) already works correctly.
 */
export function normalizeConsoleCall(method: ConsoleMethod, args: unknown[]): DevLensEventInput {
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
    // stringified, not snapshotted. metadata.args is the exact array
    // the caller passed, same references throughout (Issue #19 /
    // ADR-0007's amendment) — matching the same live-reference
    // behavior Chrome/Firefox's own consoles use for logged objects.
    metadata: { args },
    // Reporting this event must not freeze or traverse `args` — it's
    // the caller's own live data, not DevLens's to mutate. `args`
    // itself (not its individual elements) is enough: EventBus.report()
    // seeds deepFreeze's cycle-guard with this exact reference, so
    // recursion into it — and everything reachable from it — never
    // happens at all. See DevLensEventInput.externallyOwned's own doc
    // comment for the full mechanism.
    externallyOwned: [args],
  };
}
