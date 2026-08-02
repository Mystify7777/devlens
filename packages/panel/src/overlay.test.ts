import { describe, it, expect } from "vitest";
import { createOverlay } from "./overlay";
import { PANEL_STYLES } from "./styles";

function getHost(): Element | null {
  return document.querySelector("[data-devlens-panel-host]");
}

describe("createOverlay", () => {
  it("does not attach the host to the document until mount() is called", () => {
    createOverlay();
    expect(getHost()).toBeNull();
  });

  it("attaches the host to document.body on mount()", () => {
    const overlay = createOverlay();
    overlay.mount();

    expect(getHost()).not.toBeNull();

    overlay.unmount();
  });

  it("removes the host from the document on unmount()", () => {
    const overlay = createOverlay();
    overlay.mount();
    overlay.unmount();

    expect(getHost()).toBeNull();
  });

  it("attaches an open Shadow DOM, exposed as shadowRoot", () => {
    const overlay = createOverlay();
    expect(overlay.shadowRoot).toBeInstanceOf(ShadowRoot);
  });

  it("does not expose the host element itself, only the shadowRoot", () => {
    const overlay = createOverlay();
    expect((overlay as unknown as Record<string, unknown>).host).toBeUndefined();
  });

  it("injects a <style> element containing PANEL_STYLES into the Shadow DOM", () => {
    const overlay = createOverlay();
    const style = overlay.shadowRoot.querySelector("style");

    expect(style).not.toBeNull();
    expect(style?.textContent).toBe(PANEL_STYLES);
  });

  it("mount() is idempotent-safe to call once without creating duplicate hosts", () => {
    const overlay = createOverlay();
    overlay.mount();

    expect(document.querySelectorAll("[data-devlens-panel-host]")).toHaveLength(1);

    overlay.unmount();
  });

  it("each createOverlay() call produces an independent host and shadowRoot", () => {
    const first = createOverlay();
    const second = createOverlay();

    expect(first.shadowRoot).not.toBe(second.shadowRoot);
  });
});
