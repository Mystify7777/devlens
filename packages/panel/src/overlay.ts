export interface Overlay {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  mount(): void;
  unmount(): void;
}

/**
 * Creates the Panel's host element, attaches an open Shadow DOM to it
 * (ADR-0008 isolation strategy), and owns its own mount/unmount lifecycle
 * — panel.ts calls overlay.mount()/unmount() rather than manipulating
 * document.body directly, keeping DOM lifecycle ownership with the
 * thing that created the node.
 *
 * TODO(Session 3): actual floating trigger + expand/collapse behavior.
 */
export function createOverlay(): Overlay {
  const host = document.createElement("div");
  host.setAttribute("data-devlens-panel-host", "");
  const shadowRoot = host.attachShadow({ mode: "open" });

  return {
    host,
    shadowRoot,
    mount() {
      document.body.appendChild(host);
    },
    unmount() {
      host.remove();
    },
  };
}