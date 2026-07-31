import type { DevLensEvent } from "@devlens/core";
import { createEventRow } from "./components/event-row";
import { createInspector } from "./components/inspector";

/**
 * The renderer owns two named regions within the ShadowRoot it's given
 * — the event list and the inspector — and exposes them as independent
 * capabilities rather than a single monolithic render() call.
 *
 * This split matters architecturally, not just stylistically: per
 * ADR-0009's Panel state model decision, selection changes must not
 * trigger event-list reconstruction. A single render(events) entry
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
export interface Renderer {
  renderEventList(events: DevLensEvent[]): void;
  renderInspector(event: DevLensEvent | null): void;
  setSelectedRow(eventId: string | null): void;
}

export function createRenderer(shadowRoot: ShadowRoot): Renderer {
  const eventListContainer = document.createElement("div");
  eventListContainer.setAttribute("data-devlens-event-list", "");

  const inspector = createInspector();

  shadowRoot.append(eventListContainer, inspector.element);

  let selectedRowElement: HTMLElement | null = null;

  return {
    renderEventList(events) {
      eventListContainer.replaceChildren();

      for (const event of events) {
        eventListContainer.appendChild(createEventRow(event));
      }

      // A fresh render() produces new row elements, so any previously
      // cached row reference is now stale even if the same eventId is
      // still present in the new list. Re-resolve rather than assume.
      selectedRowElement = null;
    },

    renderInspector(event) {
      inspector.render(event);
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