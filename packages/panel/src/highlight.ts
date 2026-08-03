/**
 * Wraps every non-overlapping, case-insensitive occurrence of `query`
 * in `text` with a `<mark>` element, returning a DocumentFragment
 * ready to append in place of a plain text node.
 *
 * Pure rendering leaf — same category as applyFilters()/applySearch():
 * deterministic output from its inputs, no side effects beyond the
 * fragment it returns, no dependency on Panel, the Store, or the
 * search engine. It has no idea applySearch() exists; it receives a
 * query string, not a Navigation Context. See docs/specs/inspection.md,
 * "Search presentation model."
 *
 * Two invariants, both enforced by construction here and covered by
 * this file's tests:
 * - **Purely decorative.** This function only decides what to render;
 *   it has no way to influence which events are considered matches —
 *   that's applySearch()'s job, entirely upstream of this function
 *   ever being called.
 * - **Text-preserving.** Concatenating every text node's content in
 *   the returned fragment (i.e. `fragment.textContent`) always equals
 *   `text` exactly — no inserted or removed characters, no whitespace
 *   normalization. Highlighting only ever wraps existing text; it
 *   never edits it.
 *
 * An empty (or whitespace-only, after trimming) query returns the
 * original text as a single unwrapped text node — the identity case,
 * matching applySearch()'s own empty-query identity behavior.
 */
export function highlightText(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery === "") {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const lowerText = text.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, cursor);

    if (matchIndex === -1) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      break;
    }

    if (matchIndex > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
    }

    const mark = document.createElement("mark");
    mark.setAttribute("data-devlens-match", "");
    mark.textContent = text.slice(matchIndex, matchIndex + normalizedQuery.length);
    fragment.appendChild(mark);

    cursor = matchIndex + normalizedQuery.length;
  }

  return fragment;
}
