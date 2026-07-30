import type { EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { MAX_RENDERED_EVENTS } from "./constants";

/**
 * createPanel(store): Plugin — same install()/uninstall() shape as every
 * other DevLens plugin, even though Panel displays rather than captures.
 * Takes an EventStore, not an EventBus — Panel renders what's already
 * been captured, it doesn't capture anything itself.
 *
 * TODO(Session 3): actual subscription to store, initial render from
 * store.getAll(), live updates on new events.
 */
export function createPanel(store: EventStore): Plugin {
  let installed = false;
  let unsubscribe: (() => void) | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;

  return {
    install() {
      if (installed) return;
      if (typeof document === "undefined") return;

      overlay = createOverlay();
      const renderer = createRenderer(overlay.shadowRoot);

      // TODO(Session 3): renderer.render(store.getAll().slice(-MAX_RENDERED_EVENTS));
      // TODO(Session 3): unsubscribe = store.subscribe(() => renderer.render(...));

      overlay.mount();
      installed = true;
    },

    uninstall() {
      if (!installed) return;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (overlay) {
        overlay.unmount();
        overlay = null;
      }
      installed = false;
    },
  };
}