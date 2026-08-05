import type { DevLensEvent } from "@devlens/core";

/**
 * `next`/`previous` move one row at a time through `visibleEvents`;
 * `first`/`last` jump directly to either end regardless of current
 * selection (Home/End). See docs/specs/inspection.md, "Keyboard
 * navigation model."
 */
export type NavigationDirection = "next" | "previous" | "first" | "last";

/**
 * Given the currently rendered rows and the currently selected event
 * (if any), computes which event a keyboard direction should select
 * next. Pure function — same category as applyFilters()/applySearch():
 * no DOM, no Panel state, no side effects, deterministic from its
 * inputs.
 *
 * `visibleEvents` is deliberately the *rendered* list (already
 * filtered, searched, and windowed to MAX_RENDERED_EVENTS) — this
 * function traverses the currently rendered portion of the Navigation
 * Context, not the full Navigation Context (see inspection.md, decision
 * 2). It has no idea filtering, search, or windowing exist; it only
 * ever sees the array it's handed and moves through it linearly.
 *
 * Rules, per inspection.md's Keyboard navigation model:
 * - Traversal is strictly linear (index±1) — never a semantic
 *   "skip to next match."
 * - No current selection (`currentEventId` is `null`, or doesn't
 *   appear in `visibleEvents`) → both `next` and `previous` select the
 *   first visible row. There is no current position to move relative
 *   to, so both directions fall back to the same deterministic choice
 *   rather than "previous" picking the last row.
 * - Stops at the ends — `next` on the last row (or `previous` on the
 *   first) returns that same row, not a wraparound to the other end.
 * - An empty `visibleEvents` has nothing to select — returns `null`
 *   regardless of direction.
 */
export function computeNavigationTarget(
  visibleEvents: readonly DevLensEvent[],
  currentEventId: string | null,
  direction: NavigationDirection
): DevLensEvent | null {
  if (visibleEvents.length === 0) {
    return null;
  }

  if (direction === "first") {
    return visibleEvents[0];
  }

  if (direction === "last") {
    return visibleEvents[visibleEvents.length - 1];
  }

  const currentIndex =
    currentEventId === null
      ? -1
      : visibleEvents.findIndex((event) => event.id === currentEventId);

  if (currentIndex === -1) {
    // No selection, or the selected event isn't in the currently
    // rendered rows (e.g. it's still in the Navigation Context but has
    // scrolled beyond MAX_RENDERED_EVENTS) — both directions fall back
    // to the first visible row.
    return visibleEvents[0];
  }

  if (direction === "next") {
    const nextIndex = currentIndex + 1;
    return nextIndex < visibleEvents.length
      ? visibleEvents[nextIndex]
      : visibleEvents[currentIndex];
  }

  // direction === "previous"
  const previousIndex = currentIndex - 1;
  return previousIndex >= 0
    ? visibleEvents[previousIndex]
    : visibleEvents[currentIndex];
}
