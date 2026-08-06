import { describe, it, expect, beforeEach } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { serializeEvents } from "./serialize";

let idCounter = 0;

beforeEach(() => {
  idCounter = 0;
});

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

describe("serializeEvents", () => {
  it("serializes an empty array to a JSON empty array string", () => {
    expect(serializeEvents([])).toBe("[]");
  });

  it("produces exactly JSON.stringify(events, null, 2) — nothing more", () => {
    const events = [makeEvent(), makeEvent()];
    expect(serializeEvents(events)).toBe(JSON.stringify(events, null, 2));
  });

  it("round-trips: the output parses back to a structurally equal array", () => {
    const events = [makeEvent({ severity: "warn" }), makeEvent({ category: "runtime" })];
    const parsed = JSON.parse(serializeEvents(events));
    expect(parsed).toEqual(events);
  });

  it("includes all required DevLensEvent fields in the output", () => {
    const event = makeEvent({ stack: "Error\n  at foo (bar.js:1)", tags: ["tag-a"] });
    const parsed: DevLensEvent[] = JSON.parse(serializeEvents([event]));
    expect(parsed[0]).toMatchObject({
      id: event.id,
      version: event.version,
      origin: event.origin,
      category: event.category,
      severity: event.severity,
      title: event.title,
      message: event.message,
      timestamp: event.timestamp,
      stack: event.stack,
      tags: event.tags,
    });
  });

  it("preserves optional fields when present (stack, metadata, context, tags)", () => {
    const event = makeEvent({
      stack: "Error\n  at foo",
      metadata: { code: 42 },
      context: { url: "https://example.com" },
      tags: ["ui", "critical"],
    });
    const parsed: DevLensEvent[] = JSON.parse(serializeEvents([event]));
    expect(parsed[0].stack).toBe("Error\n  at foo");
    expect(parsed[0].metadata).toEqual({ code: 42 });
    expect(parsed[0].context).toEqual({ url: "https://example.com" });
    expect(parsed[0].tags).toEqual(["ui", "critical"]);
  });

  it("omits optional fields that are absent — no spurious null or undefined keys", () => {
    const event = makeEvent(); // no stack/metadata/context/tags
    const parsed: Record<string, unknown>[] = JSON.parse(serializeEvents([event]));
    expect("stack" in parsed[0]).toBe(false);
    expect("metadata" in parsed[0]).toBe(false);
    expect("context" in parsed[0]).toBe(false);
    expect("tags" in parsed[0]).toBe(false);
  });

  it("serializes a single event", () => {
    const event = makeEvent();
    const parsed: DevLensEvent[] = JSON.parse(serializeEvents([event]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(event.id);
  });

  it("preserves array order", () => {
    const events = [
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
      makeEvent({ title: "Third" }),
    ];
    const parsed: DevLensEvent[] = JSON.parse(serializeEvents(events));
    expect(parsed.map((e) => e.title)).toEqual(["First", "Second", "Third"]);
  });

  it("is side-effect-free — the input array is not mutated", () => {
    const events = [makeEvent()];
    const original = { ...events[0] };
    serializeEvents(events);
    expect(events[0]).toEqual(original);
    expect(events).toHaveLength(1);
  });

  it("handles frozen events (as produced by the EventBus) without throwing", () => {
    const event = Object.freeze(makeEvent({ metadata: { key: "value" } }));
    expect(() => serializeEvents([event])).not.toThrow();
    const parsed: DevLensEvent[] = JSON.parse(serializeEvents([event]));
    expect(parsed[0].id).toBe(event.id);
  });
});
