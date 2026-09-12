import { describe, it, expect } from "vitest";
import { parseContentLength } from "./parse-content-length";

describe("parseContentLength", () => {
  it("parses a valid positive integer", () => {
    expect(parseContentLength("123")).toBe(123);
  });

  it("parses Content-Length: 0 as the number 0, not null", () => {
    // The one case every reviewer of this contract insisted on
    // pinning down explicitly: 0 is a real, meaningful result (an
    // empty response body), and a truthy check on the parsed value
    // would wrongly treat it as failure. This test exists
    // specifically so that regression can never hide inside a more
    // generic "valid value" assertion.
    expect(parseContentLength("0")).toBe(0);
  });

  it("returns null for a missing header (null input)", () => {
    expect(parseContentLength(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseContentLength("")).toBeNull();
  });

  it("returns null for a whitespace-only value, never coercing it to 0", () => {
    // Number(" ") is 0 in JavaScript — exactly the footgun this
    // function's grammar check exists to avoid.
    expect(parseContentLength(" ")).toBeNull();
  });

  it("returns null for scientific notation", () => {
    expect(parseContentLength("1e3")).toBeNull();
  });

  it("returns null for a hex-prefixed value", () => {
    expect(parseContentLength("0x10")).toBeNull();
  });

  it("returns null for a leading plus sign", () => {
    expect(parseContentLength("+10")).toBeNull();
  });

  it("returns null for a negative value", () => {
    expect(parseContentLength("-5")).toBeNull();
  });

  it("returns null for a decimal value", () => {
    expect(parseContentLength("123.5")).toBeNull();
  });

  it("returns null for a value with leading/trailing whitespace around otherwise-valid digits", () => {
    expect(parseContentLength(" 123")).toBeNull();
    expect(parseContentLength("123 ")).toBeNull();
  });

  it("returns null for a duplicate/comma-joined header value, without attempting to pick one", () => {
    expect(parseContentLength("123, 456")).toBeNull();
    expect(parseContentLength("123, 123")).toBeNull();
  });

  it("returns null for a value that overflows JavaScript's safe integer range", () => {
    expect(parseContentLength("9007199254740993")).toBeNull();
  });

  it("parses the largest safe integer successfully", () => {
    expect(parseContentLength(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
