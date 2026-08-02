import { describe, it, expect } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { applySearch } from "./search";

let idCounter = 0;

function makeEvent(overrides: Partial<DevLensEvent> = {}): DevLensEvent {
  idCounter += 1;
  return {
    id: `event-${idCounter}`,
    version: 1,
    origin: "console.error",
    category: "console",
    severity: "error",
    title: "Something Failed",
    message: "a failure occurred",
    timestamp: idCounter,
    ...overrides,
  } satisfies DevLensEvent;
}

describe("applySearch", () => {
  describe("empty query — identity transformation", () => {
    it("returns every event when the query is an empty string", () => {
      const events = [makeEvent(), makeEvent()];
      expect(applySearch(events, "")).toEqual(events);
    });

    it("returns every event when the query is only whitespace", () => {
      const events = [makeEvent(), makeEvent()];
      expect(applySearch(events, "   ")).toEqual(events);
    });

    it("returns a new array, not the same reference, for an empty query", () => {
      const events = [makeEvent()];
      const result = applySearch(events, "");
      expect(result).not.toBe(events);
      expect(result).toEqual(events);
    });
  });

  describe("whitespace normalization", () => {
    it("treats a query with leading/trailing whitespace the same as the trimmed query", () => {
      const match = makeEvent({ title: "Runtime Error" });
      const events = [match, makeEvent({ title: "Console Log" })];

      expect(applySearch(events, "  runtime error  ")).toEqual(
        applySearch(events, "runtime error")
      );
      expect(applySearch(events, "  runtime error  ")).toEqual([match]);
    });
  });

  describe("case-insensitive substring match", () => {
    it("matches regardless of case", () => {
      const event = makeEvent({ title: "Network Timeout" });
      expect(applySearch([event], "NETWORK")).toEqual([event]);
      expect(applySearch([event], "network")).toEqual([event]);
      expect(applySearch([event], "NeTwOrK")).toEqual([event]);
    });

    it("matches a substring, not just a whole-field match", () => {
      const event = makeEvent({ title: "Failed to fetch /api/widgets" });
      expect(applySearch([event], "fetch")).toEqual([event]);
    });

    it("does not match when the query isn't present in any field", () => {
      const event = makeEvent({ title: "Console Log", message: "hello" });
      expect(applySearch([event], "nonexistent")).toEqual([]);
    });
  });

  describe("scope: title, message, stack, tags", () => {
    it("matches against title", () => {
      const event = makeEvent({ title: "Unique Title Text" });
      expect(applySearch([event], "unique title")).toEqual([event]);
    });

    it("matches against message", () => {
      const event = makeEvent({ message: "unique message text" });
      expect(applySearch([event], "message text")).toEqual([event]);
    });

    it("matches against stack", () => {
      const event = makeEvent({ stack: "at uniqueFunctionName (file.js:1)" });
      expect(applySearch([event], "uniquefunctionname")).toEqual([event]);
    });

    it("does not match an event with no stack against a query only present in others' stacks", () => {
      const withStack = makeEvent({ stack: "at handler (a.js:1)" });
      const withoutStack = makeEvent({ stack: undefined });
      expect(applySearch([withStack, withoutStack], "handler")).toEqual([
        withStack,
      ]);
    });

    it("matches against any individual tag", () => {
      const event = makeEvent({ tags: ["network", "retryable"] });
      expect(applySearch([event], "retryable")).toEqual([event]);
    });

    it("does not match a query split across two different tags", () => {
      const event = makeEvent({ tags: ["net", "work"] });
      expect(applySearch([event], "network")).toEqual([]);
    });

    it("does not match a query split across the boundary of two different fields", () => {
      const event = makeEvent({ title: "...ends with fo", message: "o starts here..." });
      expect(applySearch([event], "fo\no")).toEqual([]);
      expect(applySearch([event], "fo o")).toEqual([]);
    });

    it("does not match against metadata", () => {
      const event = makeEvent({ metadata: { statusCode: 404, note: "unique-metadata-value" } });
      expect(applySearch([event], "unique-metadata-value")).toEqual([]);
    });

    it("does not match against context", () => {
      const event = makeEvent({ context: { userAgent: "unique-context-value" } });
      expect(applySearch([event], "unique-context-value")).toEqual([]);
    });
  });

  describe("ordering and immutability", () => {
    it("preserves the original relative order of matching events", () => {
      const first = makeEvent({ title: "Match One", timestamp: 1 });
      const second = makeEvent({ title: "Unrelated Console Log", timestamp: 2 });
      const third = makeEvent({ title: "Match Two", timestamp: 3 });

      expect(applySearch([first, second, third], "match")).toEqual([
        first,
        third,
      ]);
    });

    it("does not mutate the input events array", () => {
      const events = [makeEvent({ title: "A" }), makeEvent({ title: "B" })];
      const snapshot = events.slice();

      applySearch(events, "a");

      expect(events).toEqual(snapshot);
    });
  });

  describe("idempotence", () => {
    it("produces the same result when applied twice with the same query", () => {
      const events = [
        makeEvent({ title: "Runtime Error" }),
        makeEvent({ title: "Console Log" }),
        makeEvent({ title: "Runtime Warning" }),
      ];

      const once = applySearch(events, "runtime");
      const twice = applySearch(applySearch(events, "runtime"), "runtime");

      expect(twice).toEqual(once);
    });
  });
});
