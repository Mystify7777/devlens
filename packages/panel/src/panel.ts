// packages/panel/src/panel.ts
import type { DevLensEvent, EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { createToolbar } from "./components/toolbar";
import { createSearchBox } from "./components/search-box";
import { MAX_RENDERED_EVENTS } from "./constants";
import { applyFilters, createEmptyFilterState, type FilterState } from "./filters";
import { applySearch } from "./search";

/**
 * Panel's public surface, extended by two seams beyond Plugin:
 * setFilters() and setSearchQuery(). These are the "engine becomes
 * load-bearing" steps described in docs/specs/inspection.md's
 * Filtering and Search models. The toolbar and search box (below) are
 * controls — they call setFilters()/setSearchQuery(), never the
 * filtering/search engines directly. Search *presentation* (match
 * highlighting, a distinct "no results" state, a match count) is
 * explicitly not part of this — see inspection.md's Search controls
 * model scope note and ADR-0008's Session 6 amendment.
 */
export interface PanelController extends Plugin {
  setFilters(filters: FilterState): void;
  setSearchQuery(query: string): void;
}

export function createPanel(store: EventStore): PanelController {
  let installed = false;
  let unsubscribe: (() => void) | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;
  let renderer: ReturnType<typeof createRenderer> | null = null;
  let selectedEvent: DevLensEvent | null = null;
  let filters: FilterState = createEmptyFilterState();
  let searchQuery = "";

  // Single owner of what "selection" means and how it's applied.
  // Everything that can change selection (clicks today; keyboard
  // navigation later; Navigation Context invalidation below) goes
  // through this, rather than each caller remembering to update both
  // the row highlight and the inspector separately.
  function selectEvent(event: DevLensEvent | null) {
    selectedEvent = event;
    renderer?.setSelectedRow(event?.id ?? null);
    renderer?.renderInspector(event, searchQuery);
  }

  // The Navigation Context (docs/specs/inspection.md): the result of
  // applying every active view-level transformation to the Store's
  // contents, in order — filtering, then search. Each transformation
  // is independent and pure; adding search here required no change to
  // any of this function's callers (updateEventList, the click
  // handler, setFilters/setSearchQuery below) — exactly the payoff the
  // Filtering model's Navigation Context concept was written to buy.
  function computeNavigationContext(): DevLensEvent[] {
    return applySearch(applyFilters(store.getAll(), filters), searchQuery);
  }

  // The one place the rendered list gets (re)computed. Store updates,
  // filter changes, and search changes all funnel through here, so all
  // three behave identically with respect to windowing and selection —
  // there is no second, parallel "filtered" or "searched" render path
  // living somewhere else.
  function updateEventList() {
    if (!renderer) return;

    const navigationContext = computeNavigationContext();

    // Selection persistence rule (inspection.md, Selection model):
    // retained if the selected event still exists in the Navigation
    // Context (even if it has scrolled beyond MAX_RENDERED_EVENTS —
    // that's handled below, by setSelectedRow() simply finding no
    // matching row); cleared if the Navigation Context no longer
    // contains it at all, e.g. because an active filter or search
    // query now excludes it.
    if (
      selectedEvent &&
      !navigationContext.some((event) => event.id === selectedEvent!.id)
    ) {
      selectEvent(null);
    }

    const visibleEvents = navigationContext.slice(-MAX_RENDERED_EVENTS);

    // totalStoreCount/navigationContextCount are what let the renderer
    // decide, without ever seeing FilterState, a search query's
    // origin, or the Store itself, which of the three Search
    // presentation states applies (Store empty / Navigation Context
    // empty / normal) and whether a match count belongs on screen —
    // see docs/specs/inspection.md's Search presentation model.
    renderer.renderEventList({
      visibleEvents,
      searchQuery,
      navigationContextCount: navigationContext.length,
      totalStoreCount: store.getAll().length,
    });

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

  // Mirrors applyNewFilters() for search: the one place `searchQuery`
  // is ever assigned. Called by the public setSearchQuery() method and
  // by the search box's onQueryChange callback — same single-funnel
  // pattern as filters, and nothing else assigns `searchQuery` directly.
  function applyNewSearchQuery(newQuery: string) {
    searchQuery = newQuery;
    updateEventList();
  }

  return {
    install() {
      if (installed) return;
      if (typeof document === "undefined") return;

      overlay = createOverlay();

      // Toolbar and search box are both mounted before the renderer is
      // created, which is what puts them first in ShadowRoot DOM
      // order — see ADR-0008's Session 5 and Session 6 amendments.
      // createRenderer() has no idea either region exists; it still
      // only manages the two regions from the Session 4 amendment.
      const toolbar = createToolbar(applyNewFilters);
      const searchBox = createSearchBox(applyNewSearchQuery);
      overlay.shadowRoot.append(toolbar.element, searchBox.element);

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
      searchQuery = "";
      installed = false;
    },

    setFilters: applyNewFilters,
    setSearchQuery: applyNewSearchQuery,
  };
}
