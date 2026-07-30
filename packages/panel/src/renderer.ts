import type { DevLensEvent } from "@devlens/core";

/**
 * Owns the event list container inside the Shadow DOM and performs
 * incremental DOM updates as it's given new event arrays — append/remove
 * nodes, not a diffing/reconciliation algorithm. Has no opinion about
 * how many events it's handed; trimming to a display limit is the
 * caller's (panel.ts's) responsibility, not the renderer's.
 *
 * TODO(Session 3): actual append + remove logic, accessibility wiring.
 */
export interface Renderer {
  render(events: DevLensEvent[]): void;
}

export function createRenderer(_container: ShadowRoot): Renderer {
  return {
    render(_events) {
      // TODO(Session 3)
    },
  };
}