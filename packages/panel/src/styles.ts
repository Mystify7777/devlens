/**
 * CSS custom properties + stylesheet, injected into the Panel's Shadow
 * DOM by overlay.ts. Kept as a plain string (not CSS-in-JS) — no build
 * step required for consumers, matches the "drop one script in" goal
 * from ADR-0008.
 *
 * Real dark-theme variable values and layout rules are still an open
 * design decision (see ADR-0008's Theming section and
 * docs/specs/inspection.md's Future extensions) — this file's job
 * right now is only making sure *some* stylesheet is mechanically
 * wired into the Shadow DOM, so adding real rules later is a content
 * change here, not a wiring change elsewhere.
 *
 * The two rules below (Issue #16) are a deliberate exception to
 * "no real rules yet" — they're purely functional (positioning and
 * visibility), not visual/theme decisions. No colors, fonts, borders,
 * or spacing values are set; browser defaults render everything else.
 * Widening this into real visual design remains exactly as open as
 * before.
 */
export const PANEL_STYLES = `
  :host {
    /* theme variables to be defined when dark theme is designed */
  }

  [data-devlens-trigger] {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2147483647;
  }

  :host([data-hidden]) [data-devlens-panel-region] {
    display: none;
  }
`;
