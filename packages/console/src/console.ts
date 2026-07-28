import type { EventBus, Plugin } from "@devlens/core";
import type { ConsoleMethod } from "./types";
import { createInterceptor } from "./interceptors/console-interceptor";

const METHODS: ConsoleMethod[] = ["log", "info", "debug", "warn", "error"];

export function createConsolePlugin(bus: EventBus): Plugin {
  let installed = false;
  let originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  // Shared across all five wrapped methods — recursion can jump between
  // methods (e.g. console.error's report triggers a subscriber's console.log),
  // so the guard must be one flag per plugin instance, not one per method.
  const isDispatchingRef = { current: false };

  return {
    install() {
      if (installed) return;
      if (typeof console === "undefined") return;

      for (const method of METHODS) {
        // Capture whatever is currently assigned — preserves any
        // pre-existing wrapping from another tool rather than assuming
        // it's the pristine native implementation.
        const original = console[method].bind(console);
        originals[method] = original;
        console[method] = createInterceptor({
          method,
          bus,
          original,
          isDispatchingRef,
        });
      }
      installed = true;
    },

    uninstall() {
      if (!installed) return;
      for (const method of METHODS) {
        const original = originals[method];
        if (original) {
          console[method] = original;
        }
      }
      originals = {};
      installed = false;
    },
  };
}