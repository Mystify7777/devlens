import { describe, it, expect, vi } from "vitest";
import { createTrigger } from "./trigger";

describe("createTrigger", () => {
  it("renders a real <button> element carrying a data-devlens-trigger attribute", () => {
    const trigger = createTrigger(() => {});

    expect(trigger.element.tagName).toBe("BUTTON");
    expect(trigger.element.getAttribute("type")).toBe("button");
    expect(trigger.element.hasAttribute("data-devlens-trigger")).toBe(true);
  });

  it("has a static, non-empty accessible name via its text content", () => {
    const trigger = createTrigger(() => {});
    expect(trigger.element.textContent?.trim()).toBeTruthy();
  });

  it("starts with aria-expanded=true", () => {
    const trigger = createTrigger(() => {});
    expect(trigger.element.getAttribute("aria-expanded")).toBe("true");
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    const trigger = createTrigger(onToggle);

    trigger.element.click();

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("is a native <button>, so it preserves built-in Enter/Space keyboard activation", () => {
    // jsdom does not simulate a real browser's default keyboard
    // handling (pressing Enter/Space on a focused <button> does not
    // synthesize a click event here the way it would in an actual
    // browser). This test honestly verifies the precondition that
    // makes that native behavior apply — a real, non-disabled
    // <button type="button">, not a <div> with a click handler — as
    // established web-platform behavior, so it does not need
    // browser-specific reproduction here.
    const trigger = createTrigger(() => {});

    expect(trigger.element.tagName).toBe("BUTTON");
    expect((trigger.element as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.element.tabIndex).not.toBe(-1);
  });

  it("setExpanded(false) updates aria-expanded accordingly", () => {
    const trigger = createTrigger(() => {});

    trigger.setExpanded(false);
    expect(trigger.element.getAttribute("aria-expanded")).toBe("false");

    trigger.setExpanded(true);
    expect(trigger.element.getAttribute("aria-expanded")).toBe("true");
  });

  it("each createTrigger() call produces an independent element", () => {
    const first = createTrigger(() => {});
    const second = createTrigger(() => {});

    expect(first.element).not.toBe(second.element);
  });
});
