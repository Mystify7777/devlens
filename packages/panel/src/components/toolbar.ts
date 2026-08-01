import type { BuiltinEventCategory, EventSeverity } from "@devlens/core";
import type { FilterState } from "../filters";

/**
 * The toolbar is filter *controls*, not the filter *engine* — see
 * docs/specs/inspection.md's "Filter controls model" and ADR-0008's
 * Session 5 amendment. It knows nothing about applyFilters(),
 * computeNavigationContext(), or the Store. Its entire outward
 * communication channel is onFiltersChange, which panel.ts wires to
 * the same internal function its own setFilters() calls.
 *
 * Every checkbox toggle calls onFiltersChange immediately — there is
 * no draft/apply distinction (see inspection.md, decision 2).
 * Checkbox groups (not a dropdown) directly express the
 * OR-within-a-dimension behavior the Filtering model already decided.
 */
export interface Toolbar {
  readonly element: HTMLElement;
}

const ALL_CATEGORIES: readonly BuiltinEventCategory[] = [
  "runtime",
  "console",
  "network",
  "compiler",
  "framework",
  "performance",
];

const ALL_SEVERITIES: readonly EventSeverity[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

export function createToolbar(
  onFiltersChange: (filters: FilterState) => void
): Toolbar {
  const element = document.createElement("div");
  element.setAttribute("data-devlens-toolbar", "");

  // Local UI state only — which boxes are currently checked. This is
  // not PanelState and Panel never reads it directly; the toolbar's
  // only way of communicating outward is calling onFiltersChange with
  // the FilterState this state implies.
  const selectedSeverities = new Set<EventSeverity>();
  const selectedCategories = new Set<BuiltinEventCategory>();

  function emitChange() {
    onFiltersChange({
      categories: Array.from(selectedCategories),
      severities: Array.from(selectedSeverities),
    });
  }

  function createCheckboxGroup<T extends string>(
    groupLabel: string,
    groupAttr: string,
    values: readonly T[],
    selected: Set<T>
  ): HTMLElement {
    const group = document.createElement("fieldset");
    group.setAttribute(`data-devlens-toolbar-${groupAttr}`, "");

    const legend = document.createElement("legend");
    legend.textContent = groupLabel;
    group.appendChild(legend);

    for (const value of values) {
      const label = document.createElement("label");
      label.setAttribute(`data-devlens-toolbar-${groupAttr}-option`, "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute(`data-devlens-toolbar-${groupAttr}-checkbox`, "");
      checkbox.setAttribute("data-value", value);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(value);
        } else {
          selected.delete(value);
        }
        emitChange();
      });

      label.append(checkbox, document.createTextNode(value));
      group.appendChild(label);
    }

    return group;
  }

  element.append(
    createCheckboxGroup(
      "Severity",
      "severity",
      ALL_SEVERITIES,
      selectedSeverities
    ),
    createCheckboxGroup(
      "Category",
      "category",
      ALL_CATEGORIES,
      selectedCategories
    )
  );

  return { element };
}
