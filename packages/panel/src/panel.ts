// packages/panel/src/panel.ts
import type { EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { MAX_RENDERED_EVENTS } from "./constants";

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

      renderer.renderEventList(store.getAll().slice(-MAX_RENDERED_EVENTS));
      // No selection state yet — this call exists so the renderer
      // convention (renderInspector(selectedEvent)) is already in
      // place. Click delegation / selectedEvent wiring is a later step.
      renderer.renderInspector(null);

      unsubscribe = store.subscribe(() => {
        renderer.renderEventList(store.getAll().slice(-MAX_RENDERED_EVENTS));
      });

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