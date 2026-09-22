import { DARK_TOKENS, LIGHT_TOKENS, SEVERITIES, toCustomProperties } from "./theme/tokens";

/**
 * Panel stylesheet, injected into the Shadow DOM by overlay.ts
 * (ADR-0008, Issue #20 amendment). A plain string — no build step for
 * consumers.
 *
 * Structure:
 * - Host reset + non-color tokens (`:host`).
 * - Theme: dark defaults, light via `prefers-color-scheme`, explicit
 *   `data-theme="light|dark"` on the host overriding the system
 *   preference. Rule order matters: explicit overrides come last.
 * - Layout is CSS-only: the ShadowRoot is intentionally flat (ADR-0008
 *   #16 amendment), so `:host` is the grid container and regions are
 *   placed via their existing `data-devlens-*` markers.
 * - Hidden state: only the regions hide; the host keeps a 0x0 box so
 *   the fixed trigger stays visible. Never put transform/filter/contain
 *   on the host — that would make the fixed trigger host-relative.
 *
 * Host isolation: `all: initial` resets inherited properties from the
 * page (font, color, line-height, direction, cursor...). Outer author
 * rules that target the host element still beat normal `:host`
 * declarations, so only the geometry-critical declarations
 * (display/position/z-index) use `!important`.
 */

const SEVERITY_RULES = SEVERITIES.map((s) => {
  const tint = s === "warn" || s === "error" || s === "fatal";
  const bg = s === "warn" ? "sev-warn-bg" : s === "error" ? "sev-error-bg" : "sev-fatal-bg";
  const fg = s === "fatal" ? "sev-error" : `sev-${s}`;
  return `
  [data-devlens-event-row][data-devlens-severity="${s}"] {
    border-inline-start-color: var(--devlens-${fg});
    ${tint ? `background: var(--devlens-${bg});` : ""}
  }
  [data-devlens-event-row][data-devlens-severity="${s}"] [data-devlens-event-severity] {
    color: var(--devlens-${fg});
  }`;
}).join("\n");

export const PANEL_STYLES = `
  :host {
    all: initial;
    display: grid !important;
    position: fixed !important;
    z-index: 2147483646 !important;
    box-sizing: border-box;
    direction: ltr;

    --devlens-space-1: 4px;
    --devlens-space-2: 8px;
    --devlens-space-3: 12px;
    --devlens-space-4: 16px;
    --devlens-font-size-xs: 11px;
    --devlens-font-size-sm: 12px;
    --devlens-font-size-md: 13px;
    --devlens-font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --devlens-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    --devlens-radius: 4px;
    --devlens-radius-sm: 2px;
    --devlens-gutter: 16px;
    --devlens-target: 24px;
    --devlens-trigger-height: 32px;
    --devlens-panel-width: 56rem;
    --devlens-panel-height: 40rem;
    --devlens-panel-bottom: calc(var(--devlens-gutter) + var(--devlens-trigger-height) + var(--devlens-space-2));

    font: 400 var(--devlens-font-size-sm) / 1.4 var(--devlens-font-ui);
    color: var(--devlens-text);
  }

  /* Theme: dark default -> light via system preference -> explicit override. */
  :host {
    color-scheme: dark;
    ${toCustomProperties(DARK_TOKENS)}
  }
  @media (prefers-color-scheme: light) {
    :host {
      color-scheme: light;
      ${toCustomProperties(LIGHT_TOKENS)}
    }
  }
  :host([data-theme="light"]) {
    color-scheme: light;
    ${toCustomProperties(LIGHT_TOKENS)}
  }
  :host([data-theme="dark"]) {
    color-scheme: dark;
    ${toCustomProperties(DARK_TOKENS)}
  }

  @media (pointer: coarse) {
    :host {
      --devlens-target: 44px;
      --devlens-trigger-height: 44px;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  /* ---- Geometry (only while visible) ---- */
  :host(:not([data-hidden])) {
    right: var(--devlens-gutter);
    bottom: var(--devlens-panel-bottom);
    width: min(var(--devlens-panel-width), calc(100vw - 2 * var(--devlens-gutter)));
    height: min(60vh, var(--devlens-panel-height));
    height: min(60dvh, var(--devlens-panel-height));
    max-height: calc(100vh - var(--devlens-panel-bottom) - var(--devlens-gutter));
    max-height: calc(100dvh - var(--devlens-panel-bottom) - var(--devlens-gutter));
    grid-template-columns: minmax(240px, 2fr) minmax(0, 3fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: hidden;
    background: var(--devlens-surface);
    border: 1px solid var(--devlens-border);
    border-radius: var(--devlens-radius);
    box-shadow: var(--devlens-shadow);
  }

  :host([data-hidden]) [data-devlens-panel-region] {
    display: none;
  }

  [data-devlens-toolbar] { grid-column: 1 / -1; grid-row: 1; }
  [data-devlens-search] { grid-column: 1; grid-row: 2; }
  [data-devlens-session-controls] { grid-column: 2; grid-row: 2; }
  [data-devlens-event-list] { grid-column: 1; grid-row: 3; }
  [data-devlens-inspector] { grid-column: 2; grid-row: 3; }

  @media (max-width: 599px) {
    :host(:not([data-hidden])) {
      left: var(--devlens-gutter);
      width: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto auto minmax(0, 1fr) minmax(0, 1fr);
    }
    [data-devlens-toolbar] { grid-row: 1; }
    [data-devlens-search] { grid-column: 1; grid-row: 2; }
    [data-devlens-session-controls] { grid-column: 1; grid-row: 3; }
    [data-devlens-event-list] { grid-column: 1; grid-row: 4; }
    [data-devlens-inspector] { grid-column: 1; grid-row: 5; }
  }

  @media (max-width: 359px), (max-height: 479px) {
    :host(:not([data-hidden])) {
      height: calc(100vh - var(--devlens-panel-bottom) - var(--devlens-gutter));
      height: calc(100dvh - var(--devlens-panel-bottom) - var(--devlens-gutter));
    }
  }

  /* ---- Control strip ---- */
  [data-devlens-toolbar],
  [data-devlens-search],
  [data-devlens-session-controls] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--devlens-space-1) var(--devlens-space-3);
    padding: var(--devlens-space-1) var(--devlens-space-2);
    background: var(--devlens-surface-subtle);
    border-block-end: 1px solid var(--devlens-border);
    min-width: 0;
  }
  [data-devlens-toolbar] fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--devlens-space-2);
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  [data-devlens-toolbar] legend {
    padding: 0;
    color: var(--devlens-text-muted);
    font-size: var(--devlens-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  [data-devlens-toolbar] label,
  [data-devlens-search] label {
    display: inline-flex;
    align-items: center;
    gap: var(--devlens-space-1);
    min-height: var(--devlens-target);
    color: var(--devlens-text);
  }
  [data-devlens-search] label { flex: 1 1 8rem; }
  input[type="checkbox"] {
    accent-color: var(--devlens-accent);
    margin: 0;
    width: 14px;
    height: 14px;
  }
  input[type="text"], input[type="search"], input:not([type]) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--devlens-target);
    padding: 0 var(--devlens-space-2);
    font: inherit;
    color: var(--devlens-text);
    background: var(--devlens-surface);
    border: 1px solid var(--devlens-border-control);
    border-radius: var(--devlens-radius-sm);
  }
  button {
    min-height: var(--devlens-target);
    min-width: var(--devlens-target);
    padding: 0 var(--devlens-space-2);
    font: inherit;
    color: var(--devlens-text);
    background: var(--devlens-surface-raised);
    border: 1px solid var(--devlens-border-control);
    border-radius: var(--devlens-radius-sm);
    cursor: pointer;
    transition: background-color 120ms, border-color 120ms;
  }
  [data-devlens-session-controls] { gap: var(--devlens-space-1) var(--devlens-space-2); }
  [data-devlens-session-import-status] {
    flex: 1 1 100%;
    color: var(--devlens-text-muted);
    font-size: var(--devlens-font-size-xs);
  }
  [data-devlens-session-import-status]:empty { display: none; }

  :focus-visible {
    outline: 2px solid var(--devlens-focus);
    outline-offset: 2px;
  }
  [data-devlens-event-list]:focus-visible,
  [data-devlens-inspector]:focus-visible {
    outline-offset: -2px;
  }

  /* ---- Event list ---- */
  [data-devlens-event-list],
  [data-devlens-inspector] {
    min-height: 0;
    min-width: 0;
    overflow: auto;
    background: var(--devlens-surface);
  }
  [data-devlens-event-list] {
    border-inline-end: 1px solid var(--devlens-border);
    font: 400 var(--devlens-font-size-sm) / 1.4 var(--devlens-font-mono);
  }
  [data-devlens-event-list-empty],
  [data-devlens-inspector-empty] {
    padding: var(--devlens-space-3);
    color: var(--devlens-text-muted);
    font-family: var(--devlens-font-ui);
  }
  [data-devlens-event-list-count] {
    position: sticky;
    top: 0;
    padding: var(--devlens-space-1) var(--devlens-space-2);
    color: var(--devlens-text-muted);
    background: var(--devlens-surface-subtle);
    border-block-end: 1px solid var(--devlens-border);
    font-family: var(--devlens-font-ui);
    font-size: var(--devlens-font-size-xs);
  }

  [data-devlens-event-row] {
    display: flex;
    align-items: baseline;
    gap: var(--devlens-space-2);
    padding: var(--devlens-space-1) var(--devlens-space-2);
    border-inline-start: 3px solid transparent;
    border-block-end: 1px solid var(--devlens-border);
    cursor: pointer;
    transition: background-color 120ms;
  }
  [data-devlens-event-severity] {
    flex: none;
    min-width: 5ch;
    font-size: var(--devlens-font-size-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--devlens-text-muted);
  }
  [data-devlens-event-title] {
    flex: 0 1 auto;
    max-width: 40%;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-devlens-event-message] {
    flex: 1 1 0;
    min-width: 0;
    color: var(--devlens-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ${SEVERITY_RULES}
  [data-devlens-event-row][data-devlens-severity="fatal"] [data-devlens-event-severity] {
    padding: 0 var(--devlens-space-1);
    color: var(--devlens-sev-fatal-label-text);
    background: var(--devlens-sev-fatal-label-bg);
    border-radius: var(--devlens-radius-sm);
  }
  @media (hover: hover) {
    [data-devlens-event-row]:hover { background: var(--devlens-surface-hover); }
  }
  [data-devlens-event-row][data-selected] {
    background: var(--devlens-surface-selected);
    box-shadow: inset 0 0 0 1px var(--devlens-accent);
  }
  mark[data-devlens-match] {
    color: var(--devlens-match-text);
    background: var(--devlens-match-bg);
    border-radius: var(--devlens-radius-sm);
  }

  /* ---- Inspector ---- */
  [data-devlens-inspector] {
    padding: var(--devlens-space-2) var(--devlens-space-3);
    font-size: var(--devlens-font-size-md);
    overflow-wrap: anywhere;
  }
  [data-devlens-inspector] > * + * { margin-block-start: var(--devlens-space-2); }
  [data-devlens-inspector-severity] {
    color: var(--devlens-text-muted);
    font-size: var(--devlens-font-size-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  [data-devlens-inspector-title] { font-weight: 600; }
  [data-devlens-inspector-message] { white-space: pre-wrap; }
  [data-devlens-inspector-stack] {
    padding: var(--devlens-space-2);
    background: var(--devlens-surface-subtle);
    border: 1px solid var(--devlens-border);
    font: 400 var(--devlens-font-size-sm) / 1.4 var(--devlens-font-mono);
    white-space: pre-wrap;
    tab-size: 2;
  }
  [data-devlens-inspector-metadata],
  [data-devlens-inspector-context] {
    padding-block-start: var(--devlens-space-2);
    border-block-start: 1px solid var(--devlens-border);
  }
  [data-devlens-inspector-metadata-entry],
  [data-devlens-inspector-context-entry] {
    display: grid;
    grid-template-columns: minmax(80px, 30%) minmax(0, 1fr);
    gap: var(--devlens-space-2);
  }
  [data-devlens-inspector-metadata-key],
  [data-devlens-inspector-context-key] {
    color: var(--devlens-text-muted);
    font-size: var(--devlens-font-size-xs);
  }
  [data-devlens-inspector-metadata-value],
  [data-devlens-inspector-context-value] {
    font: 400 var(--devlens-font-size-sm) / 1.4 var(--devlens-font-mono);
    white-space: pre-wrap;
  }
  [data-devlens-inspector-tags] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--devlens-space-1);
  }
  [data-devlens-inspector-tag] {
    padding: 0 var(--devlens-space-1);
    border: 1px solid var(--devlens-border-control);
    border-radius: var(--devlens-radius-sm);
    font-size: var(--devlens-font-size-xs);
  }

  /* ---- Trigger (never carries data-devlens-panel-region) ---- */
  [data-devlens-trigger] {
    position: fixed;
    bottom: var(--devlens-gutter);
    right: var(--devlens-gutter);
    z-index: 2147483647;
    min-height: var(--devlens-trigger-height);
    border-radius: var(--devlens-radius);
    background: var(--devlens-surface-raised);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
    font-weight: 600;
  }
  @media (hover: hover) {
    button:hover { background: var(--devlens-surface-hover); }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`;
