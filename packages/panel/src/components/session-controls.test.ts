import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSessionControls,
  sessionExportFilename,
  type SessionControlsHandlers,
} from "./session-controls";

function getPauseButton(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(
    "[data-devlens-session-pause-button]"
  );
  if (!el) throw new Error("pause button not found");
  return el;
}

function getClearButton(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(
    "[data-devlens-session-clear-button]"
  );
  if (!el) throw new Error("clear button not found");
  return el;
}

function getExportButton(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(
    "[data-devlens-session-export-button]"
  );
  if (!el) throw new Error("export button not found");
  return el;
}

function makeHandlers(
  overrides: Partial<SessionControlsHandlers> = {}
): SessionControlsHandlers {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onClear: vi.fn(),
    onExport: vi.fn(() => "[]"),
    isPaused: vi.fn(() => false),
    ...overrides,
  };
}

describe("createSessionControls", () => {
  it("carries a data-devlens-session-controls attribute on its root element", () => {
    const controls = createSessionControls(makeHandlers());
    expect(
      controls.element.hasAttribute("data-devlens-session-controls")
    ).toBe(true);
  });

  it("renders exactly three buttons: pause/resume, clear, export", () => {
    const controls = createSessionControls(makeHandlers());
    expect(controls.element.querySelectorAll("button")).toHaveLength(3);
  });

  describe("pause/resume toggle", () => {
    it('labels itself "Pause" when isPaused() is false at creation', () => {
      const controls = createSessionControls(
        makeHandlers({ isPaused: () => false })
      );
      expect(getPauseButton(controls.element).textContent).toBe("Pause");
    });

    it('labels itself "Resume" when isPaused() is true at creation', () => {
      const controls = createSessionControls(
        makeHandlers({ isPaused: () => true })
      );
      expect(getPauseButton(controls.element).textContent).toBe("Resume");
    });

    it("calls onPause() (not onResume()) when clicked while not paused", () => {
      const handlers = makeHandlers({ isPaused: () => false });
      const controls = createSessionControls(handlers);

      getPauseButton(controls.element).click();

      expect(handlers.onPause).toHaveBeenCalledTimes(1);
      expect(handlers.onResume).not.toHaveBeenCalled();
    });

    it("calls onResume() (not onPause()) when clicked while paused", () => {
      const handlers = makeHandlers({ isPaused: () => true });
      const controls = createSessionControls(handlers);

      getPauseButton(controls.element).click();

      expect(handlers.onResume).toHaveBeenCalledTimes(1);
      expect(handlers.onPause).not.toHaveBeenCalled();
    });

    it("re-reads isPaused() after the click to relabel itself — it does not keep its own copy of the state", () => {
      let paused = false;
      const handlers = makeHandlers({
        isPaused: () => paused,
        onPause: vi.fn(() => {
          paused = true;
        }),
      });
      const controls = createSessionControls(handlers);
      const button = getPauseButton(controls.element);

      expect(button.textContent).toBe("Pause");
      button.click();
      expect(button.textContent).toBe("Resume");
    });

    it("exposes the current state as a data attribute for testability", () => {
      let paused = false;
      const handlers = makeHandlers({
        isPaused: () => paused,
        onPause: vi.fn(() => {
          paused = true;
        }),
      });
      const controls = createSessionControls(handlers);
      const button = getPauseButton(controls.element);

      expect(button.getAttribute("data-devlens-session-state")).toBe(
        "running"
      );
      button.click();
      expect(button.getAttribute("data-devlens-session-state")).toBe(
        "paused"
      );
    });
  });

  describe("clear button", () => {
    it("calls onClear() when clicked", () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      getClearButton(controls.element).click();

      expect(handlers.onClear).toHaveBeenCalledTimes(1);
    });

    it("does not call onClear() before any interaction", () => {
      const handlers = makeHandlers();
      createSessionControls(handlers);
      expect(handlers.onClear).not.toHaveBeenCalled();
    });
  });

  describe("export button", () => {
    // jsdom does not implement URL.createObjectURL/revokeObjectURL at
    // all, and its Blob implementation lacks .text() — gaps in the
    // same spirit as the documented CSS.escape() quirk. Stubbed here
    // rather than relying on jsdom's incomplete File API; what's
    // actually under test is that session-controls.ts calls these
    // browser APIs correctly, not that jsdom's Blob round-trips data.
    let capturedBlobParts: BlobPart[] | undefined;
    let capturedBlobOptions: BlobPropertyBag | undefined;
    let anchorClickSpy: ReturnType<typeof vi.spyOn>;
    const OriginalBlob = globalThis.Blob;

    beforeEach(() => {
      class StubBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          capturedBlobParts = parts;
          capturedBlobOptions = options;
        }
      }
      // @ts-expect-error — intentionally narrower than the real Blob,
      // sufficient for what this test needs to observe.
      globalThis.Blob = StubBlob;
      URL.createObjectURL = vi.fn(() => "blob:mock-url");
      URL.revokeObjectURL = vi.fn();
      // jsdom attempts real navigation on anchor.click() with a
      // (mocked) href set — stubbed as a no-op so tests observe that
      // the download was *triggered* without jsdom logging "Not
      // implemented: navigation" noise for a click that was never
      // going anywhere real to begin with.
      anchorClickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.Blob = OriginalBlob;
      capturedBlobParts = undefined;
      capturedBlobOptions = undefined;
      vi.restoreAllMocks();
    });

    it("calls onExport() when clicked", () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      getExportButton(controls.element).click();

      expect(handlers.onExport).toHaveBeenCalledTimes(1);
    });

    it("does not call onExport() before any interaction", () => {
      const handlers = makeHandlers();
      createSessionControls(handlers);
      expect(handlers.onExport).not.toHaveBeenCalled();
    });

    it("builds a Blob from exactly what onExport() returned, as application/json", () => {
      const handlers = makeHandlers({ onExport: () => '[{"id":"event-1"}]' });
      const controls = createSessionControls(handlers);

      getExportButton(controls.element).click();

      expect(capturedBlobParts).toEqual(['[{"id":"event-1"}]']);
      expect(capturedBlobOptions).toEqual({ type: "application/json" });
    });

    it("revokes the object URL after triggering the download", () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      getExportButton(controls.element).click();

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("triggers a click on a programmatically-created download anchor", () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      getExportButton(controls.element).click();

      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    });

    it("sets the anchor's download attribute to a devlens-session-*.json filename", () => {
      let capturedAnchor: HTMLAnchorElement | undefined;
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation(
        ((tag: string) => {
          const el = originalCreateElement(tag);
          if (tag === "a") capturedAnchor = el as HTMLAnchorElement;
          return el;
        }) as typeof document.createElement
      );

      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);
      getExportButton(controls.element).click();

      expect(capturedAnchor?.getAttribute("download")).toMatch(
        /^devlens-session-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/
      );
    });
  });
});

describe("sessionExportFilename", () => {
  it("formats as devlens-session-YYYY-MM-DDTHH-mm-ss.json", () => {
    const date = new Date("2026-08-06T08:03:12.345Z");
    expect(sessionExportFilename(date)).toBe(
      "devlens-session-2026-08-06T08-03-12.json"
    );
  });

  it("replaces colons with dashes (invalid in Windows filenames)", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExportFilename(date)).not.toContain(":");
  });

  it("drops milliseconds and the trailing Z", () => {
    const date = new Date("2026-08-06T08:03:12.999Z");
    const filename = sessionExportFilename(date);
    expect(filename).not.toContain(".999");
    expect(filename).not.toContain("Z");
  });

  it("defaults to the current time when no Date is given", () => {
    expect(() => sessionExportFilename()).not.toThrow();
    expect(sessionExportFilename()).toMatch(
      /^devlens-session-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/
    );
  });
});
