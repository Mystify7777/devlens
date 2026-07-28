import { describe, it, expect } from "vitest";
import { normalizeConsoleCall } from "./console-normalizer";

describe("normalizeConsoleCall", () => {
  it("normalizes a string argument", () => {
    const result = normalizeConsoleCall("log", ["hello"]);
    expect(result.message).toBe("hello");
    expect(result.category).toBe("console");
    expect(result.severity).toBe("info");
    expect(result.origin).toBe("console.log");
    expect(result.title).toBe("Console Log");
  });

  it("normalizes a number argument", () => {
    expect(normalizeConsoleCall("log", [42]).message).toBe("42");
  });

  it("normalizes a boolean argument", () => {
    expect(normalizeConsoleCall("log", [false]).message).toBe("false");
  });

  it("normalizes an Error argument, extracting message and preserving stack", () => {
    const err = new Error("boom");
    const result = normalizeConsoleCall("error", [err]);
    expect(result.message).toBe("boom");
    expect(result.stack).toBe(err.stack);
    expect(result.severity).toBe("error");
  });

  it("normalizes a plain object via JSON.stringify", () => {
    const result = normalizeConsoleCall("log", [{ a: 1 }]);
    expect(result.message).toBe(JSON.stringify({ a: 1 }));
  });

  it("falls back to String() for a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = normalizeConsoleCall("log", [circular]);
    expect(result.message).toBe(String(circular));
  });

  it("preserves all arguments in metadata.args, not just the first", () => {
    const result = normalizeConsoleCall("log", ["first", "second", 3]);
    expect(result.metadata?.args).toEqual(["first", "second", 3]);
    expect(result.message).toBe("first");
  });

  it("handles a call with no arguments", () => {
    const result = normalizeConsoleCall("log", []);
    expect(result.message).toBe("");
    expect(result.metadata?.args).toEqual([]);
  });

  it("maps severity correctly for warn, debug, and info", () => {
    expect(normalizeConsoleCall("warn", ["x"]).severity).toBe("warn");
    expect(normalizeConsoleCall("debug", ["x"]).severity).toBe("debug");
    expect(normalizeConsoleCall("info", ["x"]).severity).toBe("info");
  });
});