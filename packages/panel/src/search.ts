import type { DevLensEvent } from "@devlens/core";

/**
 * Whether a single text field contains `normalizedQuery` as a
 * case-insensitive substring. `field` may be absent (e.g. an event
 * with no stack) — absent fields simply never match, they are not
 * coerced into an empty-string match.
 */
function fieldMatches(
  field: string | undefined,
  normalizedQuery: string
): boolean {
  return field !== undefined && field.toLowerCase().includes(normalizedQuery);
}

/**
 * Whether any of an event's developer-facing text fields — title,
 * message, stack, tags — contain `normalizedQuery`. See
 * docs/specs/inspection.md, "Search model," decision 1:
 * `metadata`/`context` are deliberately excluded (open, structured
 * data with no principled text-matching semantics).
 *
 * Each field is checked independently (not concatenated into one
 * string first) so a query can never match across a field boundary —
 * e.g. the end of `title` and the start of `message`.
 */
function eventMatches(event: DevLensEvent, normalizedQuery: string): boolean {
  if (fieldMatches(event.title, normalizedQuery)) return true;
  if (fieldMatches(event.message, normalizedQuery)) return true;
  if (fieldMatches(event.stack, normalizedQuery)) return true;
  return (event.tags ?? []).some((tag) => fieldMatches(tag, normalizedQuery));
}

/**
 * Computes a Navigation Context: the subset of `events` whose
 * developer-facing text fields (title/message/stack/tags) contain
 * `query`, case-insensitively, as a substring — in the same relative
 * order they appeared in.
 *
 * Pure function — no DOM, no renderer, no highlighting, no keyboard
 * handling, no side effects. Given the same arguments, always returns
 * an equivalent result. Does not mutate `events`.
 *
 * `query` is trimmed before matching, so leading/trailing whitespace
 * never changes the result. A query that is empty after trimming is
 * the identity transformation: every event passes, in a fresh array
 * (mirroring applyFilters()'s no-active-filters fast path).
 *
 * Idempotent for the same query: applySearch(applySearch(events, q), q)
 * equals applySearch(events, q) — see inspection.md's Search
 * invariants.
 */
export function applySearch(
  events: readonly DevLensEvent[],
  query: string
): DevLensEvent[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery === "") {
    return events.slice();
  }

  return events.filter((event) => eventMatches(event, normalizedQuery));
}
