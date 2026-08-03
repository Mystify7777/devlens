import { describe, it, expect } from "vitest";
import { highlightText } from "./highlight";

function marks(fragment: DocumentFragment): string[] {
  return Array.from(fragment.querySelectorAll("[data-devlens-match]")).map(
    (el) => el.textContent ?? ""
  );
}

function plainText(fragment: DocumentFragment): string {
  return fragment.textContent ?? "";
}

describe("highlightText", () => {
  describe("empty query — identity", () => {
    it("returns the original text unwrapped when the query is an empty string", () => {
      const fragment = highlightText("Runtime Error", "");
      expect(marks(fragment)).toEqual([]);
      expect(plainText(fragment)).toBe("Runtime Error");
    });

    it("returns the original text unwrapped when the query is only whitespace", () => {
      const fragment = highlightText("Runtime Error", "   ");
      expect(marks(fragment)).toEqual([]);
      expect(plainText(fragment)).toBe("Runtime Error");
    });
  });

  describe("no match", () => {
    it("returns the original text unwrapped when the query doesn't occur", () => {
      const fragment = highlightText("Runtime Error", "nonexistent");
      expect(marks(fragment)).toEqual([]);
      expect(plainText(fragment)).toBe("Runtime Error");
    });
  });

  describe("matching", () => {
    it("wraps a single match in a <mark data-devlens-match> element", () => {
      const fragment = highlightText("Network Timeout", "Timeout");
      expect(marks(fragment)).toEqual(["Timeout"]);
    });

    it("matches case-insensitively while preserving the original casing of the matched text", () => {
      const fragment = highlightText("Network TIMEOUT occurred", "timeout");
      expect(marks(fragment)).toEqual(["TIMEOUT"]);
    });

    it("wraps every non-overlapping occurrence, not just the first", () => {
      const fragment = highlightText("error, then another error", "error");
      expect(marks(fragment)).toEqual(["error", "error"]);
    });

    it("wraps a match at the very start of the text", () => {
      const fragment = highlightText("Timeout occurred", "Timeout");
      expect(marks(fragment)).toEqual(["Timeout"]);
      expect(plainText(fragment)).toBe("Timeout occurred");
    });

    it("wraps a match at the very end of the text", () => {
      const fragment = highlightText("Occurred: Timeout", "Timeout");
      expect(marks(fragment)).toEqual(["Timeout"]);
    });

    it("wraps the entire text when the query matches it exactly", () => {
      const fragment = highlightText("Timeout", "Timeout");
      expect(marks(fragment)).toEqual(["Timeout"]);
      expect(plainText(fragment)).toBe("Timeout");
    });

    it("handles adjacent, back-to-back matches", () => {
      const fragment = highlightText("aa", "a");
      expect(marks(fragment)).toEqual(["a", "a"]);
    });

    it("returns an empty fragment for empty input text with a non-empty query", () => {
      const fragment = highlightText("", "timeout");
      expect(marks(fragment)).toEqual([]);
      expect(plainText(fragment)).toBe("");
    });
  });

  describe("text-preserving invariant", () => {
    it("preserves the exact original string across a variety of inputs", () => {
      const cases: [string, string][] = [
        ["Network Timeout occurred twice: timeout, TIMEOUT", "timeout"],
        ["no match here at all", "xyz"],
        ["", "anything"],
        ["exact", "exact"],
        ["aaaa", "aa"],
        ["  leading and trailing spaces  ", "spaces"],
      ];

      for (const [text, query] of cases) {
        expect(plainText(highlightText(text, query))).toBe(text);
      }
    });
  });
});
