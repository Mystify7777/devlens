import { PANEL_STYLES } from "./styles";

export interface Overlay {
  readonly shadowRoot: ShadowRoot;
  mount(): void;
  unmount(): void;
}
/**
 * Creates the Panel's host element, attaches an open Shadow DOM to it
 * (ADR-0008 isolation strategy), injects the baseline stylesheet
 * (styles.ts), and owns its own mount/unmount lifecycle — panel.ts
 * calls overlay.mount()/unmount() rather than manipulating
 * document.body directly, keeping DOM lifecycle ownership with the
 * thing that created the node.
 *
 * A floating trigger + expand/collapse toggle for the whole Panel is
 * deliberately not implemented — see ADR-0008's Non-goals (v1) and
 * docs/specs/inspection.md's Future extensions.
 */
export function createOverlay(): Overlay {
  const host = document.createElement("div");
  host.setAttribute("data-devlens-panel-host", "");
  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  shadowRoot.appendChild(style);

  return {
    shadowRoot,
    mount() {
      document.body.appendChild(host);
    },
    unmount() {
      host.remove();
    },
  };
}