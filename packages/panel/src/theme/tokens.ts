import type { EventSeverity } from "@devlens/core";

/**
 * Semantic color tokens (Issue #20, ADR-0008 amendment). Plain data so
 * the contrast test can read the exact values that ship. Keys map to
 * `--devlens-<kebab-case>` custom properties.
 */
export interface ColorTokens {
  surface: string;
  surfaceSubtle: string;
  surfaceRaised: string;
  surfaceHover: string;
  surfaceSelected: string;
  /** Decorative separators only — NOT for identifying controls. */
  border: string;
  /** Control outlines / non-text UI: must meet 3:1 against surface. */
  borderControl: string;
  text: string;
  textMuted: string;
  focus: string;
  accent: string;
  matchBg: string;
  matchText: string;
  sevTrace: string;
  sevDebug: string;
  sevInfo: string;
  sevWarn: string;
  sevError: string;
  sevFatalLabelText: string;
  sevFatalLabelBg: string;
  sevWarnBg: string;
  sevErrorBg: string;
  sevFatalBg: string;
  shadow: string;
}

export const DARK_TOKENS: ColorTokens = {
  surface: "#16181d",
  surfaceSubtle: "#1d2027",
  surfaceRaised: "#242832",
  surfaceHover: "#222630",
  surfaceSelected: "#2b3444",
  border: "#333a47",
  borderControl: "#6b7385",
  text: "#e6e8ec",
  textMuted: "#9ba3b0",
  focus: "#5aa9ff",
  accent: "#5aa9ff",
  matchBg: "#5c4b00",
  matchText: "#fff3c4",
  sevTrace: "#9ba3b0",
  sevDebug: "#9ba3b0",
  sevInfo: "#7cb7ff",
  sevWarn: "#e5b455",
  sevError: "#ff7b72",
  sevFatalLabelText: "#ffffff",
  sevFatalLabelBg: "#c93c37",
  sevWarnBg: "#26221a",
  sevErrorBg: "#2a1d1f",
  sevFatalBg: "#33191c",
  shadow: "0 8px 24px rgb(0 0 0 / 0.45)",
};

export const LIGHT_TOKENS: ColorTokens = {
  surface: "#ffffff",
  surfaceSubtle: "#f6f7f9",
  surfaceRaised: "#ffffff",
  surfaceHover: "#eef1f5",
  surfaceSelected: "#dbe7fb",
  border: "#d0d5dd",
  borderControl: "#767e8c",
  text: "#1b1f27",
  textMuted: "#586071",
  focus: "#0b5fd1",
  accent: "#0b5fd1",
  matchBg: "#ffe680",
  matchText: "#1b1f27",
  sevTrace: "#5f6776",
  sevDebug: "#586071",
  sevInfo: "#0b5fd1",
  sevWarn: "#8a5a00",
  sevError: "#b4231a",
  sevFatalLabelText: "#ffffff",
  sevFatalLabelBg: "#b4231a",
  sevWarnBg: "#fff6e0",
  sevErrorBg: "#fdecea",
  sevFatalBg: "#fbdcd8",
  shadow: "0 8px 24px rgb(0 0 0 / 0.18)",
};

/** Ordered as in the event model; typed against Core so drift fails tsc. */
export const SEVERITIES = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const satisfies readonly EventSeverity[];

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function toCustomProperties(tokens: ColorTokens): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--devlens-${kebab(key)}: ${value};`)
    .join("\n    ");
}
