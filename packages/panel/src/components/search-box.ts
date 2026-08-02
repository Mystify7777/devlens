/**
 * The search box is a search *control*, not the search *engine* — see
 * docs/specs/inspection.md's "Search controls model" and ADR-0008's
 * Session 6 amendment. It knows nothing about applySearch(),
 * computeNavigationContext(), or the Store. Its entire outward
 * communication channel is onQueryChange, which panel.ts wires to the
 * same internal function its own setSearchQuery() calls.
 *
 * Updates on every keystroke (the `input` event) — no debounce. See
 * inspection.md, decision 1: applySearch()/applyFilters()/windowing
 * are all cheap linear scans, so there is no performance problem here
 * for debounce to solve.
 */
export interface SearchBox {
  readonly element: HTMLElement;
}

export function createSearchBox(
  onQueryChange: (query: string) => void
): SearchBox {
  const element = document.createElement("div");
  element.setAttribute("data-devlens-search", "");

  const label = document.createElement("label");
  label.setAttribute("data-devlens-search-label", "");
  label.textContent = "Search";

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("data-devlens-search-input", "");
  input.placeholder = "Search title, message, stack, tags…";

  input.addEventListener("input", () => {
    onQueryChange(input.value);
  });

  label.appendChild(input);
  element.appendChild(label);

  return { element };
}
