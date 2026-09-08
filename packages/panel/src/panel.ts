// packages/panel/src/panel.ts
import type { DevLensEvent, EventStore, Plugin } from "@devlens/core";
import { createOverlay } from "./overlay";
import { createRenderer } from "./renderer";
import { createToolbar } from "./components/toolbar";
import { createSearchBox } from "./components/search-box";
import { createSessionControls } from "./components/session-controls";
import { createTrigger } from "./components/trigger";
import { MAX_RENDERED_EVENTS } from "./constants";
import { applyFilters, createEmptyFilterState, type FilterState } from "./filters";
import { applySearch } from "./search";
import { computeNavigationTarget, type NavigationDirection } from "./navigation";
import { serializeEvents } from "./serialize";
import { importSession, type ImportResult } from "./import";

/**
 * Panel's public surface, extended by ten seams beyond Plugin:
 * setFilters()/setSearchQuery() (Filtering/Search),
 * pause()/resume()/clear()/exportEvents()/isPaused() (the operational
 * layer), and hide()/show()/isHidden() (the floating trigger's
 * visibility toggle, Issue #16). setFilters()/setSearchQuery() are the
 * "engine becomes load-bearing" steps described in
 * docs/specs/inspection.md's Filtering and Search models. The toolbar
 * and search box (below) are controls — they call
 * setFilters()/setSearchQuery(), never the filtering/search engines
 * directly. Search *presentation* (match highlighting, a distinct "no
 * results" state, a match count) is explicitly not part of this — see
 * inspection.md's Search controls model scope note and ADR-0008's
 * Session 6 amendment.
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
 *
 * hide()/show()/isHidden() follow the identical shape: single-funnel
 * public methods the floating trigger's click handler reuses rather
 * than duplicating, both idempotent, isHidden() a synchronous
 * read-only query with no subscription seam — same "State visibility"
 * precedent isPaused() already established. Hiding never touches
 * Store contents, selection, filters, search, or subscriptions; it is
 * strictly a DOM-visibility toggle on the host element overlay.ts
 * owns (a `data-hidden` attribute paired with a
 * `:host([data-hidden]) [data-devlens-panel-region]` CSS rule — see
 * overlay.ts and styles.ts). See docs/specs/inspection.md's Future
 * extensions and ADR-0008's Non-goals (v1).
 */
export interface PanelController extends Plugin {
  setFilters(filters: FilterState): void;
  setSearchQuery(query: string): void;
  pause(): void;
  resume(): void;
  clear(): void;
  exportEvents(): string;
  isPaused(): boolean;
  hide(): void;
  show(): void;
  isHidden(): boolean;
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
  let trigger: ReturnType<typeof createTrigger> | null = null;
  // Panel-local UI state (Issue #16), same family as isPaused above —
  // not observable/subscribable, not Store state, just "is the Panel
  // currently visible." Defaults to false (visible) for a fresh
  // instance. Does NOT survive uninstall(): uninstall() is a genuine
  // teardown and explicitly resets this to false, so the next
  // install() is visible by default (see the reinstall test). What it
  // does survive is a hide() called before the *first* install() —
  // install()'s sync step below picks up whatever isHidden already is
  // at that point, since a freshly created overlay is always visible
  // regardless.
  let isHidden = false;
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
    if (selectedEvent && !navigationContext.some((event) => event.id === selectedEvent!.id)) {
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
      totalStoreCount: store.size,
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

  // Import: restores a previously exported session. Internal only —
  // not part of PanelController — wired directly into
  // createSessionControls() below. Deliberately NOT unconditional
  // about calling updateEventList() afterward, unlike clear():
  //
  // - store.addMany() (called inside importSession(), on success)
  //   DOES notify(), unlike store.clear(). When the Panel isn't
  //   paused, that notification already reaches handleStoreUpdate()
  //   and refreshes the render — calling updateEventList() again here
  //   would just be a redundant second render of the same state.
  // - When the Panel IS paused, handleStoreUpdate() ignores that same
  //   notification (that's the whole point of pause), so nothing
  //   would refresh the Panel at all unless this function refreshes
  //   it explicitly. Import is an explicit user action, like Clear/
  //   Resume/setFilters — it should always be reflected immediately,
  //   regardless of pause state.
  //
  // Net effect: call updateEventList() only when paused; when
  // running, defer to the notification Store already sent.
  function importFromSession(input: string): ImportResult {
    const result = importSession(input, store);
    if (result.ok && isPaused) {
      updateEventList();
    }
    return result;
  }

  // Hide/show (Issue #16) — same pattern as pause()/resume()/isPaused()
  // above: a single-funnel public method pair plus a synchronous
  // read-only query, both idempotent, both reused as-is by the
  // trigger's click handler rather than the trigger having its own
  // copy of this transition logic. Distinct from uninstall(): the
  // host stays mounted, nothing is torn down, Store/selection/
  // filters/search/subscriptions are untouched — see overlay.ts's
  // hide()/show() docs for the data-hidden attribute + CSS mechanism.
  function hide() {
    if (isHidden) return;
    isHidden = true;
    overlay?.hide();
    trigger?.setExpanded(false);
  }

  function show() {
    if (!isHidden) return;
    isHidden = false;
    overlay?.show();
    trigger?.setExpanded(true);
  }

  function getIsHidden() {
    return isHidden;
  }

  // The trigger's entire outward communication channel — it has no
  // idea what "hidden" means beyond "call this when clicked." It
  // reuses the exact same hide()/show() the public API exposes,
  // rather than a separate private transition.
  function handleTriggerClick() {
    if (isHidden) {
      show();
    } else {
      hide();
    }
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
        onImport: importFromSession,
      });

      // Each carries data-devlens-panel-region (Issue #16) so
      // hide()/show() can target "every content region" generically
      // via styles.ts's :host([data-hidden]) rule, without any of
      // these three components knowing hide/show exists — same
      // isolation this codebase already applies in the other
      // direction (the trigger knows nothing about filtering/search/
      // the Store). The renderer's own two regions mark themselves
      // the same way, internally (see renderer.ts).
      for (const element of [toolbar.element, searchBox.element, sessionControls.element]) {
        element.setAttribute("data-devlens-panel-region", "");
      }

      overlay.shadowRoot.append(toolbar.element, searchBox.element, sessionControls.element);

      renderer = createRenderer(overlay.shadowRoot);

      // The trigger is deliberately NOT given data-devlens-panel-region
      // — it must stay visible when everything else is hidden, since
      // it's the only way to reopen the Panel.
      trigger = createTrigger(handleTriggerClick);
      trigger.setExpanded(!isHidden);
      overlay.shadowRoot.appendChild(trigger.element);

      // Sync the freshly-created overlay to any isHidden state that
      // already existed before this install() call. This matters for
      // hide() called before the *first* install() (isHidden is true,
      // but no overlay existed yet to apply it to) — not for a
      // hide()-then-uninstall()-then-install() cycle, since uninstall()
      // resets isHidden to false on any genuine teardown (see its
      // declaration above). A brand-new createOverlay() is always
      // visible by default, so without this sync, the trigger and
      // internal state could say "hidden" while the actual DOM stayed
      // visible.
      if (isHidden) {
        overlay.hide();
      }

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

        const clickedEvent = store.getAll().find((e) => e.id === eventId) ?? null;
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
      trigger = null;
      selectedEvent = null;
      filters = createEmptyFilterState();
      searchQuery = "";
      currentVisibleEvents = [];
      isPaused = false;
      isHidden = false;
      installed = false;
    },

    setFilters: applyNewFilters,
    setSearchQuery: applyNewSearchQuery,
    pause,
    resume,
    clear,
    exportEvents,
    isPaused: getIsPaused,
    hide,
    show,
    isHidden: getIsHidden,
  };
}
