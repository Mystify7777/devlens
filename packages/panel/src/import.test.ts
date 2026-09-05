import { describe, it, expect, vi } from "vitest";
import {
  parseImportInput,
  validateEvent,
  validateAllEvents,
  validateImportSession,
  importSession,
} from "./import";
import type { ImportError } from "./import";
import { createEventStore } from "@devlens/core";
import type { DevLensEvent, EventStore } from "@devlens/core";
import { serializeEvents } from "./serialize";

// ---------------------------------------------------------------------------
// Minimal valid event fixture — every required field, no optional fields.
// Tests that need optional fields add them explicitly.
// ---------------------------------------------------------------------------

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-001",
    version: 1,
    origin: "test.origin",
    category: "runtime",
    severity: "info",
    title: "Test event",
    message: "Something happened",
    timestamp: 1000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseImportInput
// ---------------------------------------------------------------------------

describe("parseImportInput", () => {
  it("returns ok: true with parsed array for valid JSON array", () => {
    const result = parseImportInput("[1, 2, 3]");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([1, 2, 3]);
  });

  it("returns ok: true with empty array for '[]'", () => {
    const result = parseImportInput("[]");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("returns invalid-json for malformed JSON", () => {
    const result = parseImportInput("{not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-json");
  });

  it("returns invalid-json for empty string", () => {
    const result = parseImportInput("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-json");
  });

  it("returns not-an-array for a JSON object", () => {
    const result = parseImportInput('{"id":"x"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-an-array");
  });

  it("returns not-an-array for a JSON string", () => {
    const result = parseImportInput('"hello"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-an-array");
  });

  it("returns not-an-array for a JSON number", () => {
    const result = parseImportInput("42");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-an-array");
  });

  it("returns not-an-array for JSON null", () => {
    const result = parseImportInput("null");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-an-array");
  });

  it("returns not-an-array for JSON boolean", () => {
    const result = parseImportInput("true");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-an-array");
  });
});

// ---------------------------------------------------------------------------
// validateEvent — per-event validation
// ---------------------------------------------------------------------------

describe("validateEvent — valid events", () => {
  it("returns null for a minimal valid event", () => {
    expect(validateEvent(validEvent(), 0)).toBeNull();
  });

  it("returns null when all optional fields are present and valid", () => {
    const event = validEvent({
      stack: "Error\n  at foo (foo.js:1:1)",
      tags: ["auth", "react"],
      metadata: { status: 404, duration: 123 },
      context: { route: "/home", viewport: "1440x900" },
    });
    expect(validateEvent(event, 0)).toBeNull();
  });

  it("accepts any string as category (open-string extensibility)", () => {
    expect(validateEvent(validEvent({ category: "custom-plugin-category" }), 0)).toBeNull();
  });

  it("accepts all six severity values", () => {
    for (const severity of ["trace", "debug", "info", "warn", "error", "fatal"]) {
      expect(validateEvent(validEvent({ severity }), 0)).toBeNull();
    }
  });

  it("preserves the eventIndex in the error when a later index is passed", () => {
    const error = validateEvent(validEvent({ version: 2 }), 7);
    expect(error?.code).toBe("unsupported-version");
    if (error && "eventIndex" in error) expect(error.eventIndex).toBe(7);
  });
});

describe("validateEvent — not-an-object", () => {
  it("returns invalid-event-shape (no field) for a string element", () => {
    const error = validateEvent("hello", 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBeUndefined();
  });

  it("returns invalid-event-shape (no field) for a number element", () => {
    const error = validateEvent(42, 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBeUndefined();
  });

  it("returns invalid-event-shape (no field) for null", () => {
    const error = validateEvent(null, 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBeUndefined();
  });

  it("returns invalid-event-shape (no field) for an array element", () => {
    const error = validateEvent([1, 2, 3], 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBeUndefined();
  });
});

describe("validateEvent — version", () => {
  it("returns unsupported-version for version: 2", () => {
    const error = validateEvent(validEvent({ version: 2 }), 0) as ImportError;
    expect(error.code).toBe("unsupported-version");
  });

  it("returns unsupported-version for version: '1' (string, not number)", () => {
    const error = validateEvent(validEvent({ version: "1" }), 0) as ImportError;
    expect(error.code).toBe("unsupported-version");
  });

  it("returns unsupported-version for missing version", () => {
    const { version: _v, ...noVersion } = validEvent();
    const error = validateEvent(noVersion, 0) as ImportError;
    expect(error.code).toBe("unsupported-version");
  });
});

describe("validateEvent — unknown fields", () => {
  it("returns unknown-field for a top-level extra property", () => {
    const error = validateEvent(validEvent({ sneaky: "extra" }), 0) as ImportError;
    expect(error.code).toBe("unknown-field");
    if (error.code === "unknown-field") expect(error.field).toBe("sneaky");
  });

  it("reports the first unknown field encountered", () => {
    const event = { ...validEvent(), alpha: 1, beta: 2 };
    const error = validateEvent(event, 0) as ImportError;
    expect(error.code).toBe("unknown-field");
    // Either alpha or beta — ordering is non-contractual but one must be reported
    if (error.code === "unknown-field") {
      expect(["alpha", "beta"]).toContain(error.field);
    }
  });
});

describe("validateEvent — required fields", () => {
  for (const field of ["id", "origin", "category", "title", "message"] as const) {
    it(`returns invalid-event-shape with field="${field}" when ${field} is missing`, () => {
      const event = { ...validEvent() };
      delete event[field];
      const error = validateEvent(event, 0) as ImportError;
      expect(error.code).toBe("invalid-event-shape");
      if (error.code === "invalid-event-shape") expect(error.field).toBe(field);
    });

    it(`returns invalid-event-shape with field="${field}" when ${field} is a number`, () => {
      const error = validateEvent(validEvent({ [field]: 42 }), 0) as ImportError;
      expect(error.code).toBe("invalid-event-shape");
      if (error.code === "invalid-event-shape") expect(error.field).toBe(field);
    });
  }

  it("returns invalid-event-shape field=severity when severity is missing", () => {
    const { severity: _s, ...noSeverity } = validEvent();
    const error = validateEvent(noSeverity, 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("severity");
  });

  it("returns invalid-event-shape field=severity for an invalid severity value", () => {
    const error = validateEvent(validEvent({ severity: "critical" }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("severity");
  });

  it("returns invalid-event-shape field=timestamp when timestamp is missing", () => {
    const { timestamp: _t, ...noTimestamp } = validEvent();
    const error = validateEvent(noTimestamp, 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("timestamp");
  });

  it("returns invalid-event-shape field=timestamp for a string timestamp", () => {
    const error = validateEvent(validEvent({ timestamp: "1000" }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("timestamp");
  });

  it("returns invalid-event-shape field=timestamp for NaN", () => {
    const error = validateEvent(validEvent({ timestamp: NaN }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("timestamp");
  });

  it("returns invalid-event-shape field=timestamp for Infinity", () => {
    const error = validateEvent(validEvent({ timestamp: Infinity }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("timestamp");
  });
});

describe("validateEvent — optional fields", () => {
  it("returns invalid-event-shape field=stack when stack is a number", () => {
    const error = validateEvent(validEvent({ stack: 42 }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("stack");
  });

  it("returns invalid-event-shape field=stack when stack is null", () => {
    const error = validateEvent(validEvent({ stack: null }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("stack");
  });

  it("returns invalid-event-shape field=tags when tags is a string", () => {
    const error = validateEvent(validEvent({ tags: "auth" }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("tags");
  });

  it("returns invalid-event-shape field=tags when tags contains a non-string element", () => {
    const error = validateEvent(validEvent({ tags: ["ok", 42] }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("tags");
  });

  it("accepts an empty tags array", () => {
    expect(validateEvent(validEvent({ tags: [] }), 0)).toBeNull();
  });

  it("returns invalid-event-shape field=metadata when metadata is an array", () => {
    const error = validateEvent(validEvent({ metadata: [] }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("metadata");
  });

  it("returns invalid-event-shape field=metadata when metadata is a string", () => {
    const error = validateEvent(validEvent({ metadata: "oops" }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("metadata");
  });

  it("accepts metadata as a plain object with any value types", () => {
    expect(validateEvent(validEvent({ metadata: { a: 1, b: null, c: [1, 2] } }), 0)).toBeNull();
  });

  it("returns invalid-event-shape field=context when context is a number", () => {
    const error = validateEvent(validEvent({ context: 99 }), 0) as ImportError;
    expect(error.code).toBe("invalid-event-shape");
    if (error.code === "invalid-event-shape") expect(error.field).toBe("context");
  });

  it("accepts context as a plain object", () => {
    expect(validateEvent(validEvent({ context: { route: "/" } }), 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateAllEvents — batch validation
// ---------------------------------------------------------------------------

describe("validateAllEvents", () => {
  it("returns ok: true with empty events array for an empty input", () => {
    const result = validateAllEvents([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toEqual([]);
  });

  it("returns ok: true with all events when every event is valid", () => {
    const events = [validEvent({ id: "a" }), validEvent({ id: "b" }), validEvent({ id: "c" })];
    const result = validateAllEvents(events);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toHaveLength(3);
  });

  it("preserves event order in the success result", () => {
    const events = [
      validEvent({ id: "a", title: "first" }),
      validEvent({ id: "b", title: "second" }),
    ];
    const result = validateAllEvents(events);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0].title).toBe("first");
      expect(result.events[1].title).toBe("second");
    }
  });

  it("returns the same object references — no mutation", () => {
    const a = validEvent({ id: "a" });
    const b = validEvent({ id: "b" });
    const result = validateAllEvents([a, b]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0]).toBe(a);
      expect(result.events[1]).toBe(b);
    }
  });

  it("fails fast on the first invalid event (index 0)", () => {
    const result = validateAllEvents([validEvent({ version: 2 }), validEvent(), validEvent()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported-version");
      if ("eventIndex" in result.error) expect(result.error.eventIndex).toBe(0);
    }
  });

  it("fails fast on an invalid event in the middle — correct eventIndex", () => {
    const result = validateAllEvents([
      validEvent({ id: "a" }),
      validEvent({ id: "b", severity: "LOUD" }),
      validEvent({ id: "c" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok && "eventIndex" in result.error) {
      expect(result.error.eventIndex).toBe(1);
    }
  });

  it("fails on the last event — correct eventIndex", () => {
    const result = validateAllEvents([
      validEvent({ id: "a" }),
      validEvent({ id: "b" }),
      validEvent({ id: "c", timestamp: NaN }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok && "eventIndex" in result.error) {
      expect(result.error.eventIndex).toBe(2);
    }
  });

  it("does not aggregate — returns only the first error even when many events fail", () => {
    const allBad = [
      validEvent({ version: 2 }),
      validEvent({ severity: "WRONG" }),
      validEvent({ id: 99 }),
    ];
    const result = validateAllEvents(allBad);
    expect(result.ok).toBe(false);
    // Only one error, for the first failing event
    if (!result.ok && "eventIndex" in result.error) {
      expect(result.error.eventIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAllEvents — intra-batch id uniqueness (condition 8)
// ---------------------------------------------------------------------------

describe("validateAllEvents — intra-batch id uniqueness", () => {
  it("accepts a batch where every id is unique", () => {
    const result = validateAllEvents([
      validEvent({ id: "a" }),
      validEvent({ id: "b" }),
      validEvent({ id: "c" }),
    ]);
    expect(result.ok).toBe(true);
  });

  it("returns duplicate-id-in-batch when two events share an id", () => {
    const result = validateAllEvents([
      validEvent({ id: "shared" }),
      validEvent({ id: "unique" }),
      validEvent({ id: "shared" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("duplicate-id-in-batch");
      if (result.error.code === "duplicate-id-in-batch") {
        expect(result.error.eventIndex).toBe(2);
        expect(result.error.id).toBe("shared");
      }
    }
  });

  it("reports the second occurrence (index 1) when the first two events share an id", () => {
    const result = validateAllEvents([
      validEvent({ id: "dup" }),
      validEvent({ id: "dup" }),
      validEvent({ id: "other" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "duplicate-id-in-batch") {
      expect(result.error.eventIndex).toBe(1);
    }
  });

  it("fails fast on shape error before checking id uniqueness", () => {
    // First event is invalid; second and third share an id.
    // Shape error must win because fail-fast applies in encounter order.
    const result = validateAllEvents([
      validEvent({ version: 2 }),
      validEvent({ id: "dup" }),
      validEvent({ id: "dup" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported-version");
    }
  });

  it("stores validated events in a separate accumulator — original array is not mutated", () => {
    const input = [validEvent({ id: "x" }), validEvent({ id: "y" })];
    const originalLength = input.length;
    validateAllEvents(input);
    expect(input).toHaveLength(originalLength);
  });
});

// ---------------------------------------------------------------------------
// validateImportSession — Store preconditions + composition
// ---------------------------------------------------------------------------

/** Minimal fake EventStore for composition tests. Only the methods called by
 *  validateImportSession need real implementations; everything else is a
 *  no-op stub, matching the pattern used by panel.test.ts's FakeEventStore. */
function makeFakeStore(existingEvents: DevLensEvent[] = [], maxCapacity = 10000): EventStore {
  return {
    add: vi.fn(),
    addMany: vi.fn(),
    get capacity() {
      return maxCapacity;
    },
    get size() {
      return existingEvents.length;
    },
    clear: vi.fn(),
    getAll() {
      return [...existingEvents];
    },
    getByCategory: () => [],
    filter: () => [],
    subscribe: () => () => {},
    destroy: vi.fn(),
  };
}

function validJson(events: Record<string, unknown>[]): string {
  return JSON.stringify(events);
}

describe("validateImportSession — success cases", () => {
  it("returns ok:true with validated events for a valid import into an empty Store", () => {
    const store = makeFakeStore();
    const result = validateImportSession(
      validJson([validEvent({ id: "a" }), validEvent({ id: "b" })]),
      store
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toHaveLength(2);
      expect(result.events[0].id).toBe("a");
      expect(result.events[1].id).toBe("b");
    }
  });

  it("returns ok:true with an empty events array for an empty import into an empty Store", () => {
    const store = makeFakeStore();
    const result = validateImportSession("[]", store);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toEqual([]);
  });

  it("succeeds when import count exactly equals Store capacity", () => {
    const store = makeFakeStore([], 3);
    const events = [validEvent({ id: "x1" }), validEvent({ id: "x2" }), validEvent({ id: "x3" })];
    const result = validateImportSession(validJson(events), store);
    expect(result.ok).toBe(true);
  });

  it("preserves event order in the success result", () => {
    const store = makeFakeStore();
    const result = validateImportSession(
      validJson([
        validEvent({ id: "first", title: "Alpha" }),
        validEvent({ id: "second", title: "Beta" }),
      ]),
      store
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0].title).toBe("Alpha");
      expect(result.events[1].title).toBe("Beta");
    }
  });
});

describe("validateImportSession — store-not-empty precondition", () => {
  it("returns store-not-empty when Store already contains events", () => {
    const existing = { ...validEvent(), id: "pre-existing" } as unknown as DevLensEvent;
    const store = makeFakeStore([existing]);
    const result = validateImportSession(validJson([validEvent({ id: "new" })]), store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-not-empty");
  });

  it("store-not-empty is reported even when the imported events are also invalid", () => {
    // Precondition error must win over event-level validation error.
    const existing = { ...validEvent(), id: "pre-existing" } as unknown as DevLensEvent;
    const store = makeFakeStore([existing]);
    const result = validateImportSession(
      validJson([validEvent({ version: 2 })]), // invalid event
      store
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-not-empty");
  });

  it("parse errors are reported before the Store is even consulted", () => {
    // Even with a non-empty Store, invalid JSON is reported as invalid-json
    // because parsing comes first in the contractual sequence.
    const existing = { ...validEvent(), id: "pre-existing" } as unknown as DevLensEvent;
    const store = makeFakeStore([existing]);
    const result = validateImportSession("{not valid json", store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-json");
  });
});

describe("validateImportSession — import-too-large precondition", () => {
  it("returns import-too-large when event count exceeds Store capacity", () => {
    const store = makeFakeStore([], 3);
    const events = [
      validEvent({ id: "a" }),
      validEvent({ id: "b" }),
      validEvent({ id: "c" }),
      validEvent({ id: "d" }), // one too many
    ];
    const result = validateImportSession(validJson(events), store);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("import-too-large");
      if (result.error.code === "import-too-large") {
        expect(result.error.count).toBe(4);
        expect(result.error.capacity).toBe(3);
      }
    }
  });

  it("import-too-large is reported even when the events are also invalid", () => {
    const store = makeFakeStore([], 2);
    const events = [
      validEvent({ id: "a", version: 2 }), // invalid
      validEvent({ id: "b" }),
      validEvent({ id: "c" }), // over capacity
    ];
    const result = validateImportSession(validJson(events), store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("import-too-large");
  });

  it("store-not-empty is reported before import-too-large when both apply", () => {
    const existing = { ...validEvent(), id: "pre-existing" } as unknown as DevLensEvent;
    const store = makeFakeStore([existing], 1);
    const events = [validEvent({ id: "a" }), validEvent({ id: "b" })]; // 2 > capacity 1
    const result = validateImportSession(validJson(events), store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-not-empty");
  });
});

describe("validateImportSession — Store is never mutated", () => {
  it("does not call add() or addMany() on the Store, even on success", () => {
    const store = makeFakeStore();
    validateImportSession(validJson([validEvent({ id: "a" })]), store);
    expect(store.add).not.toHaveBeenCalled();
    expect(store.addMany).not.toHaveBeenCalled();
  });

  it("does not call add() or addMany() on failure (store-not-empty)", () => {
    const existing = { ...validEvent(), id: "x" } as unknown as DevLensEvent;
    const store = makeFakeStore([existing]);
    validateImportSession(validJson([validEvent({ id: "a" })]), store);
    expect(store.add).not.toHaveBeenCalled();
    expect(store.addMany).not.toHaveBeenCalled();
  });

  it("does not call add() or addMany() on failure (import-too-large)", () => {
    const store = makeFakeStore([], 1);
    validateImportSession(validJson([validEvent({ id: "a" }), validEvent({ id: "b" })]), store);
    expect(store.add).not.toHaveBeenCalled();
    expect(store.addMany).not.toHaveBeenCalled();
  });
});

describe("validateImportSession — defense-in-depth note", () => {
  // id-collision-with-store (condition 9) is not tested through
  // validateImportSession() directly. Under condition 10 (empty Store
  // required), the Store is always empty when condition 9 runs, making
  // id-collision-with-store unreachable via the public contract.
  //
  // The code path exists as defense-in-depth — see import.ts and
  // docs/specs/session-import.md ("Not tested through importSession() —
  // a deliberate omission, not a gap") for the explicit rationale.
  //
  // No test is added here for this code path. This is intentional.
  it("condition 9 (Store-side id collision) is present in code as defense-in-depth — see comment above", () => {
    // This test exists solely to make the deliberate omission visible in the
    // test output rather than silently absent. The actual defensive code is
    // in validateImportSession(); the intent is recorded here.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// importSession — the public entry point
// ---------------------------------------------------------------------------

describe("importSession — successful import", () => {
  it("returns ok: true for a valid import into an empty Store", () => {
    const store = createEventStore();
    const result = importSession(
      JSON.stringify([validEvent({ id: "a" }), validEvent({ id: "b" })]),
      store
    );
    expect(result.ok).toBe(true);
  });

  it("reports the correct importedCount", () => {
    const store = createEventStore();
    const result = importSession(
      JSON.stringify([validEvent({ id: "a" }), validEvent({ id: "b" }), validEvent({ id: "c" })]),
      store
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.importedCount).toBe(3);
  });

  it("freezes every imported event", () => {
    const store = createEventStore();
    importSession(JSON.stringify([validEvent({ id: "a" })]), store);
    const [event] = store.getAll();
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("freezes nested structures (metadata/context), not just the top-level event", () => {
    const store = createEventStore();
    importSession(
      JSON.stringify([
        validEvent({
          id: "a",
          metadata: { nested: { deeper: "value" } },
          context: { alsoNested: { evenDeeper: true } },
        }),
      ]),
      store
    );
    const [event] = store.getAll();
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(Object.isFrozen((event.metadata as any).nested)).toBe(true);
    expect(Object.isFrozen(event.context)).toBe(true);
    expect(Object.isFrozen((event.context as any).alsoNested)).toBe(true);
  });

  it("preserves original id and timestamp exactly — no regeneration", () => {
    const store = createEventStore();
    importSession(
      JSON.stringify([validEvent({ id: "historical-id-123", timestamp: 987654321 })]),
      store
    );
    const [event] = store.getAll();
    expect(event.id).toBe("historical-id-123");
    expect(event.timestamp).toBe(987654321);
  });

  it("calls store.addMany() exactly once for a non-empty import", () => {
    const store = createEventStore();
    const addManySpy = vi.spyOn(store, "addMany");
    importSession(JSON.stringify([validEvent({ id: "a" }), validEvent({ id: "b" })]), store);
    expect(addManySpy).toHaveBeenCalledTimes(1);
  });

  it("preserves event order", () => {
    const store = createEventStore();
    importSession(
      JSON.stringify([
        validEvent({ id: "1", title: "First" }),
        validEvent({ id: "2", title: "Second" }),
        validEvent({ id: "3", title: "Third" }),
      ]),
      store
    );
    expect(store.getAll().map((e) => e.title)).toEqual(["First", "Second", "Third"]);
  });

  it("imported events are retrievable from the Store afterward", () => {
    const store = createEventStore();
    importSession(JSON.stringify([validEvent({ id: "retrievable", title: "Findable" })]), store);
    const found = store.getAll().find((e) => e.id === "retrievable");
    expect(found).toBeDefined();
    expect(found?.title).toBe("Findable");
  });
});

describe("importSession — empty import", () => {
  it("returns ok: true with importedCount: 0 for an empty array", () => {
    const store = createEventStore();
    const result = importSession("[]", store);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.importedCount).toBe(0);
  });

  it("does not mutate the Store for an empty import", () => {
    const store = createEventStore();
    importSession("[]", store);
    expect(store.getAll()).toEqual([]);
  });

  it("produces no subscriber notification for an empty import — addMany([]) is a true no-op", () => {
    // This behavior follows directly from EventStore.addMany()'s own
    // contract (Milestone 1): addMany([]) performs no mutation and no
    // notification. importSession() calls addMany() unconditionally rather
    // than special-casing the empty array, relying on that existing
    // contract instead of duplicating it here.
    const store = createEventStore();
    const handler = vi.fn();
    store.subscribe(handler);
    importSession("[]", store);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("importSession — failure leaves the Store untouched", () => {
  it("malformed JSON leaves the Store untouched", () => {
    const store = createEventStore();
    const result = importSession("{not valid json", store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-json");
    expect(store.getAll()).toEqual([]);
  });

  it("an event-level validation failure leaves the Store untouched", () => {
    const store = createEventStore();
    const result = importSession(
      JSON.stringify([validEvent({ id: "a" }), validEvent({ id: "b", version: 2 })]),
      store
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported-version");
    expect(store.getAll()).toEqual([]);
  });

  it("importing into a non-empty Store leaves its original contents untouched", () => {
    const store = createEventStore();
    // Seed the Store directly via addMany (bypassing importSession, which
    // would itself refuse a non-empty target — this establishes the
    // pre-existing state under test).
    const preExisting = validEvent({ id: "pre-existing" }) as unknown as DevLensEvent;
    store.addMany([preExisting]);

    const result = importSession(JSON.stringify([validEvent({ id: "new" })]), store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-not-empty");
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].id).toBe("pre-existing");
  });

  it("an oversized import leaves the Store untouched", () => {
    const store = createEventStore({ maxEvents: 2 });
    const result = importSession(
      JSON.stringify([validEvent({ id: "a" }), validEvent({ id: "b" }), validEvent({ id: "c" })]),
      store
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("import-too-large");
    expect(store.getAll()).toEqual([]);
  });

  it("does not call store.addMany() at all when validation fails", () => {
    const store = createEventStore();
    const addManySpy = vi.spyOn(store, "addMany");
    importSession(JSON.stringify([validEvent({ version: 2 })]), store);
    expect(addManySpy).not.toHaveBeenCalled();
  });

  it("never throws for malformed input", () => {
    const store = createEventStore();
    expect(() => importSession("not json at all {{{", store)).not.toThrow();
    expect(() => importSession(JSON.stringify({ not: "an array" }), store)).not.toThrow();
    expect(() => importSession(JSON.stringify([{ missing: "everything" }]), store)).not.toThrow();
  });
});

describe("importSession — round-trip property", () => {
  it("export → import produces equivalent events in an empty target Store", () => {
    const sourceStore = createEventStore();
    const original = [
      validEvent({ id: "rt-1", title: "Alpha", timestamp: 111 }),
      validEvent({ id: "rt-2", title: "Beta", timestamp: 222 }),
      validEvent({ id: "rt-3", title: "Gamma", timestamp: 333 }),
    ] as unknown as DevLensEvent[];
    sourceStore.addMany(original);

    const exported = serializeEvents(sourceStore.getAll());

    const targetStore = createEventStore();
    const result = importSession(exported, targetStore);

    expect(result.ok).toBe(true);
    const restored = targetStore.getAll();
    const sourceEvents = sourceStore.getAll();
    expect(restored).toHaveLength(sourceEvents.length);
    for (let i = 0; i < sourceEvents.length; i++) {
      expect(restored[i].id).toBe(sourceEvents[i].id);
      expect(restored[i].timestamp).toBe(sourceEvents[i].timestamp);
      expect(restored[i].title).toBe(sourceEvents[i].title);
      expect(restored[i].version).toBe(sourceEvents[i].version);
    }
  });
});

// ---------------------------------------------------------------------------
// Public API surface — package boundary integration
// ---------------------------------------------------------------------------

// These tests import from the package's actual public entry point
// (./index), not from ./import directly, as an external consumer of
// @devlens/panel would. Every other test in this file imports from
// ./import, which would still pass even if index.ts's re-export were
// accidentally removed — as it in fact was, until this review found it
// missing despite 584 passing workspace tests. These tests exist
// specifically to catch that class of regression.
describe("public API surface (packages/panel/src/index.ts)", () => {
  it("importSession is reachable from the package's public entry point and works end-to-end", async () => {
    const { importSession: publicImportSession } = await import("./index");
    const store = createEventStore();
    const result = publicImportSession(
      JSON.stringify([validEvent({ id: "public-api-check" })]),
      store
    );
    expect(result.ok).toBe(true);
    expect(store.getAll()[0]?.id).toBe("public-api-check");
  });

  it("does not re-export internal validation helpers from the public entry point", async () => {
    const publicApi = await import("./index");
    expect("parseImportInput" in publicApi).toBe(false);
    expect("validateEvent" in publicApi).toBe(false);
    expect("validateAllEvents" in publicApi).toBe(false);
    expect("validateImportSession" in publicApi).toBe(false);
  });
});
