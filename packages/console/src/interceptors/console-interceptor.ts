import type { EventBus } from "@devlens/core";
import type { ConsoleMethod } from "../types";
import { normalizeConsoleCall } from "../normalizers/console-normalizer";

export interface CreateInterceptorOptions {
  method: ConsoleMethod;
  bus: EventBus;
  original: (...args: unknown[]) => void;
  /** Shared, per-plugin-instance reentrancy flag — see ADR-0007. */
  isDispatchingRef: { current: boolean };
}

/**
 * Wraps a single console method. Order of operations matters and is
 * non-negotiable per ADR-0007: the original method ALWAYS runs first and
 * unconditionally, so console output is never suppressed by a DevLens
 * failure. The recursion guard wraps only the report step, not the
 * passthrough — a console.log called reentrantly from inside a bus
 * subscriber still prints, it just doesn't trigger a second report.
 */
export function createInterceptor({
  method,
  bus,
  original,
  isDispatchingRef,
}: CreateInterceptorOptions) {
  return function intercepted(...args: unknown[]) {
    original(...args);

    if (isDispatchingRef.current) return;

    isDispatchingRef.current = true;
    try {
      // normalize() runs unguarded by the catch below — a bug in
      // normalization is a DevLens programming error and should surface,
      // not be silently swallowed alongside operational bus failures.
      const event = normalizeConsoleCall(method, args);
      try {
        bus.report(event);
      } catch {
        // Intentionally narrow: suppresses ONLY failures from bus.report()
        // (e.g. EventBusDestroyedError), so a destroyed/misbehaving bus
        // can never break the host application's own console calls.
      }
    } finally {
      isDispatchingRef.current = false;
    }
  };
}