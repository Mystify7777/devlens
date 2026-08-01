import type { DevLensEvent, EventCategory, EventSeverity } from "@devlens/core";

/**
 * Panel-local filter state — see docs/specs/inspection.md, "Filtering
 * model." This is never Store state; it's the developer's current
 * choice of what to look at, owned by whatever calls applyFilters()
 * (Panel), not by the data structure being filtered.
 *
 * An empty array for a dimension means "no constraint on this
 * dimension" (equivalent to "every value selected"), not "match
 * nothing." Values within a dimension combine with OR; dimensions
 * combine with AND — see inspection.md for the full rationale.
 */
export interface FilterState {
  readonly categories: readonly EventCategory[];
  readonly severities: readonly EventSeverity[];
}

/**
 * The empty filter state — no constraints active, every event passes.
 * Useful as an initial value and in tests.
 */
export function createEmptyFilterState(): FilterState {
  return { categories: [], severities: [] };
}

/**
 * Computes a Navigation Context: the subset of `events` that satisfy
 * `filters`, in the same relative order they appeared in.
 *
 * Pure function — no DOM, no renderer, no selection logic, no side
 * effects. Given the same arguments, always returns an equivalent
 * result. Does not mutate `events` or `filters`.
 *
 * Order-independent (commutative) across dimensions: filtering by
 * category then severity produces the same result as severity then
 * category, or both applied together in a single call — see
 * inspection.md's "order-independent (commutative)" invariant.
 */
export function applyFilters(
  events: readonly DevLensEvent[],
  filters: FilterState
): DevLensEvent[] {
  const hasCategoryFilter = filters.categories.length > 0;
  const hasSeverityFilter = filters.severities.length > 0;

  if (!hasCategoryFilter && !hasSeverityFilter) {
    return events.slice();
  }

  return events.filter((event) => {
    const matchesCategory =
      !hasCategoryFilter || filters.categories.includes(event.category);
    const matchesSeverity =
      !hasSeverityFilter || filters.severities.includes(event.severity);
    return matchesCategory && matchesSeverity;
  });
}
