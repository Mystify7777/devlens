// packages/panel/src/panel.ts
import type { DevLensEvent, EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { createToolbar } from "./components/toolbar";
import { MAX_RENDERED_EVENTS } from "./constants";
import { applyFilters, createEmptyFilterState, type FilterState } from "./filters";

/**
 * Panel's public surface, extended by exactly one seam beyond Plugin:
 * setFilters(). This is the "filter engine becomes load-bearing" step
 * described in docs/specs/inspection.md's Filtering model. The
 * toolbar (below) is a filter *control* — it calls this exact same
 * seam, never the filtering engine directly. See inspection.md's
 * "Scope note: filter engine vs. filter controls" and ADR-0008's
 * Session 5 amendment.
 */
export interface PanelController extends Plugin {
  setFilters(filters: FilterState): void;
}

export function createPanel(store: EventStore): PanelController {
  let installed = false;
  let unsubscribe: (() => void) | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;
  let renderer: ReturnType<typeof createRenderer> | null = null;
  let selectedEvent: DevLensEvent | null = null;
  let filters: FilterState = createEmptyFilterState();

  // Single owner of what "selection" means and how it's applied.
  // Everything that can change selection (clicks today; keyboard
  // navigation later; Navigation Context invalidation below) goes
  // through this, rather than each caller remembering to update both
  // the row highlight and the inspector separately.
  function selectEvent(event: DevLensEvent | null) {
    selectedEvent = event;
    renderer?.setSelectedRow(event?.id ?? null);
    renderer?.renderInspector(event);
  }

  // The Navigation Context (docs/specs/inspection.md): the result of
  // applying every active view-level transformation to the Store's
  // contents. Only filtering exists today; Search will extend this as
  // applySearch(applyFilters(...)) without any caller of this function
  // needing to change. Reads Store/filters, returns a fresh array — no
  // side effects of its own.
  function computeNavigationContext(): DevLensEvent[] {
    return applyFilters(store.getAll(), filters);
  }

  // The one place the rendered list gets (re)computed. Store updates
  // and filter changes both funnel through here, so both behave
  // identically with respect to windowing and selection — there is no
  // second, parallel "filtered render" path living somewhere else.
  function updateEventList() {
    if (!renderer) return;

    const navigationContext = computeNavigationContext();

    // Selection persistence rule (inspection.md, Selection model):
    // retained if the selected event still exists in the Navigation
    // Context (even if it has scrolled beyond MAX_RENDERED_EVENTS —
    // that's handled below, by setSelectedRow() simply finding no
    // matching row); cleared if the Navigation Context no longer
    // contains it at all, e.g. because an active filter now excludes
    // it.
    if (
      selectedEvent &&
      !navigationContext.some((event) => event.id === selectedEvent!.id)
    ) {
      selectEvent(null);
    }

    const visibleEvents = navigationContext.slice(-MAX_RENDERED_EVENTS);
    renderer.renderEventList(visibleEvents);

    // renderEventList() rebuilds row elements from scratch, so any
    // previously-applied row highlight is gone even if the selected
    // event is still within the rendered window. This does NOT
    // re-render the inspector — list membership changing doesn't mean
    // the selected event itself changed; only selectEvent() drives
    // inspector updates (Panel state model, inspection.md).
    renderer.setSelectedRow(selectedEvent?.id ?? null);
  }

  // The single funnel every filter change goes through, regardless of
  // where it came from — the public setFilters() method and the
  // toolbar's onFiltersChange callback both call exactly this and
  // nothing else. There is deliberately no second code path that sets
  // `filters` directly.
  function applyNewFilters(newFilters: FilterState) {
    filters = newFilters;
    updateEventList();
  }

  return {
    install() {
      if (installed) return;
      if (typeof document === "undefined") return;

      overlay = createOverlay();

      // Toolbar is mounted before the renderer is created, which is
      // what puts it first in ShadowRoot DOM order — see ADR-0008's
      // Session 5 amendment. createRenderer() has no idea this region
      // exists; it still only manages the two regions from the
      // Session 4 amendment.
      const toolbar = createToolbar(applyNewFilters);
      overlay.shadowRoot.appendChild(toolbar.element);

      renderer = createRenderer(overlay.shadowRoot);

      updateEventList();
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
        updateEventList();
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
      renderer = null;
      selectedEvent = null;
      filters = createEmptyFilterState();
      installed = false;
    },

    setFilters: applyNewFilters,
  };
}
