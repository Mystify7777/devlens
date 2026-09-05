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

  describe("event: 'load' — classified by status", () => {
    it.each([200, 201, 204, 299])("status %i -> success/info", (status) => {
      expect(classifyXhrOutcome({ event: "load", status })).toEqual({
        outcome: "success",
        severity: "info",
      });
    });

    it.each([400, 404, 429, 499])("status %i -> http-error/warn", (status) => {
      expect(classifyXhrOutcome({ event: "load", status })).toEqual({
        outcome: "http-error",
        severity: "warn",
      });
    });

    it.each([500, 502, 503, 599])("status %i -> http-error/error", (status) => {
      expect(classifyXhrOutcome({ event: "load", status })).toEqual({
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
