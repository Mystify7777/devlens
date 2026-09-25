import { describe, it, expect } from "vitest";
import { classifyHttpStatus } from "./http-status";

describe("classifyHttpStatus", () => {
  it.each([200, 201, 204, 299])("status %i -> success/info", (status) => {
    expect(classifyHttpStatus(status)).toEqual({ outcome: "success", severity: "info" });
  });

  it.each([400, 404, 429, 499])("status %i -> http-error/warn", (status) => {
    expect(classifyHttpStatus(status)).toEqual({ outcome: "http-error", severity: "warn" });
  });

  it.each([500, 502, 503, 599])("status %i -> http-error/error", (status) => {
    expect(classifyHttpStatus(status)).toEqual({ outcome: "http-error", severity: "error" });
  });

  it("an unanticipated status (e.g. a raw 3xx) -> success/info, not a guessed http-error", () => {
    expect(classifyHttpStatus(300)).toEqual({ outcome: "success", severity: "info" });
  });

  it("is pure — the same input produces the same output, called repeatedly", () => {
    expect(classifyHttpStatus(404)).toEqual(classifyHttpStatus(404));
  });
});
