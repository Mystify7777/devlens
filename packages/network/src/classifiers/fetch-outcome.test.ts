import { describe, it, expect } from "vitest";
import { classifyFetchOutcome } from "./fetch-outcome";

function fulfilled(response: Response) {
  return classifyFetchOutcome({ state: "fulfilled", response });
}

function rejected(error: unknown) {
  return classifyFetchOutcome({ state: "rejected", error });
}

describe("classifyFetchOutcome", () => {
  describe("2xx — success", () => {
    it.each([200, 201, 204, 299])("status %i -> success/info", (status) => {
      const response = new Response(null, { status });
      expect(fulfilled(response)).toEqual({
        outcome: "success",
        severity: "info",
      });
    });
  });

  describe("4xx — http-error/warn", () => {
    it.each([400, 404, 429, 499])("status %i -> http-error/warn", (status) => {
      const response = new Response(null, { status });
      expect(fulfilled(response)).toEqual({
        outcome: "http-error",
        severity: "warn",
      });
    });
  });

  describe("5xx — http-error/error", () => {
    it.each([500, 502, 503, 599])("status %i -> http-error/error", (status) => {
      const response = new Response(null, { status });
      expect(fulfilled(response)).toEqual({
        outcome: "http-error",
        severity: "error",
      });
    });
  });

  describe("opaque responses", () => {
    it("status 0, type 'opaque' -> opaque/info", () => {
      // jsdom/Node's Response can't construct a genuinely opaque
      // response directly (that's a fetch-internal filtering step),
      // so this constructs the observable shape the classifier
      // actually branches on: status 0 with the matching type.
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "status", { value: 0 });
      Object.defineProperty(response, "type", { value: "opaque" });
      expect(fulfilled(response)).toEqual({
        outcome: "opaque",
        severity: "info",
      });
    });

    it("status 0, type 'opaqueredirect' -> opaque/info", () => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "status", { value: 0 });
      Object.defineProperty(response, "type", { value: "opaqueredirect" });
      expect(fulfilled(response)).toEqual({
        outcome: "opaque",
        severity: "info",
      });
    });
  });

  describe("unexpected but fulfilled — falls back to success, never guessed as an error", () => {
    it("a 3xx status (constructible, though unreachable via real fetch() behavior) -> success/info", () => {
      // Documented in fetch-outcome.ts: a real fetch() call never
      // actually exposes a raw 3xx (redirects are either fully
      // resolved to their final response, or collapse to status 0
      // under redirect:"manual"). 300 is used here only because it's
      // the one "unexpected" range the Response constructor even
      // allows [200,599] — it's the fallback path's only realistically
      // constructible test case.
      const response = new Response(null, { status: 300 });
      expect(fulfilled(response)).toEqual({
        outcome: "success",
        severity: "info",
      });
    });
  });

  describe("rejected — aborted", () => {
    it("AbortError -> aborted/info", () => {
      const error = new DOMException("The operation was aborted", "AbortError");
      expect(rejected(error)).toEqual({ outcome: "aborted", severity: "info" });
    });

    it("a manual setTimeout(() => controller.abort()) pattern still produces AbortError, not timeout — not guessed", () => {
      // This is the concrete case the research/ADR discussion named
      // explicitly: fetch cannot tell a real user cancellation apart
      // from a caller-implemented timeout unless AbortSignal.timeout()
      // was used. Both look identical here, and both must classify
      // as `aborted`, not `timeout` — guessing would violate the
      // locked contract.
      const error = new DOMException("The user aborted a request.", "AbortError");
      expect(rejected(error)).toEqual({ outcome: "aborted", severity: "info" });
    });

    it("classifies by .name via duck-typing, not instanceof Error — an error-like object with no Error in its prototype chain still classifies correctly", () => {
      // Regression test for a real bug this project's own test suite
      // caught: jsdom's DOMException does not extend Error
      // (`instanceof Error` is false there), which would silently
      // misclassify a real AbortError as network-error in that
      // environment if this function checked `instanceof Error`
      // instead of duck-typing on `.name`. This object simulates that
      // gap directly, independent of which environment the test
      // happens to run in.
      const errorLikeButNotAnError = { name: "AbortError", message: "aborted" };
      expect(rejected(errorLikeButNotAnError)).toEqual({
        outcome: "aborted",
        severity: "info",
      });
    });
  });

  describe("rejected — timeout", () => {
    it("TimeoutError (from AbortSignal.timeout()) -> timeout/warn", () => {
      const error = new DOMException("The signal timed out", "TimeoutError");
      expect(rejected(error)).toEqual({ outcome: "timeout", severity: "warn" });
    });
  });

  describe("rejected — network-error", () => {
    it("a generic TypeError('Failed to fetch') -> network-error/error", () => {
      const error = new TypeError("Failed to fetch");
      expect(rejected(error)).toEqual({
        outcome: "network-error",
        severity: "error",
      });
    });

    it("an Error with an unrecognized name -> network-error/error (the honest fallback)", () => {
      const error = new Error("something else entirely");
      error.name = "SomeUnrecognizedError";
      expect(rejected(error)).toEqual({
        outcome: "network-error",
        severity: "error",
      });
    });

    it("a rejection reason that isn't even an Error -> network-error/error, does not throw", () => {
      expect(() => rejected("a plain string rejection")).not.toThrow();
      expect(rejected("a plain string rejection")).toEqual({
        outcome: "network-error",
        severity: "error",
      });
      expect(rejected(undefined)).toEqual({
        outcome: "network-error",
        severity: "error",
      });
    });
  });

  it("is pure — the same input produces the same output, called repeatedly", () => {
    const response = new Response(null, { status: 404 });
    const first = fulfilled(response);
    const second = fulfilled(response);
    expect(first).toEqual(second);
  });
});
