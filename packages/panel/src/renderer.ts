import type { DevLensEvent } from "@devlens/core";
import { createEventRow } from "./components/event-row";
import { createInspector } from "./components/inspector";

/**
 * The renderer owns two named regions within the ShadowRoot it's given
 * — the event list and the inspector — and exposes them as independent
 * capabilities rather than a single monolithic render() call.
 *
 * This split matters architecturally, not just stylistically: per
 * inspection.md's Panel state model decision, selection changes must
 * not trigger event-list reconstruction. A single render(events) entry
 * point would tempt panel.ts into calling the same "rebuild everything"
 * path for both Store updates and selection changes. Splitting the API
 * makes the correct behavior the easy behavior.
 *
 * setSelectedRow() extends this same boundary to row highlighting:
 * Panel owns interaction state (what is selected); Renderer owns
 * visual state (how that selection is represented). panel.ts never
 * queries or manipulates renderer-owned DOM directly — it calls
 * setSelectedRow(eventId) and renderInspector(event) as two
 * independent presentation updates driven by one state transition.
 *
 * The renderer still knows nothing about clicks or Panel lifecycle —
 * see docs/adr/0008-panel.md's Session 4 amendment.
 */
export interface EventListRenderInfo {
  /** The windowed (MAX_RENDERED_EVENTS-sliced) events to render as rows. */
  visibleEvents: DevLensEvent[];
  /** Current search query, for highlighting matches within each row. */
  searchQuery: string;
  /**
   * Full (unwindowed) Navigation Context length — how many events
   * currently pass filtering + search, before windowing.
   */
  navigationContextCount: number;
  /**
   * Store's full, unfiltered event count. Compared against
   * navigationContextCount to decide the empty-state message (Store
   * empty vs. Navigation Context empty) and whether to show a match
   * count. Renderer only ever sees these two numbers — never
   * FilterState, a search query's origin, or the Store itself; Panel
   * computes both counts and hands them down, same as everything else
   * this function is given.
   */
  totalStoreCount: number;
}

export interface Renderer {
  renderEventList(info: EventListRenderInfo): void;
  renderInspector(event: DevLensEvent | null, searchQuery: string): void;
  setSelectedRow(eventId: string | null): void;
}

export function createRenderer(shadowRoot: ShadowRoot): Renderer {
  const eventListContainer = document.createElement("div");
  eventListContainer.setAttribute("data-devlens-event-list", "");

  const inspector = createInspector();

  shadowRoot.append(eventListContainer, inspector.element);

  let selectedRowElement: HTMLElement | null = null;

  /**
   * Three distinct states, per docs/specs/inspection.md's Search
   * presentation model — "Store empty" and "Navigation Context empty"
   * are different developer problems and get different messages,
   * rather than one generic "no events" state that would misleadingly
   * conflate them.
   */
  function renderEmptyListState(kind: "store" | "filtered") {
    const empty = document.createElement("div");
    empty.setAttribute("data-devlens-event-list-empty", kind);
    empty.textContent =
      kind === "store"
        ? "No events captured yet."
        : "No events match the current filter or search.";
    eventListContainer.appendChild(empty);
  }

  return {
    renderEventList({
      visibleEvents,
      searchQuery,
      navigationContextCount,
      totalStoreCount,
    }) {
      eventListContainer.replaceChildren();

      if (totalStoreCount === 0) {
        renderEmptyListState("store");
        selectedRowElement = null;
        return;
      }

      if (navigationContextCount === 0) {
        renderEmptyListState("filtered");
        selectedRowElement = null;
        return;
      }

      // Match count is shown only when the Navigation Context actually
      // diverges from the Store's full contents — not whenever a
      // filter/search value is merely set (an empty filter or a blank
      // query changes nothing, and showing a count would falsely imply
      // narrowing is happening). See inspection.md, Search
      // presentation model, decision 3.
      if (navigationContextCount !== totalStoreCount) {
        const count = document.createElement("div");
        count.setAttribute("data-devlens-event-list-count", "");
        count.textContent = `${navigationContextCount} of ${totalStoreCount}`;
        eventListContainer.appendChild(count);
      }

      for (const event of visibleEvents) {
        eventListContainer.appendChild(createEventRow(event, searchQuery));
      }

      // A fresh render() produces new row elements, so any previously
      // cached row reference is now stale even if the same eventId is
      // still present in the new list. Re-resolve rather than assume.
      selectedRowElement = null;
    },

    renderInspector(event, searchQuery) {
      inspector.render(event, searchQuery);
    },

    setSelectedRow(eventId) {
      if (selectedRowElement) {
        selectedRowElement.removeAttribute("data-selected");
        selectedRowElement = null;
      }

      if (eventId === null) return;

      // Deliberately not a templated attribute selector
      // (`[data-devlens-event-id="${eventId}"]`) — that would require
      // escaping eventId for CSS selector syntax (CSS.escape isn't
      // available in every environment, e.g. jsdom), and event IDs
      // shouldn't need to be valid CSS identifiers in the first place.
      // A direct attribute comparison sidesteps both problems.
      const rows = eventListContainer.querySelectorAll<HTMLElement>(
        "[data-devlens-event-id]"
      );
      const row = Array.from(rows).find(
        (candidate) => candidate.getAttribute("data-devlens-event-id") === eventId
      );
      if (!row) return;

      row.setAttribute("data-selected", "");
      selectedRowElement = row;
    },
  };
}