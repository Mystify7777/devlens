import type { EventBus } from "@devlens/core";
import type { ConsoleMethod } from "../types";
import { normalizeConsoleCall } from "../normalizers/console-normalizer";

export interface CreateInterceptorOptions {
  method: ConsoleMethod;
  bus: EventBus;
  original: (...args: unknown[]) => void;
  getIsDispatching: () => boolean;
  setIsDispatching: (value: boolean) => void;
}

/**
 * Wraps a single console method. The original always runs first and
 * unconditionally, so console output is never suppressed by a DevLens
 * failure. isDispatching is owned by createConsolePlugin() and shared
 * across all five interceptors via closure — no ref object needed, this
 * isn't React state, it's a plain boolean five functions close over.
 */
export function createInterceptor({
  method,
  bus,
  original,
  getIsDispatching,
  setIsDispatching,
}: CreateInterceptorOptions) {
  return function intercepted(...args: unknown[]) {
    original(...args);

    if (getIsDispatching()) return;

    setIsDispatching(true);
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
      setIsDispatching(false);
    }
  };
}