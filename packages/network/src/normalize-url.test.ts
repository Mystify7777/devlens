import { describe, it, expect } from "vitest";
import { normalizeCapturedUrl } from "./normalize-url";

const BASE = "https://app.example.com/";

describe("normalizeCapturedUrl", () => {
  describe("canonicalization", () => {
    it("lowercases the scheme and hostname", () => {
      expect(normalizeCapturedUrl("HTTPS://API.Example.COM/users", BASE)).toBe(
        "https://api.example.com/users"
      );
    });

    it("omits the default port for the URL's scheme", () => {
      expect(normalizeCapturedUrl("https://api.example.com:443/users", BASE)).toBe(
        "https://api.example.com/users"
      );
      expect(normalizeCapturedUrl("http://api.example.com:80/users", BASE)).toBe(
        "http://api.example.com/users"
      );
    });

    it("preserves a non-default port", () => {
      expect(normalizeCapturedUrl("https://api.example.com:8443/users", BASE)).toBe(
        "https://api.example.com:8443/users"
      );
    });

    it("resolves a relative URL against the given base", () => {
      expect(normalizeCapturedUrl("/users/123", BASE)).toBe("https://app.example.com/users/123");
    });

    it("strips the fragment", () => {
      expect(normalizeCapturedUrl("https://api.example.com/users#section-2", BASE)).toBe(
        "https://api.example.com/users"
      );
    });

    it("strips the fragment on a relative URL too", () => {
      expect(normalizeCapturedUrl("/users#section-2", BASE)).toBe("https://app.example.com/users");
    });

    it("percent-encodes an unsafe literal character (e.g. a space) rather than leaving it raw", () => {
      expect(normalizeCapturedUrl("https://api.example.com/path with space", BASE)).toBe(
        "https://api.example.com/path%20with%20space"
      );
    });

    it("does not decode or re-case percent-encoding that is already present", () => {
      // Corrected assumption: the native URL parser does NOT decode
      // already-encoded unreserved characters, and does NOT normalize
      // existing percent-encoding's hex-digit case — verified
      // empirically, not assumed. An earlier draft of this function's
      // documentation claimed otherwise (conflated with a third-party
      // URL library's own explicit extra normalize() step).
      expect(normalizeCapturedUrl("https://api.example.com/%61pi", BASE)).toBe(
        "https://api.example.com/%61pi"
      );
      expect(normalizeCapturedUrl("https://api.example.com/%2f%2F", BASE)).toBe(
        "https://api.example.com/%2f%2F"
      );
    });

    it("does not touch a trailing slash", () => {
      expect(normalizeCapturedUrl("https://api.example.com/users/", BASE)).toBe(
        "https://api.example.com/users/"
      );
      expect(normalizeCapturedUrl("https://api.example.com/users", BASE)).toBe(
        "https://api.example.com/users"
      );
    });

    it("does not group path parameters into an endpoint template", () => {
      // Issue #17 / ADR-0010 amendment: explicitly not decided
      // automatically. /users/123 and /users/456 must remain visibly
      // distinct.
      expect(normalizeCapturedUrl("https://api.example.com/users/123", BASE)).toBe(
        "https://api.example.com/users/123"
      );
      expect(normalizeCapturedUrl("https://api.example.com/users/456", BASE)).toBe(
        "https://api.example.com/users/456"
      );
    });
  });

  describe("query-value redaction", () => {
    it("redacts a non-empty query parameter value, preserving its name", () => {
      const result = normalizeCapturedUrl("https://api.example.com/login?token=abc123", BASE);
      expect(result).toBe("https://api.example.com/login?token=***");
      expect(new URL(result).searchParams.get("token")).toBe("***");
    });

    it("redacts multiple parameters independently", () => {
      const result = normalizeCapturedUrl("https://api.example.com/search?q=secret&page=2", BASE);
      const params = new URL(result).searchParams;
      expect(params.get("q")).toBe("***");
      expect(params.get("page")).toBe("***");
    });

    it("leaves a valueless flag parameter empty rather than redacting it, serializing as ?debug= (not the original bare ?debug)", () => {
      // Explicit on the exact lexical form so a future maintainer
      // can't misread "leaves it empty" as "preserves the original
      // ?debug syntax" — URLSearchParams doesn't distinguish a bare
      // flag from an explicit empty value; both round-trip as
      // "debug=" (documented as an accepted equivalence-class
      // collapse in the ADR-0010 amendment). What's actually
      // guaranteed is: no `***` marker where nothing was redacted.
      const result = normalizeCapturedUrl("https://api.example.com/items?debug", BASE);
      expect(result).toBe("https://api.example.com/items?debug=");
      expect(new URL(result).searchParams.get("debug")).toBe("");
    });

    it("redacts each instance of a duplicate-key parameter independently, preserving multiplicity", () => {
      const result = normalizeCapturedUrl("https://api.example.com/items?tag=a&tag=b", BASE);
      const parsed = new URL(result);
      expect(parsed.searchParams.getAll("tag")).toEqual(["***", "***"]);
    });

    it("redacts percent-encoded, sensitive-looking values completely — nothing of the original leaks through", () => {
      // The whole point of this function existing is that a token or
      // an email address never survives into a reported event. This
      // asserts the full serialized URL, not just individual param
      // reads, so there's nowhere for a partial redaction (e.g. only
      // decoding, not replacing) to hide.
      const result = normalizeCapturedUrl(
        "https://api.example.com/auth?token=secret%2Fvalue&user=alice%40example.com",
        BASE
      );
      expect(result).toBe("https://api.example.com/auth?token=***&user=***");
      expect(result).not.toContain("secret");
      expect(result).not.toContain("alice");
    });

    it("produces no query string when the original had none", () => {
      const result = normalizeCapturedUrl("https://api.example.com/users", BASE);
      expect(result).toBe("https://api.example.com/users");
      expect(result.includes("?")).toBe(false);
    });
  });

  describe("malformed input (non-interference invariant)", () => {
    it("returns the raw string unchanged when it cannot be parsed as a URL, even with a valid base", () => {
      // Empirically confirmed (not assumed): "http://" has no host,
      // which the URL Standard requires for a special scheme, so this
      // throws regardless of how valid `base` is. This is the case
      // the fallback exists for — a genuinely unparseable input, not
      // merely a relative-reference convenience the base could have
      // resolved.
      const raw = "http://";
      expect(() => new URL(raw, BASE)).toThrow();

      expect(normalizeCapturedUrl(raw, BASE)).toBe(raw);
    });

    it("does not throw when given malformed input — describing a request badly must never look like the request itself failing", () => {
      expect(() => normalizeCapturedUrl("http://", BASE)).not.toThrow();
    });
  });
});
