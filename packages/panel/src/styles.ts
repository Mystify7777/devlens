/**
 * CSS custom properties + stylesheet, injected into the Panel's Shadow
 * DOM. Kept as a plain string (not CSS-in-JS) — no build step required
 * for consumers, matches the "drop one script in" goal from ADR-0008.
 *
 * TODO(Session 3): actual dark-theme variable values and layout rules.
 */
export const PANEL_STYLES = `
  :host {
    /* theme variables to be defined in Session 3 */
  }
`;