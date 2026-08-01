import { describe, it, expect, vi } from "vitest";
import { createToolbar } from "./toolbar";

function checkbox(
  root: HTMLElement,
  group: string,
  value: string
): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    `[data-devlens-toolbar-${group}-checkbox][data-value="${value}"]`
  );
  if (!el) throw new Error(`checkbox not found: ${group}/${value}`);
  return el;
}

function toggle(el: HTMLInputElement) {
  el.checked = !el.checked;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("createToolbar", () => {
  it("carries a data-devlens-toolbar attribute on its root element", () => {
    const toolbar = createToolbar(() => {});
    expect(toolbar.element.hasAttribute("data-devlens-toolbar")).toBe(true);
  });

  it("renders a severity checkbox group and a category checkbox group", () => {
    const toolbar = createToolbar(() => {});

    expect(
      toolbar.element.querySelector("[data-devlens-toolbar-severity]")
    ).not.toBeNull();
    expect(
      toolbar.element.querySelector("[data-devlens-toolbar-category]")
    ).not.toBeNull();
  });

  it("renders one checkbox per severity value", () => {
    const toolbar = createToolbar(() => {});

    const checkboxes = toolbar.element.querySelectorAll(
      "[data-devlens-toolbar-severity-checkbox]"
    );
    expect(checkboxes).toHaveLength(6);
  });

  it("renders one checkbox per builtin category value", () => {
    const toolbar = createToolbar(() => {});

    const checkboxes = toolbar.element.querySelectorAll(
      "[data-devlens-toolbar-category-checkbox]"
    );
    expect(checkboxes).toHaveLength(6);
  });

  it("calls onFiltersChange with no active constraints before any interaction", () => {
    const onFiltersChange = vi.fn();
    createToolbar(onFiltersChange);

    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it("emits an updated FilterState immediately when a severity checkbox is checked", () => {
    const onFiltersChange = vi.fn();
    const toolbar = createToolbar(onFiltersChange);

    toggle(checkbox(toolbar.element, "severity", "error"));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({
      categories: [],
      severities: ["error"],
    });
  });

  it("emits an updated FilterState immediately when a category checkbox is checked", () => {
    const onFiltersChange = vi.fn();
    const toolbar = createToolbar(onFiltersChange);

    toggle(checkbox(toolbar.element, "category", "runtime"));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({
      categories: ["runtime"],
      severities: [],
    });
  });

  it("accumulates multiple checked values within the same dimension (OR-within)", () => {
    const onFiltersChange = vi.fn();
    const toolbar = createToolbar(onFiltersChange);

    toggle(checkbox(toolbar.element, "severity", "error"));
    toggle(checkbox(toolbar.element, "severity", "warn"));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      severities: ["error", "warn"],
    });
  });

  it("combines both dimensions in the same FilterState once both have selections", () => {
    const onFiltersChange = vi.fn();
    const toolbar = createToolbar(onFiltersChange);

    toggle(checkbox(toolbar.element, "severity", "error"));
    toggle(checkbox(toolbar.element, "category", "network"));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: ["network"],
      severities: ["error"],
    });
  });

  it("removes a value from the emitted FilterState when its checkbox is unchecked", () => {
    const onFiltersChange = vi.fn();
    const toolbar = createToolbar(onFiltersChange);

    const errorCheckbox = checkbox(toolbar.element, "severity", "error");
    toggle(errorCheckbox); // check
    toggle(errorCheckbox); // uncheck

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      severities: [],
    });
  });

});
