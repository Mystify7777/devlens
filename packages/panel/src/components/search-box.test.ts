import { describe, it, expect, vi } from "vitest";
import { createSearchBox } from "./search-box";

function getInput(root: HTMLElement): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>("[data-devlens-search-input]");
  if (!el) throw new Error("search input not found");
  return el;
}

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("createSearchBox", () => {
  it("carries a data-devlens-search attribute on its root element", () => {
    const searchBox = createSearchBox(() => {});
    expect(searchBox.element.hasAttribute("data-devlens-search")).toBe(true);
  });

  it("renders a single text input", () => {
    const searchBox = createSearchBox(() => {});
    const input = getInput(searchBox.element);
    expect(input.type).toBe("text");
  });

  it("does not call onQueryChange before any interaction", () => {
    const onQueryChange = vi.fn();
    createSearchBox(onQueryChange);
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("calls onQueryChange with the input's current value on every input event", () => {
    const onQueryChange = vi.fn();
    const searchBox = createSearchBox(onQueryChange);

    typeInto(getInput(searchBox.element), "timeout");

    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith("timeout");
  });

  it("calls onQueryChange again for each subsequent keystroke, with no debounce", () => {
    const onQueryChange = vi.fn();
    const searchBox = createSearchBox(onQueryChange);
    const input = getInput(searchBox.element);

    typeInto(input, "t");
    typeInto(input, "ti");
    typeInto(input, "tim");

    expect(onQueryChange).toHaveBeenCalledTimes(3);
    expect(onQueryChange).toHaveBeenNthCalledWith(1, "t");
    expect(onQueryChange).toHaveBeenNthCalledWith(2, "ti");
    expect(onQueryChange).toHaveBeenNthCalledWith(3, "tim");
  });

  it("calls onQueryChange with an empty string when the input is cleared", () => {
    const onQueryChange = vi.fn();
    const searchBox = createSearchBox(onQueryChange);
    const input = getInput(searchBox.element);

    typeInto(input, "timeout");
    typeInto(input, "");

    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });
});
