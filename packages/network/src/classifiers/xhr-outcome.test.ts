import { describe, it, expect } from "vitest";
import { classifyXhrOutcome } from "./xhr-outcome";

describe("classifyXhrOutcome", () => {
  describe("event: 'abort'", () => {
    it("-> aborted/info, regardless of status", () => {
      expect(classifyXhrOutcome({ event: "abort", status: 0 })).toEqual({
        outcome: "aborted",
        severity: "info",
      });
    });
  });

  describe("event: 'timeout'", () => {
    it("-> timeout/warn — native evidence, not inferred", () => {
      expect(classifyXhrOutcome({ event: "timeout", status: 0 })).toEqual({
        outcome: "timeout",
        severity: "warn",
      });
    });
  });

  describe("event: 'error'", () => {
    it("-> network-error/error — no XHR equivalent of Fetch's opaque case", () => {
      expect(classifyXhrOutcome({ event: "error", status: 0 })).toEqual({
        outcome: "network-error",
        severity: "error",
      });
    });
  });

  // Exhaustive 2xx/4xx/5xx/fallback range coverage lives in
  // http-status.test.ts. These cases only
  // check that a `load` event's status actually reaches
  // classifyHttpStatus() — delegation, not the range logic itself.
  describe("event: 'load' — delegates status-range classification", () => {
    it("status 200 -> success/info", () => {
      expect(classifyXhrOutcome({ event: "load", status: 200 })).toEqual({
        outcome: "success",
        severity: "info",
      });
    });

    it("status 500 -> http-error/error", () => {
      expect(classifyXhrOutcome({ event: "load", status: 500 })).toEqual({
        outcome: "http-error",
        severity: "error",
      });
    });

    it("an unexpected status on a load event falls back to success, never guessed as an error", () => {
      expect(classifyXhrOutcome({ event: "load", status: 300 })).toEqual({
        outcome: "success",
        severity: "info",
      });
    });
  });

  it("is pure — the same input produces the same output, called repeatedly", () => {
    const settlement = { event: "load" as const, status: 404 };
    expect(classifyXhrOutcome(settlement)).toEqual(classifyXhrOutcome(settlement));
  });
});
