import { describe, it, expect } from "vitest";
import { createEventBus } from "@devlens/core";
import { normalizeNetworkEvent } from "./network-normalizer";
import type { CapturedRequest } from "../types";

function makeCapturedRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    origin: "fetch",
    method: "GET",
    url: "https://api.example.com/users/123",
    status: 200,
    duration: 142,
    outcome: "success",
    severity: "info",
    ...overrides,
  };
}

describe("normalizeNetworkEvent", () => {
  it("places origin, category, and severity exactly where CapturedRequest put them", () => {
    const request = makeCapturedRequest({
      origin: "xhr",
      severity: "warn",
    });
    const result = normalizeNetworkEvent(request);

    expect(result.origin).toBe("xhr");
    expect(result.category).toBe("network");
    expect(result.severity).toBe("warn");
  });

  it("formats the title as exactly '<method> <url>'", () => {
    const request = makeCapturedRequest({
      method: "POST",
      url: "https://api.example.com/orders",
    });
    const result = normalizeNetworkEvent(request);
    expect(result.title).toBe("POST https://api.example.com/orders");
  });

  it("formats the message with status and duration when a response was received", () => {
    const request = makeCapturedRequest({ status: 404, duration: 88 });
    const result = normalizeNetworkEvent(request);
    expect(result.message).toBe("404 (88ms)");
  });

  it("formats the message with outcome and duration when status is null", () => {
    const request = makeCapturedRequest({
      status: null,
      outcome: "network-error",
      duration: 55,
    });
    const result = normalizeNetworkEvent(request);
    expect(result.message).toBe("network-error (55ms)");
  });

  it("preserves duration exactly, unmodified", () => {
    const request = makeCapturedRequest({ duration: 12345 });
    const result = normalizeNetworkEvent(request);
    expect(result.metadata?.duration).toBe(12345);
  });

  it("preserves the URL exactly — no redaction happens here", () => {
    const request = makeCapturedRequest({
      url: "https://api.example.com/search?token=super-secret-value",
    });
    const result = normalizeNetworkEvent(request);
    // If this function ever redacted, this assertion (and the title
    // assertion above) would be the first thing to fail — redaction is
    // explicitly a capture-layer concern (ADR-0010), not normalization's.
    expect(result.metadata?.url).toBe("https://api.example.com/search?token=super-secret-value");
    expect(result.title).toContain("token=super-secret-value");
  });

  it("carries every CapturedRequest field into metadata, unchanged", () => {
    const request = makeCapturedRequest({
      method: "PUT",
      url: "https://api.example.com/items/1",
      status: 500,
      duration: 900,
      outcome: "http-error",
    });
    const result = normalizeNetworkEvent(request);
    expect(result.metadata).toEqual({
      method: "PUT",
      url: "https://api.example.com/items/1",
      status: 500,
      duration: 900,
      outcome: "http-error",
    });
  });

  it("represents a null status (no response received) as null in metadata, not a placeholder", () => {
    const request = makeCapturedRequest({ status: null, outcome: "timeout" });
    const result = normalizeNetworkEvent(request);
    expect(result.metadata?.status).toBeNull();
  });

  it("is deterministic — the same input produces structurally identical output", () => {
    const request = makeCapturedRequest();
    const first = normalizeNetworkEvent(request);
    const second = normalizeNetworkEvent(request);
    expect(first).toEqual(second);
  });

  it("does not mutate the input CapturedRequest", () => {
    const request = makeCapturedRequest();
    const snapshot = { ...request };
    normalizeNetworkEvent(request);
    expect(request).toEqual(snapshot);
  });

  it("sets no stack, context, or tags — Network v1 has no use for them", () => {
    const result = normalizeNetworkEvent(makeCapturedRequest());
    expect(result.stack).toBeUndefined();
    expect(result.context).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  it("produces a DevLensEventInput the real EventBus accepts and freezes normally", () => {
    const bus = createEventBus();
    const input = normalizeNetworkEvent(makeCapturedRequest());
    const reported = bus.report(input);

    expect(reported.category).toBe("network");
    expect(reported.id).toBeTruthy();
    expect(reported.version).toBe(1);
    expect(typeof reported.timestamp).toBe("number");
    expect(Object.isFrozen(reported)).toBe(true);
  });
});
