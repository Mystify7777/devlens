/**
 * @devlens/panel's public API surface. Everything importable from
 * outside this package is re-exported here — internal modules
 * (renderer.ts, overlay.ts, components/*) are implementation detail
 * and not exported directly.
 */
export { createPanel } from "./panel";
export type { PanelController } from "./panel";
export { MAX_RENDERED_EVENTS } from "./constants";
export { applyFilters, createEmptyFilterState } from "./filters";
export type { FilterState } from "./filters";
export { applySearch } from "./search";