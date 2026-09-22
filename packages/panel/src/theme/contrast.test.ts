import { describe, it, expect } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS, type ColorTokens } from "./tokens";
import { contrastRatio } from "./contrast";

const AA_TEXT = 4.5;
const AA_UI = 3;

function textPairs(t: ColorTokens): [string, string, string][] {
  const textColors: [string, string][] = [
    ["text", t.text],
    ["textMuted", t.textMuted],
    ["sevTrace", t.sevTrace],
    ["sevDebug", t.sevDebug],
    ["sevInfo", t.sevInfo],
    ["sevWarn", t.sevWarn],
    ["sevError", t.sevError],
  ];
  const backgrounds: [string, string][] = [
    ["surface", t.surface],
    ["surfaceSubtle", t.surfaceSubtle],
    ["surfaceRaised", t.surfaceRaised],
    ["surfaceHover", t.surfaceHover],
    ["surfaceSelected", t.surfaceSelected],
  ];
  const pairs: [string, string, string][] = [];
  for (const [fn, f] of textColors)
    for (const [bn, b] of backgrounds) pairs.push([`${fn} on ${bn}`, f, b]);
  pairs.push(
    ["sevWarn on sevWarnBg", t.sevWarn, t.sevWarnBg],
    ["sevError on sevErrorBg", t.sevError, t.sevErrorBg],
    ["text on sevWarnBg", t.text, t.sevWarnBg],
    ["text on sevErrorBg", t.text, t.sevErrorBg],
    ["text on sevFatalBg", t.text, t.sevFatalBg],
    ["textMuted on sevWarnBg", t.textMuted, t.sevWarnBg],
    ["textMuted on sevErrorBg", t.textMuted, t.sevErrorBg],
    ["textMuted on sevFatalBg", t.textMuted, t.sevFatalBg],
    ["fatal label", t.sevFatalLabelText, t.sevFatalLabelBg],
    ["matchText on matchBg", t.matchText, t.matchBg]
  );
  return pairs;
}

function uiPairs(t: ColorTokens): [string, string, string][] {
  return [
    ["focus on surface", t.focus, t.surface],
    ["focus on surfaceSubtle", t.focus, t.surfaceSubtle],
    ["focus on surfaceSelected", t.focus, t.surfaceSelected],
    ["accent on surfaceSelected", t.accent, t.surfaceSelected],
    ["borderControl on surface", t.borderControl, t.surface],
    ["borderControl on surfaceSubtle", t.borderControl, t.surfaceSubtle],
    ["borderControl on surfaceRaised", t.borderControl, t.surfaceRaised],
    ["fatal label bg on surface", t.sevFatalLabelBg, t.surface],
  ];
}

describe.each([
  ["dark", DARK_TOKENS],
  ["light", LIGHT_TOKENS],
])("%s theme contrast", (_name, tokens) => {
  it.each(textPairs(tokens))("text pair meets AA 4.5:1 — %s", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(uiPairs(tokens))("UI pair meets 3:1 — %s", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it("only uses #rrggbb for contrast-checked colors", () => {
    for (const [k, v] of Object.entries(tokens)) {
      if (k === "shadow") continue;
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("theme token parity", () => {
  it("dark and light define the same keys", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
  });
});
