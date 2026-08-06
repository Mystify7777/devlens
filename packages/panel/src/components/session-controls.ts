/**
 * Session controls are a dedicated component, separate from the
 * toolbar (filtering) and search box (search) — see
 * docs/specs/inspection.md's "Session controls model" and ADR-0008's
 * Session 7 amendment. Pause/Resume, Clear, and Export drive Panel
 * behaviors that have nothing to do with filtering or search, so they
 * don't live inside toolbar.ts.
 *
 * Unlike the toolbar/search box (a single outward callback each), this
 * component genuinely drives four independent actions plus one query,
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
export interface SessionControls {
  readonly element: HTMLElement;
}

export interface SessionControlsHandlers {
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onExport: () => string;
  isPaused: () => boolean;
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

  element.append(pauseButton, clearButton, exportButton);

  return { element };
}
