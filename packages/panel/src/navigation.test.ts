import { describe, it, expect } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { computeNavigationTarget } from "./navigation";

let idCounter = 0;

function makeEvent(overrides: Partial<DevLensEvent> = {}): DevLensEvent {
  idCounter += 1;
  return {
    id: `event-${idCounter}`,
    version: 1,
    origin: "console.log",
    category: "console",
    severity: "info",
    title: `Event ${idCounter}`,
    message: "message",
    timestamp: idCounter,
    ...overrides,
  } satisfies DevLensEvent;
}

describe("computeNavigationTarget", () => {
  describe("empty list", () => {
    it("returns null for every direction when there are no visible events", () => {
      expect(computeNavigationTarget([], null, "next")).toBeNull();
      expect(computeNavigationTarget([], null, "previous")).toBeNull();
      expect(computeNavigationTarget([], null, "first")).toBeNull();
      expect(computeNavigationTarget([], null, "last")).toBeNull();
    });
  });

  describe("no current selection", () => {
    it("selects the first visible row on 'next' with no current selection", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, null, "next")).toBe(events[0]);
    });

    it("also selects the first visible row on 'previous' with no current selection — not the last", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, null, "previous")).toBe(
        events[0]
      );
    });

    it("falls back to the first row when the current selection isn't in the visible list at all", () => {
      const events = [makeEvent(), makeEvent()];
      expect(
        computeNavigationTarget(events, "some-scrolled-off-id", "next")
      ).toBe(events[0]);
      expect(
        computeNavigationTarget(events, "some-scrolled-off-id", "previous")
      ).toBe(events[0]);
    });
  });

  describe("linear traversal", () => {
    it("moves to the next row in rendered order", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, events[0].id, "next")).toBe(
        events[1]
      );
    });

    it("moves to the previous row in rendered order", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, events[2].id, "previous")).toBe(
        events[1]
      );
    });

    it("moves one row at a time, not to an arbitrary further row", () => {
      const events = [makeEvent(), makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, events[0].id, "next")).toBe(
        events[1]
      );
      expect(computeNavigationTarget(events, events[1].id, "next")).toBe(
        events[2]
      );
    });
  });

  describe("stop at ends — no wraparound", () => {
    it("stays on the last row when 'next' is called from the last row", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(
        computeNavigationTarget(events, events[2].id, "next")
      ).toBe(events[2]);
    });

    it("stays on the first row when 'previous' is called from the first row", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(
        computeNavigationTarget(events, events[0].id, "previous")
      ).toBe(events[0]);
    });

    it("stays put on a single-row list regardless of direction", () => {
      const events = [makeEvent()];
      expect(computeNavigationTarget(events, events[0].id, "next")).toBe(
        events[0]
      );
      expect(
        computeNavigationTarget(events, events[0].id, "previous")
      ).toBe(events[0]);
    });
  });

  describe("Home/End (first/last)", () => {
    it("'first' jumps to the first visible row regardless of current selection", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, events[2].id, "first")).toBe(
        events[0]
      );
    });

    it("'last' jumps to the last visible row regardless of current selection", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, events[0].id, "last")).toBe(
        events[2]
      );
    });

    it("'first'/'last' work even with no current selection", () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      expect(computeNavigationTarget(events, null, "first")).toBe(events[0]);
      expect(computeNavigationTarget(events, null, "last")).toBe(events[2]);
    });
  });
});
