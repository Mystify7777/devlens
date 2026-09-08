/**
 * The floating trigger toggles Panel visibility (see overlay.ts's
 * hide()/show()) — it is the one piece of Panel UI that must survive
 * the visible content regions being hidden, since it's the only way
 * to reopen them. See docs/specs/inspection.md's "Future extensions"
 * and ADR-0008's Non-goals (v1): "a floating trigger + expand/collapse
 * toggle for the whole Panel (show/hide the entire overlay, not any
 * one region within it)."
 *
 * Deliberately as narrow as toolbar.ts/search-box.ts: a real
 * `<button>` (native keyboard activation via Enter/Space, no custom
 * keydown handling needed), one outward callback (onToggle), and one
 * imperative update method (setExpanded) that panel.ts calls after
 * its own hidden/shown state changes — same "component reflects
 * state it doesn't own" pattern session-controls.ts's pause button
 * uses. This component has no idea what "hidden" means, what the
 * Store is, or what the visible content regions even contain; it only
 * reports "toggle was activated" and displays whatever expanded state
 * it's told.
 *
 * `aria-expanded` + a static accessible name is the standard
 * disclosure-button pattern (the same shape a "toggle sidebar" button
 * uses) — deliberately not swapping the visible label text between
 * "Open"/"Close" states, since aria-expanded already communicates
 * that to assistive tech and a static label is one fewer thing to
 * keep in sync.
 *
 * No keyboard *shortcut* is added here — that remains an explicit,
 * separate v1 non-goal (ADR-0008). This button's own keyboard
 * operability (Tab to focus, Enter/Space to activate) comes for free
 * from using a real <button> element, and is a different thing from a
 * global hotkey.
 */
export interface Trigger {
  readonly element: HTMLElement;
  setExpanded(expanded: boolean): void;
}

export function createTrigger(onToggle: () => void): Trigger {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("data-devlens-trigger", "");
  element.setAttribute("aria-expanded", "true");
  element.textContent = "DevLens";

  element.addEventListener("click", onToggle);

  return {
    element,
    setExpanded(expanded) {
      element.setAttribute("aria-expanded", String(expanded));
    },
  };
}
