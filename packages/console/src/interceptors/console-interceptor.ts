import type { EventBus } from "@devlens/core";
import type { ConsoleMethod } from "../types";
import { normalizeConsoleCall } from "../normalizers/console-normalizer";

export interface CreateInterceptorOptions {
  method: ConsoleMethod;
  bus: EventBus;
  original: (...args: unknown[]) => void;
  /**
   * A tiny mutable holder for the shared reentrancy flag. Not a
   * getter/setter pair — there's no independent behavior to abstract,
   * just one boolean five interceptors need to read and write. Plain
   * lexical closure over this object is simpler than the getter/setter
   * indirection from the previous revision.
   */
  state: { isDispatching: boolean };
}

/**
 * Wraps a single console method. The original always runs first and
 * unconditionally, so console output is never suppressed by a DevLens
 * failure. state.isDispatching guards only the report step — a
 * console.log called reentrantly from inside a bus subscriber still
 * prints, it just doesn't trigger a second report.
 */
export function createInterceptor({ method, bus, original, state }: CreateInterceptorOptions) {
  return function intercepted(...args: unknown[]) {
    original(...args);

    if (state.isDispatching) return;

    state.isDispatching = true;
    try {
      // Unguarded by the catch below — a normalization bug is a DevLens
      // programming error and should surface, not be hidden alongside
      // operational bus failures.
      const event = normalizeConsoleCall(method, args);
      try {
        bus.report(event);
      } catch {
        // Intentionally narrow: suppresses ONLY bus.report() failures
        // (e.g. EventBusDestroyedError), preserving host console behavior.
      }
    } finally {
      state.isDispatching = false;
    }
  };
}