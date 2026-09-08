import { PANEL_STYLES } from "./styles";

export interface Overlay {
  readonly shadowRoot: ShadowRoot;
  mount(): void;
  unmount(): void;
  /**
   * Hides Panel content without touching mount state, Panel's
   * internal state, or the Store subscription — see panel.ts's
   * hide(). Implemented as a `data-hidden` attribute on the host
   * element itself (never exposed on this interface — see the
   * "does not expose the host element" test below; `hide()`/`show()`
   * reach it via closure, the same way `mount()`/`unmount()` already
   * do). `styles.ts` pairs this with a
   * `:host([data-hidden]) [data-devlens-panel-region]` rule, so
   * anything carrying that shared marker (the toolbar, search box,
   * session controls, and the renderer's two regions — see Issue #16)
   * disappears together, while anything without the marker (the
   * floating trigger) does not. No DOM restructuring: every existing
   * element stays exactly where it already was in the ShadowRoot: —
   * only a new attribute and a new stylesheet rule are added.
   * Idempotent — hiding an already-hidden overlay is a no-op.
   */
  hide(): void;
  /**
   * Reveals Panel content. Idempotent. Since hide()/show() never
   * touch Panel's actual state (selection, filters, search,
   * subscriptions), nothing needs to be recomputed here — whatever
   * was last rendered is simply visible again.
   */
  show(): void;
}
/**
 * Creates the Panel's host element, attaches an open Shadow DOM to it
 * (ADR-0008 isolation strategy), injects the baseline stylesheet
 * (styles.ts), and owns its own mount/unmount lifecycle — panel.ts
 * calls overlay.mount()/unmount() rather than manipulating
 * document.body directly, keeping DOM lifecycle ownership with the
 * thing that created the node.
 *
 * Also owns hide()/show() (Issue #16), a lighter-weight sibling of
 * mount()/unmount() — same family of concern (DOM lifecycle), still
 * entirely about "is this visible," never about what it contains.
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
    hide() {
      host.setAttribute("data-hidden", "");
    },
    show() {
      host.removeAttribute("data-hidden");
    },
  };
}
