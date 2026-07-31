import { describe, it, expect } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { createInspector } from "./inspector";

let idCounter = 0;

function makeEvent(overrides: Partial<DevLensEvent> = {}): DevLensEvent {
  idCounter += 1;
  return {
    id: `event-${idCounter}`,
    version: 1,
    origin: "console.error",
    category: "console",
    severity: "error",
    title: "Console Error",
    message: "something went wrong",
    timestamp: 0,
    ...overrides,
  } satisfies DevLensEvent;
}

describe("createInspector", () => {
  it("renders the empty state initially", () => {
    const inspector = createInspector();

    expect(
      inspector.element.getAttribute("data-devlens-inspector-state")
    ).toBe("empty");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();
  });

  it("returns to the empty state when render(null) is called after an event", () => {
    const inspector = createInspector();

    inspector.render(makeEvent());
    inspector.render(null);

    expect(
      inspector.element.getAttribute("data-devlens-inspector-state")
    ).toBe("empty");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-header]")
    ).toBeNull();
  });

  it("renders severity, title, and message for a selected event", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({
        severity: "warn",
        title: "Console Warning",
        message: "something worth a second look",
      })
    );

    expect(
      inspector.element.getAttribute("data-devlens-inspector-state")
    ).toBe("populated");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-severity]")
        ?.textContent
    ).toBe("WARN");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Console Warning");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-message]")
        ?.textContent
    ).toBe("something worth a second look");
  });

  describe("stack", () => {
    it("renders a stack section when the event has a stack", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ stack: "Error: boom\n  at foo (a.js:1)" }));

      const stackSection = inspector.element.querySelector(
        "[data-devlens-inspector-stack]"
      );
      expect(stackSection).not.toBeNull();
      expect(stackSection?.querySelector("pre")?.textContent).toBe(
        "Error: boom\n  at foo (a.js:1)"
      );
    });

    it("omits the stack section when the event has no stack", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ stack: undefined }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-stack]")
      ).toBeNull();
    });
  });

  describe("metadata", () => {
    it("renders a metadata section with key/value pairs", () => {
      const inspector = createInspector();
      inspector.render(
        makeEvent({ metadata: { args: ["a", "b"], count: 2 } })
      );

      const section = inspector.element.querySelector(
        "[data-devlens-inspector-metadata]"
      );
      expect(section).not.toBeNull();

      const terms = Array.from(section?.querySelectorAll("dt") ?? []).map(
        (el) => el.textContent
      );
      expect(terms).toEqual(["args", "count"]);
    });

    it("omits the metadata section when metadata is undefined", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ metadata: undefined }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-metadata]")
      ).toBeNull();
    });

    it("omits the metadata section when metadata is an empty object", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ metadata: {} }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-metadata]")
      ).toBeNull();
    });

    it("renders plain string values as-is, and non-strings via JSON.stringify", () => {
      const inspector = createInspector();
      inspector.render(
        makeEvent({ metadata: { note: "a plain string", count: 3 } })
      );

      const values = Array.from(
        inspector.element.querySelectorAll(
          "[data-devlens-inspector-metadata] dd"
        )
      ).map((el) => el.textContent);
      expect(values).toEqual(["a plain string", "3"]);
    });
  });

  describe("context", () => {
    it("renders a context section with key/value pairs", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ context: { userAgent: "test-agent" } }));

      const section = inspector.element.querySelector(
        "[data-devlens-inspector-context]"
      );
      expect(section).not.toBeNull();
      expect(section?.querySelector("dd")?.textContent).toBe("test-agent");
    });

    it("omits the context section when context is undefined", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ context: undefined }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-context]")
      ).toBeNull();
    });

    it("omits the context section when context is an empty object", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ context: {} }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-context]")
      ).toBeNull();
    });
  });

  describe("tags", () => {
    it("renders a tags section as a list", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ tags: ["flaky", "regression"] }));

      const section = inspector.element.querySelector(
        "[data-devlens-inspector-tags]"
      );
      expect(section).not.toBeNull();

      const items = Array.from(section?.querySelectorAll("li") ?? []).map(
        (el) => el.textContent
      );
      expect(items).toEqual(["flaky", "regression"]);
    });

    it("omits the tags section when tags is undefined", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ tags: undefined }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-tags]")
      ).toBeNull();
    });

    it("omits the tags section when tags is an empty array", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ tags: [] }));

      expect(
        inspector.element.querySelector("[data-devlens-inspector-tags]")
      ).toBeNull();
    });
  });

  describe("security", () => {
    it("renders stack content as text, never parsed as markup", () => {
      const inspector = createInspector();
      inspector.render(
        makeEvent({ stack: "<script>alert('xss')</script>" })
      );

      const pre = inspector.element.querySelector(
        "[data-devlens-inspector-stack] pre"
      );
      expect(pre?.textContent).toBe("<script>alert('xss')</script>");
      expect(pre?.querySelector("script")).toBeNull();
    });

    it("renders metadata values as text, never parsed as markup", () => {
      const inspector = createInspector();
      inspector.render(
        makeEvent({
          metadata: { payload: "<img src=x onerror=alert(1)>" },
        })
      );

      const dd = inspector.element.querySelector(
        "[data-devlens-inspector-metadata] dd"
      );
      expect(dd?.textContent).toBe("<img src=x onerror=alert(1)>");
      expect(dd?.querySelector("img")).toBeNull();
    });

    it("renders tag content as text, never parsed as markup", () => {
      const inspector = createInspector();
      inspector.render(makeEvent({ tags: ["<b>bold</b>"] }));

      const li = inspector.element.querySelector(
        "[data-devlens-inspector-tags] li"
      );
      expect(li?.textContent).toBe("<b>bold</b>");
      expect(li?.querySelector("b")).toBeNull();
    });
  });

  it("re-renders in place when called with a new event, replacing prior content", () => {
    const inspector = createInspector();

    inspector.render(makeEvent({ title: "First" }));
    inspector.render(makeEvent({ title: "Second" }));

    const titles = inspector.element.querySelectorAll(
      "[data-devlens-inspector-title]"
    );
    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe("Second");
  });
});
