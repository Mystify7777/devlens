// packages/panel/src/components/inspector.test.ts
import { describe, it, expect, beforeEach } from "vitest";
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
    title: "Something Failed",
    message: "a failure occurred",
    timestamp: 0,
    ...overrides,
  } satisfies DevLensEvent;
}

describe("createInspector", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("carries a data-devlens-inspector attribute on its root element", () => {
    const inspector = createInspector();
    expect(inspector.element.hasAttribute("data-devlens-inspector")).toBe(true);
  });

  it("renders the empty state immediately on creation", () => {
    const inspector = createInspector();
    expect(
      inspector.element.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();
  });

  it("renders event detail when given an event", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ title: "Selected Event" }));

    expect(
      inspector.element.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Selected Event");
  });

  it("clears the empty state once an event is rendered", () => {
    const inspector = createInspector();
    inspector.render(makeEvent());

    expect(
      inspector.element.querySelector("[data-devlens-inspector-empty]")
    ).toBeNull();
  });

  it("returns to the empty state when rendered with null", () => {
    const inspector = createInspector();
    inspector.render(makeEvent());
    inspector.render(null);

    expect(
      inspector.element.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();
    expect(
      inspector.element.querySelector("[data-devlens-inspector-title]")
    ).toBeNull();
  });

  it("renders severity, title, and message for a minimal event", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({ severity: "warn", title: "A Title", message: "A message" })
    );

    expect(
      inspector.element.querySelector("[data-devlens-inspector-severity]")
        ?.textContent
    ).toBe("WARN");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("A Title");
    expect(
      inspector.element.querySelector("[data-devlens-inspector-message]")
        ?.textContent
    ).toBe("A message");
  });

  it("omits the stack section entirely when the event has no stack", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ stack: undefined }));

    expect(
      inspector.element.querySelector("[data-devlens-inspector-stack]")
    ).toBeNull();
  });

  it("renders the stack section when the event has one", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ stack: "Error: boom\n at line 1" }));

    expect(
      inspector.element.querySelector("[data-devlens-inspector-stack]")
        ?.textContent
    ).toBe("Error: boom\n at line 1");
  });

  it("omits the metadata section when metadata is absent", () => {
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

  it("renders each metadata entry generically, with no hardcoded field names", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({ metadata: { statusCode: 404, url: "/api/widgets" } })
    );

    const keys = Array.from(
      inspector.element.querySelectorAll(
        "[data-devlens-inspector-metadata-key]"
      )
    ).map((el) => el.textContent);
    const values = Array.from(
      inspector.element.querySelectorAll(
        "[data-devlens-inspector-metadata-value]"
      )
    ).map((el) => el.textContent);

    expect(keys).toEqual(["statusCode", "url"]);
    expect(values).toEqual(["404", "/api/widgets"]);
  });

  it("stringifies non-string metadata values without throwing", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({ metadata: { nested: { retries: 3 }, ok: false } })
    );

    const values = Array.from(
      inspector.element.querySelectorAll(
        "[data-devlens-inspector-metadata-value]"
      )
    ).map((el) => el.textContent);

    expect(values).toEqual(['{"retries":3}', "false"]);
  });

  it("omits the context section when context is absent", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ context: undefined }));

    expect(
      inspector.element.querySelector("[data-devlens-inspector-context]")
    ).toBeNull();
  });

  it("renders context entries the same generic way as metadata", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ context: { userAgent: "test-agent" } }));

    expect(
      inspector.element.querySelector(
        "[data-devlens-inspector-context-key]"
      )?.textContent
    ).toBe("userAgent");
    expect(
      inspector.element.querySelector(
        "[data-devlens-inspector-context-value]"
      )?.textContent
    ).toBe("test-agent");
  });

  it("omits the tags section when tags is absent", () => {
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

  it("renders one tag element per tag, in order", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ tags: ["network", "retryable"] }));

    const tags = Array.from(
      inspector.element.querySelectorAll("[data-devlens-inspector-tag]")
    ).map((el) => el.textContent);

    expect(tags).toEqual(["network", "retryable"]);
  });

  it("replaces prior detail rather than appending when rendering a new event", () => {
    const inspector = createInspector();
    inspector.render(makeEvent({ title: "First" }));
    inspector.render(makeEvent({ title: "Second" }));

    const titles = inspector.element.querySelectorAll(
      "[data-devlens-inspector-title]"
    );
    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe("Second");
  });

  it("never uses innerHTML — a title containing markup is not parsed as an element", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({ title: "<img src=x onerror=alert(1)>" })
    );

    const titleEl = inspector.element.querySelector(
      "[data-devlens-inspector-title]"
    );
    expect(titleEl?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(titleEl?.querySelector("img")).toBeNull();
  });

  it("never uses innerHTML for metadata values either", () => {
    const inspector = createInspector();
    inspector.render(
      makeEvent({ metadata: { note: "<script>alert(1)</script>" } })
    );

    const valueEl = inspector.element.querySelector(
      "[data-devlens-inspector-metadata-value]"
    );
    expect(valueEl?.textContent).toBe("<script>alert(1)</script>");
    expect(valueEl?.querySelector("script")).toBeNull();
  });
});
