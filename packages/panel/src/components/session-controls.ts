/**
 * Session controls are a dedicated component, separate from the
 * toolbar (filtering) and search box (search) — see
 * docs/specs/inspection.md's "Session controls model" and ADR-0008's
 * Session 7 amendment. Pause/Resume, Clear, Export, and Import drive
 * Panel behaviors that have nothing to do with filtering or search,
 * so they don't live inside toolbar.ts.
 *
 * Unlike the toolbar/search box (a single outward callback each), this
 * component genuinely drives five independent actions plus one query,
 * so it takes a small handlers object rather than one callback — the
 * shape follows what's actually being communicated, not an attempt to
 * force a one-callback pattern where it doesn't fit.
 *
 * `isPaused` is called, not cached: this component re-reads it after
 * every Pause/Resume click to decide the toggle's next label, and once
 * at creation time for its initial label — it never keeps its own
 * shadow copy of Panel's pause state (inspection.md's "State
 * visibility" decision: Panel owns isPaused; this only ever reads it).
 *
 * Export delivers a browser download (Blob + object URL + a
 * programmatically-clicked <a download>) — that mechanism lives here,
 * not in panel.ts, per inspection.md decision 5 ("Export vs. download
 * is a real seam"). `onExport()` only returns the serialized string;
 * everything after that point is this component's responsibility.
 */
import type { ImportError, ImportResult } from "../import";

export interface SessionControls {
  readonly element: HTMLElement;
}

export interface SessionControlsHandlers {
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onExport: () => string;
  isPaused: () => boolean;
  /**
   * Given the text contents of a user-selected file, attempt to
   * restore a session. Returns ImportResult (from ./import)
   * unchanged — no second validation/error model. File.text()
   * failing is handled separately, entirely inside this component
   * (see the `.catch()` below), because it happens *before*
   * onImport() is ever called and has no ImportError code of its
   * own; onImport() is only ever invoked with contents that were
   * already read successfully.
   */
  onImport: (fileContents: string) => ImportResult;
}

/**
 * Builds the timestamped export filename:
 * `devlens-session-YYYY-MM-DDTHH-mm-ss.json`. Colons are replaced with
 * dashes (colons are invalid in Windows filenames); milliseconds and
 * the trailing "Z" are dropped since they add precision nobody needs
 * for a filename. Exported as its own pure function — deterministic
 * given a Date, and worth testing precisely rather than only as a side
 * effect of clicking the Export button.
 */
export function sessionExportFilename(now: Date = new Date()): string {
  const isoWithoutMillis = now.toISOString().split(".")[0]; // "2026-08-06T08:03:12"
  const safe = isoWithoutMillis.replace(/:/g, "-");
  return `devlens-session-${safe}.json`;
}

/**
 * Translates a structured import failure into a short, human-readable
 * status message. The underlying error code is not lost — callers
 * that need it (there are none yet) still have the full ImportResult
 * available; this function only produces display text for the status
 * region below.
 *
 * store-not-empty gets its own explicit, actionable message pointing
 * at the existing Clear button — see the Store-Empty UX decision —
 * rather than a generic "import failed."
 */
function describeImportError(error: ImportError): string {
  if (error.code === "store-not-empty") {
    return "Import requires an empty session. Clear the current session, then try again.";
  }
  return error.message;
}

function triggerJsonDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function createSessionControls(
  handlers: SessionControlsHandlers
): SessionControls {
  const element = document.createElement("div");
  element.setAttribute("data-devlens-session-controls", "");

  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.setAttribute("data-devlens-session-pause-button", "");

  function syncPauseButtonLabel(): void {
    const paused = handlers.isPaused();
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute(
      "data-devlens-session-state",
      paused ? "paused" : "running"
    );
  }

  pauseButton.addEventListener("click", () => {
    if (handlers.isPaused()) {
      handlers.onResume();
    } else {
      handlers.onPause();
    }
    syncPauseButtonLabel();
  });

  syncPauseButtonLabel();

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.setAttribute("data-devlens-session-clear-button", "");
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", () => {
    handlers.onClear();
  });

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.setAttribute("data-devlens-session-export-button", "");
  exportButton.textContent = "Export";
  exportButton.addEventListener("click", () => {
    const contents = handlers.onExport();
    triggerJsonDownload(sessionExportFilename(), contents);
  });

  // --- Import ---------------------------------------------------------
  //
  // Native file picker, no drag-and-drop, no custom file browser (see
  // the Session Restore UI design). The <input type="file"> is kept
  // out of visual flow rather than styled invisible-but-present, and
  // is triggered by a normal button so the actual picker UI is 100%
  // native.
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.setAttribute("data-devlens-session-import-input", "");
  importInput.style.display = "none";

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.setAttribute("data-devlens-session-import-button", "");
  importButton.textContent = "Import";
  importButton.addEventListener("click", () => {
    importInput.click();
  });

  // Small, local, single-purpose status region — not a generic
  // notification/toast system. role="status" + aria-live give screen
  // readers the same "something changed here" signal a toast would,
  // without any new framework. Cleared at the start of every new
  // attempt so a stale success/failure message never lingers behind a
  // new one.
  const importStatus = document.createElement("div");
  importStatus.setAttribute("data-devlens-session-import-status", "");
  importStatus.setAttribute("role", "status");
  importStatus.setAttribute("aria-live", "polite");

  function setImportStatus(message: string, outcome: "success" | "error"): void {
    importStatus.textContent = message;
    importStatus.setAttribute("data-devlens-session-import-outcome", outcome);
  }

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    // Cancelling the native picker leaves `files` empty — nothing to
    // do, no error, no Store mutation. Also reached defensively if
    // `change` ever fires with no file for another reason.
    if (!file) return;

    importStatus.textContent = "";
    importStatus.removeAttribute("data-devlens-session-import-outcome");

    file
      .text()
      .then((contents) => {
        const outcome = handlers.onImport(contents);
        if (outcome.ok) {
          setImportStatus(
            `Imported ${outcome.importedCount} event${outcome.importedCount === 1 ? "" : "s"}.`,
            "success"
          );
        } else {
          setImportStatus(describeImportError(outcome.error), "error");
        }
      })
      .catch(() => {
        // File.text() itself rejected (e.g. the file became
        // unreadable after selection) — handled separately from
        // ImportResult's own failure branches,
        // since this happens before onImport() is ever called.
        setImportStatus("Could not read the selected file.", "error");
      })
      .finally(() => {
        // Reset so selecting the same filename again still fires
        // `change`.
        importInput.value = "";
      });
  });

  element.append(
    pauseButton,
    clearButton,
    exportButton,
    importButton,
    importInput,
    importStatus
  );

  return { element };
}
