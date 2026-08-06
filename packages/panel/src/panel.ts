// packages/panel/src/panel.ts
import type { DevLensEvent, EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { createToolbar } from "./components/toolbar";
import { createSearchBox } from "./components/search-box";
import { createSessionControls } from "./components/session-controls";
import { MAX_RENDERED_EVENTS } from "./constants";
import { applyFilters, createEmptyFilterState, type FilterState } from "./filters";
import { applySearch } from "./search";
import { computeNavigationTarget, type NavigationDirection } from "./navigation";
import { serializeEvents } from "./serialize";

/**
 * Panel's public surface, extended by seven seams beyond Plugin:
 * setFilters()/setSearchQuery() (Filtering/Search) and
 * pause()/resume()/clear()/exportEvents()/isPaused() (the operational
 * layer). setFilters()/setSearchQuery() are the "engine becomes
 * load-bearing" steps described in docs/specs/inspection.md's
 * Filtering and Search models. The toolbar and search box (below) are
 * controls — they call setFilters()/setSearchQuery(), never the
 * filtering/search engines directly. Search *presentation* (match
 * highlighting, a distinct "no results" state, a match count) is
 * explicitly not part of this — see inspection.md's Search controls
 * model scope note and ADR-0008's Session 6 amendment.
 *
 * Keyboard navigation (arrow keys, Home/End) reuses selectEvent()
 * directly — there is deliberately no separate seam for it, since it
 * drives the exact same state transition a click does. See
 * inspection.md's Keyboard navigation model.
 *
 * pause()/resume()/clear()/exportEvents()/isPaused() are the
 * operational layer described in inspection.md's Pause/Resume/Clear/
 * Export model. Every one of them reuses updateEventList() as its
 * refresh path — there is deliberately no second "refresh"/"rerender"
 * function. isPaused() is a synchronous, read-only query; there is no
 * subscription/observer seam (see that section's "State visibility"
 * decision).
 */
export interface PanelController extends Plugin {
  setFilters(filters: FilterState): void;
  setSearchQuery(query: string): void;
  pause(): void;
  resume(): void;
  clear(): void;
  exportEvents(): string;
  isPaused(): boolean;
}

const NAVIGATION_KEYS: Record<string, NavigationDirection> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
};

export function createPanel(store: EventStore): PanelController {
  let installed = false;
  let unsubscribe: (() => void) | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;
  let renderer: ReturnType<typeof createRenderer> | null = null;
  let selectedEvent: DevLensEvent | null = null;
  let filters: FilterState = createEmptyFilterState();
  let searchQuery = "";
  // Operational state (inspection.md, Pause/Resume/Clear/Export model).
  // Gates only the automatic Store-subscription refresh path
  // (handleStoreUpdate, below) — every explicit action (setFilters,
  // setSearchQuery, selectEvent, clear, resume) ignores this and
  // always runs live. See that section's Operational invariant.
  let isPaused = false;
  // The currently rendered rows — kept in sync by updateEventList() on
  // every Store/filter/search change. Keyboard navigation traverses
  // this directly rather than recomputing filters/search on every
  // keypress; see inspection.md's Keyboard navigation model, decision 2
  // ("traverses the currently rendered portion of the Navigation
  // Context").
  let currentVisibleEvents: DevLensEvent[] = [];

  // Single owner of what "selection" means and how it's applied.
  // Everything that can change selection (clicks, keyboard navigation
  // below, Navigation Context invalidation below) goes through this,
  // rather than each caller remembering to update both the row
  // highlight and the inspector separately.
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
    currentVisibleEvents = visibleEvents;

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

  // The single automatic refresh path — the only place isPaused is
  // ever checked (inspection.md, Pause/Resume/Clear/Export model,
  // decision 2). Every explicit action below (pause/resume/clear, plus
  // the existing applyNewFilters/applyNewSearchQuery/selectEvent) is
  // unconditional and reuses updateEventList() directly; only this
  // Store-subscription callback is pause-aware.
  function handleStoreUpdate() {
    if (isPaused) return;
    updateEventList();
  }

  // Named the same way applyNewFilters/applyNewSearchQuery are: both
  // the public PanelController method and install()'s wiring into
  // createSessionControls() below call these directly, rather than
  // each defining its own copy of the same logic.

  // Pause: freezes only the automatic Store-subscription refresh path
  // (handleStoreUpdate, above). Capture (Runtime/Console/Store)
  // continues unaffected. Idempotent: pausing an already-paused Panel
  // is a no-op.
  function pause() {
    isPaused = true;
  }

  // Resume: exactly one explicit resync — no replay, no event-by-event
  // catch-up (inspection.md, decision 3). Reuses updateEventList(),
  // the same refresh path every other explicit action already uses.
  // Idempotent: resuming an already-running Panel just re-syncs once,
  // which is harmless.
  function resume() {
    isPaused = false;
    updateEventList();
  }

  // Clear: store.clear() doesn't notify() (a documented Store fact,
  // not a bug — see inspection.md, decision 4), so this explicitly
  // calls the same updateEventList() refresh path afterward. Runs
  // unconditionally, regardless of isPaused, since it's an explicit
  // action like setFilters()/setSearchQuery() — not the automatic path
  // that pause gates. Selection clearing falls out of the existing
  // Selection persistence rule inside updateEventList(); no
  // special-case handling needed here.
  function clear() {
    store.clear();
    updateEventList();
  }

  // Export: Store-scoped, not view-scoped — ignores current
  // filters/search/selection (inspection.md, decision 5). Returns
  // serialized data only; turning that into a downloaded file is a
  // browser-presentation concern that belongs to session-controls.ts,
  // not here.
  function exportEvents() {
    return serializeEvents(store.getAll());
  }

  // Synchronous, read-only query — not an observable/subscribable seam
  // (inspection.md, "State visibility" decision).
  function getIsPaused() {
    return isPaused;
  }

  return {
    install() {
      if (installed) return;
      if (typeof document === "undefined") return;

      overlay = createOverlay();

      // Toolbar, search box, and session controls are all mounted
      // before the renderer is created, which is what puts them first
      // in ShadowRoot DOM order — see ADR-0008's Session 5, Session 6,
      // and Session 7 amendments. createRenderer() has no idea any of
      // the three exist; it still only manages the two regions from
      // the Session 4 amendment.
      const toolbar = createToolbar(applyNewFilters);
      const searchBox = createSearchBox(applyNewSearchQuery);
      const sessionControls = createSessionControls({
        onPause: pause,
        onResume: resume,
        onClear: clear,
        onExport: exportEvents,
        isPaused: getIsPaused,
      });
      overlay.shadowRoot.append(
        toolbar.element,
        searchBox.element,
        sessionControls.element
      );

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

      // Keyboard navigation (inspection.md, Keyboard navigation model).
      // Scoped to focus within the event list region — the Panel must
      // never intercept arrow keys globally, so a keydown only becomes
      // navigation if shadowRoot.activeElement is currently inside
      // [data-devlens-event-list] (the renderer makes that container
      // focusable via tabindex for exactly this purpose). The moment
      // focus moves to the search box, the inspector, or outside the
      // Panel, these keys do whatever they'd otherwise do.
      overlay.shadowRoot.addEventListener("keydown", (domEvent) => {
        if (!(domEvent instanceof KeyboardEvent)) return;

        const direction = NAVIGATION_KEYS[domEvent.key];
        if (!direction) return;

        const activeElement = overlay?.shadowRoot.activeElement;
        if (!activeElement?.closest("[data-devlens-event-list]")) return;

        const target = computeNavigationTarget(
          currentVisibleEvents,
          selectedEvent?.id ?? null,
          direction
        );
        if (!target) return;

        domEvent.preventDefault();
        selectEvent(target);
      });

      unsubscribe = store.subscribe(handleStoreUpdate);

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
      currentVisibleEvents = [];
      isPaused = false;
      installed = false;
    },

    setFilters: applyNewFilters,
    setSearchQuery: applyNewSearchQuery,
    pause,
    resume,
    clear,
    exportEvents,
    isPaused: getIsPaused,
  };
}
