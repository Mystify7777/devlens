import type { DevLensEvent } from "@devlens/core";
import { createEventRow } from "./components/event-row";

export interface Renderer {
  render(events: DevLensEvent[]): void;
}

export function createRenderer(container: ShadowRoot): Renderer {
  return {
    render(events) {
      container.replaceChildren();

      for (const event of events) {
        container.appendChild(createEventRow(event));
      }
    },
  };
}