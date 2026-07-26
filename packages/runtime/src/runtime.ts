import type { EventBus } from "@devlens/core";
import type { Plugin } from "./types";
import { createErrorListener } from "./listeners/error-listener";
import { createUnhandledRejectionListener } from "./listeners/unhandled-rejection-listener";

export function createRuntimePlugin(bus: EventBus): Plugin {
  let installed = false;
  let onError: ((event: ErrorEvent) => void) | null = null;
  let onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;

  return {
    install() {
      if (installed) return;
      if (typeof window === "undefined") return;

      onError = createErrorListener(bus);
      onUnhandledRejection = createUnhandledRejectionListener(bus);

      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onUnhandledRejection);
      installed = true;
    },

    uninstall() {
      if (!installed) return;
      if (typeof window !== "undefined") {
        if (onError) window.removeEventListener("error", onError);
        if (onUnhandledRejection) {
          window.removeEventListener("unhandledrejection", onUnhandledRejection);
        }
      }
      onError = null;
      onUnhandledRejection = null;
      installed = false;
    },
  };
}