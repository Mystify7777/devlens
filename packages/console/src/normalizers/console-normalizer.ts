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
 * Identity-based (instanceof Error) — never duck-types or reads properties
 * of non-Error arguments, so hostile getters are never invoked.
 */
function findLaterErrorStack(args: unknown[]): string | undefined {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg instanceof Error) {
      const stack = arg.stack;
      if (typeof stack === "string" && stack !== "") return stack;
    }
  }
  return undefined;
}

/**
 * Pure function: console method + raw arguments -> DevLensEventInput.
 * No side effects, no bus access — testable entirely in isolation.
 *
 * Stack derivation (ADR-0007, Issue #22 amendment):
 * - args[0] is an Error: its stack is authoritative (may be undefined);
 *   later arguments are never consulted, keeping message and stack coherent.
 * - otherwise: first Error in args[1..] with a non-empty string stack.
 * `message` remains first-argument-only.
 */
export function normalizeConsoleCall(method: ConsoleMethod, args: unknown[]): DevLensEventInput {
  const [first] = args;
  const message = args.length === 0 ? "" : describeFirstArg(first);
  const stack = first instanceof Error ? first.stack : findLaterErrorStack(args);

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
