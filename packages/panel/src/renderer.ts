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
 * The renderer still knows nothing about selection, clicks, or Panel
 * state — see docs/adr/0008-panel.md's Session 4 amendment.
 */
export interface Renderer {
  renderEventList(events: DevLensEvent[]): void;
  renderInspector(event: DevLensEvent | null): void;
}

export function createRenderer(shadowRoot: ShadowRoot): Renderer {
  const eventListContainer = document.createElement("div");
  eventListContainer.setAttribute("data-devlens-event-list", "");

  const inspector = createInspector();

  shadowRoot.append(eventListContainer, inspector.element);

  return {
    renderEventList(events) {
      eventListContainer.replaceChildren();

      for (const event of events) {
        eventListContainer.appendChild(createEventRow(event));
      }
    },

    renderInspector(event) {
      inspector.render(event);
    },
  };
}