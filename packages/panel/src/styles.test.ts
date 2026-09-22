import { describe, it, expect } from "vitest";
import { PANEL_STYLES } from "./styles";
import { DARK_TOKENS, LIGHT_TOKENS, SEVERITIES } from "./theme/tokens";

const kebab = (k: string) => `--devlens-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

describe("PANEL_STYLES (Issue #20)", () => {
  it("defines every color token in both themes", () => {
    for (const key of Object.keys(DARK_TOKENS)) {
      const name = kebab(key);
      expect(PANEL_STYLES.split(`${name}:`).length - 1, name).toBeGreaterThanOrEqual(3);
    }
    expect(Object.keys(LIGHT_TOKENS)).toEqual(Object.keys(DARK_TOKENS));
  });

  it("orders theme rules: dark default, system light, explicit overrides last", () => {
    const media = PANEL_STYLES.indexOf("prefers-color-scheme: light");
    const explicitLight = PANEL_STYLES.indexOf(':host([data-theme="light"])');
    const explicitDark = PANEL_STYLES.indexOf(':host([data-theme="dark"])');
    expect(media).toBeGreaterThan(-1);
    expect(explicitLight).toBeGreaterThan(media);
    expect(explicitDark).toBeGreaterThan(explicitLight);
  });

  it("styles every severity without relying on color alone (label text is DOM-owned)", () => {
    for (const s of SEVERITIES) {
      expect(PANEL_STYLES).toContain(`[data-devlens-severity="${s}"]`);
    }
    // fatal is distinguished from error by a filled label, not hue
    expect(PANEL_STYLES).toContain("--devlens-sev-fatal-label-bg");
  });

  it("keeps the hide rule scoped to panel regions, not the trigger", () => {
    expect(PANEL_STYLES).toContain(":host([data-hidden]) [data-devlens-panel-region]");
    expect(PANEL_STYLES).toMatch(/\[data-devlens-trigger\][^}]*position: fixed/);
  });

  it("hardens the host: reset, critical declarations, explicit direction", () => {
    expect(PANEL_STYLES).toContain("all: initial;");
    expect(PANEL_STYLES).toContain("display: grid !important");
    expect(PANEL_STYLES).toContain("position: fixed !important");
    expect(PANEL_STYLES).toContain("z-index: 2147483646 !important");
    expect(PANEL_STYLES).toContain("direction: ltr");
  });

  it("never puts transform/filter/contain on the host (would break the fixed trigger)", () => {
    const hostRules = PANEL_STYLES.match(/:host[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of hostRules) {
      expect(rule).not.toMatch(/\b(transform|filter|contain|perspective)\s*:/);
    }
  });

  it("trigger z-index stays above the panel", () => {
    expect(PANEL_STYLES).toContain("z-index: 2147483647;");
  });

  it("has a focus-visible style and never removes outlines bare", () => {
    expect(PANEL_STYLES).toContain(":focus-visible");
    expect(PANEL_STYLES).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("disables transitions under prefers-reduced-motion", () => {
    const idx = PANEL_STYLES.indexOf("prefers-reduced-motion: reduce");
    expect(idx).toBeGreaterThan(-1);
    expect(PANEL_STYLES.slice(idx)).toContain("transition: none");
  });

  it("switches to stacked layout on narrow viewports and enlarges targets on coarse pointers", () => {
    expect(PANEL_STYLES).toContain("@media (max-width: 599px)");
    expect(PANEL_STYLES).toContain("@media (pointer: coarse)");
    expect(PANEL_STYLES).toContain("--devlens-target: 44px");
  });

  it("uses no hard-coded colors outside the token maps", () => {
    const withoutTokenBlocks = PANEL_STYLES.replace(/--devlens-[a-z-]+:[^;]+;/g, "");
    expect(withoutTokenBlocks).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
