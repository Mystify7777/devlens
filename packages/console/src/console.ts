import type { EventBus, Plugin } from "@devlens/core";
import type { ConsoleMethod } from "./types";
import { createInterceptor } from "./interceptors/console-interceptor";

const METHODS: ConsoleMethod[] = ["log", "info", "debug", "warn", "error"];

export function createConsolePlugin(bus: EventBus): Plugin {
  let installed = false;
  let originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  let isDispatching = false;

  return {
    install() {
      if (installed) return;
      if (typeof console === "undefined") return;

      for (const method of METHODS) {
        const original = console[method].bind(console);
        originals[method] = original;
        console[method] = createInterceptor({
          method,
          bus,
          original,
          getIsDispatching: () => isDispatching,
          setIsDispatching: (value) => {
            isDispatching = value;
          },
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