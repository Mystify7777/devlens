import { describe, it, expect } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { applyFilters, createEmptyFilterState, type FilterState } from "./filters";

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

describe("createEmptyFilterState", () => {
  it("returns a filter state with no constraints on either dimension", () => {
    expect(createEmptyFilterState()).toEqual({ categories: [], severities: [] });
  });
});

describe("applyFilters", () => {
  it("returns every event, unmodified, when no filters are active", () => {
    const events = [
      makeEvent({ category: "runtime", severity: "error" }),
      makeEvent({ category: "console", severity: "warn" }),
    ];

    expect(applyFilters(events, createEmptyFilterState())).toEqual(events);
  });

  it("returns a new array, not the same reference, even with no filters active", () => {
    const events = [makeEvent()];
    const result = applyFilters(events, createEmptyFilterState());

    expect(result).not.toBe(events);
    expect(result).toEqual(events);
  });

  it("does not mutate the input events array", () => {
    const events = [makeEvent({ category: "runtime" }), makeEvent({ category: "console" })];
    const snapshot = events.slice();

    applyFilters(events, { categories: ["runtime"], severities: [] });

    expect(events).toEqual(snapshot);
  });

  it("does not mutate the filters argument", () => {
    const filters: FilterState = { categories: ["runtime"], severities: ["error"] };
    const snapshot = structuredClone(filters);

    applyFilters([makeEvent()], filters);

    expect(filters).toEqual(snapshot);
  });

  it("filters to a single category when only categories is set", () => {
    const runtimeEvent = makeEvent({ category: "runtime" });
    const consoleEvent = makeEvent({ category: "console" });

    const result = applyFilters([runtimeEvent, consoleEvent], {
      categories: ["runtime"],
      severities: [],
    });

    expect(result).toEqual([runtimeEvent]);
  });

  it("filters to a single severity when only severities is set", () => {
    const errorEvent = makeEvent({ severity: "error" });
    const warnEvent = makeEvent({ severity: "warn" });

    const result = applyFilters([errorEvent, warnEvent], {
      categories: [],
      severities: ["error"],
    });

    expect(result).toEqual([errorEvent]);
  });

  it("combines multiple values within a dimension with OR", () => {
    const errorEvent = makeEvent({ severity: "error" });
    const warnEvent = makeEvent({ severity: "warn" });
    const infoEvent = makeEvent({ severity: "info" });

    const result = applyFilters([errorEvent, warnEvent, infoEvent], {
      categories: [],
      severities: ["error", "warn"],
    });

    expect(result).toEqual([errorEvent, warnEvent]);
  });

  it("combines categories and severities with AND", () => {
    const matches = makeEvent({ category: "network", severity: "error" });
    const wrongCategory = makeEvent({ category: "console", severity: "error" });
    const wrongSeverity = makeEvent({ category: "network", severity: "info" });
    const wrongBoth = makeEvent({ category: "console", severity: "info" });

    const result = applyFilters(
      [matches, wrongCategory, wrongSeverity, wrongBoth],
      { categories: ["network"], severities: ["error"] }
    );

    expect(result).toEqual([matches]);
  });

  it("returns an empty array when no event satisfies both dimensions", () => {
    const events = [
      makeEvent({ category: "console", severity: "error" }),
      makeEvent({ category: "runtime", severity: "warn" }),
    ];

    const result = applyFilters(events, {
      categories: ["network"],
      severities: ["fatal"],
    });

    expect(result).toEqual([]);
  });

  it("preserves the original relative order of matching events", () => {
    const first = makeEvent({ category: "runtime", timestamp: 1 });
    const second = makeEvent({ category: "console", timestamp: 2 });
    const third = makeEvent({ category: "runtime", timestamp: 3 });

    const result = applyFilters([first, second, third], {
      categories: ["runtime"],
      severities: [],
    });

    expect(result).toEqual([first, third]);
  });

  it("treats an event's category/severity as an open string union safely (plugin categories)", () => {
    const pluginEvent = makeEvent({ category: "some-future-plugin-category" });
    const runtimeEvent = makeEvent({ category: "runtime" });

    const result = applyFilters([pluginEvent, runtimeEvent], {
      categories: ["some-future-plugin-category"],
      severities: [],
    });

    expect(result).toEqual([pluginEvent]);
  });

  describe("order-independence (commutativity)", () => {
    it("produces the same result whether both dimensions are applied at once or sequentially in either order", () => {
      const events = [
        makeEvent({ category: "network", severity: "error" }),
        makeEvent({ category: "network", severity: "warn" }),
        makeEvent({ category: "console", severity: "error" }),
        makeEvent({ category: "console", severity: "warn" }),
        makeEvent({ category: "runtime", severity: "fatal" }),
      ];

      const filters: FilterState = {
        categories: ["network", "console"],
        severities: ["error"],
      };

      const atOnce = applyFilters(events, filters);

      const categoryThenSeverity = applyFilters(
        applyFilters(events, { categories: filters.categories, severities: [] }),
        { categories: [], severities: filters.severities }
      );

      const severityThenCategory = applyFilters(
        applyFilters(events, { categories: [], severities: filters.severities }),
        { categories: filters.categories, severities: [] }
      );

      expect(categoryThenSeverity).toEqual(atOnce);
      expect(severityThenCategory).toEqual(atOnce);
    });
  });
});
