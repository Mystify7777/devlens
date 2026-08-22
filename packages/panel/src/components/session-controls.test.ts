import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSessionControls,
  sessionExportFilename,
  type SessionControlsHandlers,
} from "./session-controls";
import type { ImportResult } from "../import";

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

function getImportButton(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(
    "[data-devlens-session-import-button]"
  );
  if (!el) throw new Error("import button not found");
  return el;
}

function getImportInput(root: HTMLElement): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    "[data-devlens-session-import-input]"
  );
  if (!el) throw new Error("import input not found");
  return el;
}

function getImportStatus(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>(
    "[data-devlens-session-import-status]"
  );
  if (!el) throw new Error("import status region not found");
  return el;
}

/**
 * jsdom's File lacks .text() entirely (the same gap documented for
 * Blob elsewhere in this file) — stubbed here rather than relying on
 * jsdom's incomplete File API. `resolveWith`/`rejectWith` let a test
 * control the read outcome directly, which is what's actually under
 * test (session-controls.ts's handling of both outcomes), not
 * jsdom's file-reading fidelity.
 */
function selectFile(
  input: HTMLInputElement,
  file: { text: () => Promise<string> }
): void {
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  input.dispatchEvent(new Event("change"));
}

function fakeFile(contents: string): { text: () => Promise<string> } {
  return { text: () => Promise.resolve(contents) };
}

function unreadableFile(): { text: () => Promise<string> } {
  return { text: () => Promise.reject(new Error("read error")) };
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
    onImport: vi.fn(
      (): ImportResult => ({ ok: true, importedCount: 0 })
    ),
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

  it("renders exactly four buttons: pause/resume, clear, export, import", () => {
    const controls = createSessionControls(makeHandlers());
    expect(controls.element.querySelectorAll("button")).toHaveLength(4);
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

  describe("import button", () => {
    it("clicking Import triggers the native file picker", () => {
      const controls = createSessionControls(makeHandlers());
      const input = getImportInput(controls.element);
      const clickSpy = vi.spyOn(input, "click");

      getImportButton(controls.element).click();

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("does not call onImport() before any interaction", () => {
      const handlers = makeHandlers();
      createSessionControls(handlers);
      expect(handlers.onImport).not.toHaveBeenCalled();
    });

    it("selecting a file calls onImport() with the file's text contents", async () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      selectFile(getImportInput(controls.element), fakeFile('[{"id":"e1"}]'));
      await vi.waitFor(() =>
        expect(handlers.onImport).toHaveBeenCalledTimes(1)
      );

      expect(handlers.onImport).toHaveBeenCalledWith('[{"id":"e1"}]');
    });

    it("cancelling the picker (no file selected) does not call onImport()", () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);
      const input = getImportInput(controls.element);

      Object.defineProperty(input, "files", {
        value: [],
        configurable: true,
      });
      input.dispatchEvent(new Event("change"));

      expect(handlers.onImport).not.toHaveBeenCalled();
    });

    it("shows a success status message after a successful import", async () => {
      const handlers = makeHandlers({
        onImport: vi.fn((): ImportResult => ({ ok: true, importedCount: 3 })),
      });
      const controls = createSessionControls(handlers);

      selectFile(getImportInput(controls.element), fakeFile("[]"));

      const status = getImportStatus(controls.element);
      await vi.waitFor(() => expect(status.textContent).toContain("3"));

      expect(status.getAttribute("data-devlens-session-import-outcome")).toBe(
        "success"
      );
    });

    it("shows the store-not-empty message pointing at Clear when the Store isn't empty", async () => {
      const handlers = makeHandlers({
        onImport: vi.fn(
          (): ImportResult => ({
            ok: false,
            error: {
              code: "store-not-empty",
              message: "Store must be empty before import.",
            },
          })
        ),
      });
      const controls = createSessionControls(handlers);

      selectFile(getImportInput(controls.element), fakeFile("[]"));

      const status = getImportStatus(controls.element);
      await vi.waitFor(() =>
        expect(status.textContent).toMatch(/clear/i)
      );

      expect(status.getAttribute("data-devlens-session-import-outcome")).toBe(
        "error"
      );
    });

    it("shows the underlying error message for other structured import failures", async () => {
      const handlers = makeHandlers({
        onImport: vi.fn(
          (): ImportResult => ({
            ok: false,
            error: {
              code: "invalid-json",
              message: "Import input is not valid JSON.",
            },
          })
        ),
      });
      const controls = createSessionControls(handlers);

      selectFile(getImportInput(controls.element), fakeFile("not json"));

      const status = getImportStatus(controls.element);
      await vi.waitFor(() =>
        expect(status.textContent).toBe("Import input is not valid JSON.")
      );
      expect(status.getAttribute("data-devlens-session-import-outcome")).toBe(
        "error"
      );
    });

    it("shows a read-failure message, without calling onImport(), when File.text() rejects", async () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);

      selectFile(getImportInput(controls.element), unreadableFile());

      const status = getImportStatus(controls.element);
      await vi.waitFor(() =>
        expect(status.textContent).toContain("Could not read")
      );

      expect(handlers.onImport).not.toHaveBeenCalled();
      expect(status.getAttribute("data-devlens-session-import-outcome")).toBe(
        "error"
      );
    });

    it("resets the input value after handling a selection, so the same file can be re-selected", async () => {
      const handlers = makeHandlers();
      const controls = createSessionControls(handlers);
      const input = getImportInput(controls.element);

      selectFile(input, fakeFile("[]"));
      await vi.waitFor(() => expect(handlers.onImport).toHaveBeenCalledTimes(1));

      expect(input.value).toBe("");
    });

    it("clears a previous status message at the start of a new attempt", async () => {
      const handlers = makeHandlers({
        onImport: vi.fn(
          (): ImportResult => ({ ok: true, importedCount: 1 })
        ),
      });
      const controls = createSessionControls(handlers);
      const input = getImportInput(controls.element);
      const status = getImportStatus(controls.element);

      selectFile(input, fakeFile("[]"));
      await vi.waitFor(() => expect(status.textContent).not.toBe(""));

      // Redefine files for a second selection.
      Object.defineProperty(input, "files", {
        value: [fakeFile("[]")],
        configurable: true,
      });
      input.dispatchEvent(new Event("change"));

      // Status is cleared synchronously before the (microtask) read
      // resolves and repopulates it.
      expect(status.textContent).toBe("");
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
