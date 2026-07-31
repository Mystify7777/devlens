// packages/panel/src/panel.ts
import type { DevLensEvent, EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { MAX_RENDERED_EVENTS } from "./constants";

export function createPanel(store: EventStore): Plugin {
  let installed = false;
  let unsubscribe: (() => void) | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;
  let selectedEvent: DevLensEvent | null = null;

  return {
    install() {
      if (installed) return;
      if (typeof document === "undefined") return;

      overlay = createOverlay();
      const renderer = createRenderer(overlay.shadowRoot);

      // Single owner of what "selection" means and how it's applied.
      // Everything that can change selection (clicks today; keyboard
      // navigation, filter invalidation, etc. later) should go through
      // this, rather than each caller remembering to update both the
      // row highlight and the inspector separately.
      function selectEvent(event: DevLensEvent | null) {
        selectedEvent = event;
        renderer.setSelectedRow(event?.id ?? null);
        renderer.renderInspector(event);
      }

      renderer.renderEventList(store.getAll().slice(-MAX_RENDERED_EVENTS));
      selectEvent(null);

      // Delegated click handling: one listener on the whole Panel
      // root, not a per-row callback. createEventRow() stays ignorant
      // of selection; it only has to expose data-devlens-event-id so
      // the click target can be resolved back to a real event.
      overlay.shadowRoot.addEventListener("click", (domEvent) => {
        const target = domEvent.target;
        if (!(target instanceof Element)) return;

        const row = target.closest<HTMLElement>("[data-devlens-event-row]");
        if (!row) return;

        const eventId = row.getAttribute("data-devlens-event-id");
        if (!eventId) return;

        const clickedEvent =
          store.getAll().find((e) => e.id === eventId) ?? null;
        selectEvent(clickedEvent);
      });

      unsubscribe = store.subscribe(() => {
        renderer.renderEventList(store.getAll().slice(-MAX_RENDERED_EVENTS));

        // renderEventList() rebuilds row elements from scratch, so any
        // previously-applied row highlight is gone even if the
        // selected event is still within the rendered window. This
        // does NOT re-render the inspector — the Store changing
        // doesn't mean the selected event itself changed, and
        // ADR-0009's Panel state model explicitly says selection
        // changes (not Store changes) drive inspector updates. If the
        // selected event has scrolled beyond MAX_RENDERED_EVENTS,
        // setSelectedRow() simply finds no matching row and no-ops —
        // selection is retained, only its visual row representation
        // is (correctly) absent, per the spec's persistence rule.
        renderer.setSelectedRow(selectedEvent?.id ?? null);
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
      selectedEvent = null;
      installed = false;
    },
  };
}
