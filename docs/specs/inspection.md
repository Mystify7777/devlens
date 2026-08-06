# Interactive Inspection

## Purpose

A developer can understand an event without leaving the DevLens panel.

## Background

See [ADR-0009](../adr/0009-v0.3.0-direction.md) for why v0.3.0-alpha
invests in the Experience axis (inspection, filtering, search) rather
than a new capture source. This document defines the problem space for
that milestone — it does not re-litigate the "why."

## Goals

- Inspect a selected event in full: stack trace, `metadata`, `context`,
  `tags` — everything `DevLensEvent` can carry, not just the
  severity/title/message currently shown in the row.
- Expose all available event data without requiring the developer to
  open the browser console or `console.table()` dump.
- Keep the event list itself usable while inspection is active — the
  list is still the primary navigation surface (see Principles).
- Remain framework-agnostic, vanilla-DOM, Shadow-DOM-isolated — nothing
  about inspection should require reopening ADR-0008's core rendering
  decisions any more than necessary (see Constraints).

## Non-goals

- Network capture (`@devlens/network`) — deferred per ADR-0009, not
  part of this milestone.
- Timeline visualization.
- React-specific APIs (`@devlens/react`).
- Session replay / time-travel debugging.
- Any capture-side changes to Runtime, Console, or the Event Bus. This
  is Experience-axis work only.

## Principles

- The event list remains the primary navigation surface. Inspection is
  a secondary view onto a selected event, not a replacement for the
  list.
- Inspection augments events; it never changes them. Nothing here
  should mutate a `DevLensEvent` or the Store.
- The panel reflects Store state rather than owning event data — this
  extends ADR-0008's "Panel displays, it doesn't capture" to inspection
  specifically: inspection doesn't introduce a second source of truth
  for event data.
- Features should compose rather than couple. Filtering, search, and
  inspection should ideally work independently of one another rather
  than assuming all three exist simultaneously.
- **The event list is the primary navigation surface. The inspector is
  a projection of the currently selected event. It never owns event
  data and never becomes the primary navigation mechanism.** (Session 4,
  Presentation Model decision — see below.)
- **The inspector is not a popup. It is one half of the Panel.**

## Session 4 decisions

Decisions made during Session 4 design discussion, resolved one at a
time per the sequence: Presentation → Selection → Panel state →
Filtering → Search → Pause/Resume → Export. Each entry records the
decision and its justification, not just the conclusion — future
readers should be able to tell *why*, not just *what*.

### Presentation model — Accepted: persistent side inspector

The Panel has two distinct responsibilities: browsing events and
inspecting a selected event. A persistent side inspector expresses
those responsibilities directly, preserving list context and letting
future features (search, filtering, keyboard navigation, and
additional event sources) compose naturally against the same
interaction.

Modal was rejected as fundamentally interruptive — inspecting several
events in sequence becomes a repeated open/close cycle, and that
friction compounds with the number of events under investigation.

Inline accordion was rejected because DevLens event detail (stack
traces, metadata, and future network payloads/headers/bodies) is
measured in screens, not lines. An accordion that scales to that much
content stops behaving like a list and starts behaving like a
document, which works against scanning — the event list's primary job.

**The inspector region is a permanent part of the Panel layout. It is
always mounted.** There is no "drawer open/closed" state — only
`selectedEvent: DevLensEvent | null`. When no event is selected, the
inspector renders an explicit empty state (e.g. "Select an event to
inspect it"), which doubles as in-UI guidance the first time someone
opens DevLens.

Mount/unmount was rejected because it introduces UI lifecycle state
that isn't part of the actual domain model — it would be possible to
end up with "mounted, no selection" or "not mounted, selection exists"
as inconsistent states to synchronize, rather than one clean state
(`selectedEvent`) the UI simply projects from.

The inspector's exact sizing strategy (fixed width, percentage,
resizable, responsive) is explicitly **not** decided here — that's an
implementation concern. Only the region's permanence and the
non-existence of an open/close state are architectural.

**Implications to preserve** (not decisions in themselves — invariants
that later Session 4 decisions should stay consistent with):

- Search, once designed, filters the **list**, not the inspector.
- Keyboard navigation, if it exists, moves through the **list**; the
  inspector updates as a side effect of selection changing, the same
  way it does on click.
- Export, once designed, operates on the **Store** (or a filtered view
  of it) — not on whatever happens to be shown in the inspector.
- The inspector reflects the current selection; it does not itself
  decide what's selected.

### Selection model — Accepted: single selection

The inspector represents one focused inspection context. Selection
answers "which event is currently being inspected?" — it does not
answer "which events are related?" Multi-event comparison is a
distinct future feature (see Future extensions), not an extension of
selection; conflating the two would force today's simple state model
to anticipate a shape (`selectedEvent` vs. `selectedEvents`/relationship
data) that this milestone doesn't need and shouldn't guess at.

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
}
```

No arrays, no sets, no "active vs. primary" distinction.

**Selection is Panel-local UI state, never Store state.** Extending the
existing principle ("the panel reflects Store state rather than owning
event data"): *selection is view state, not event state — it belongs
to the consumer (Panel), never to the Store.* The Store answers "what
events exist?"; the Panel answers "which event is the user currently
looking at?" Letting the Store hold selection would mean any other
consumer (a CLI, a future editor integration) inherits a UI concept
that means nothing to it, and would raise "whose selection?" the
moment more than one consumer exists. That's exactly the kind of
coupling the Store/Bus split (ADR-0004) was built to avoid.

**Selection persistence:**

- If the selected event scrolls beyond `MAX_RENDERED_EVENTS`, selection
  **is retained**. The Store still owns the event; only one
  *representation* of it (the row) has left view. The inspector
  continues to reflect it.
- If a future filter excludes the selected event from the navigable
  set, selection **is cleared**, returning the inspector to its empty
  state. Continuing to show an event the list can no longer display
  would break the "inspector is a projection of the current selection
  *within the navigation context*" model — the two panes would
  describe different event sets.

In one sentence: **selection persists while the event exists in the
Store and remains part of the current navigation context; it is
cleared when explicitly replaced, or when the event is excluded from
that context (e.g. by a filter) — never merely because it scrolled out
of the rendered window.**

### Panel state model — Accepted: Panel-local state, delegated events, targeted updates

Three decisions, recorded together because they reinforce one another.

**1. `selectedEvent` lives in `panel.ts`**, alongside the existing
lifecycle state (`installed`, `unsubscribe`, `overlay`). Conceptually:

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
}
```

Whether this ends up as a literal object or a handful of closure
variables (matching the existing style in `panel.ts`) is an
implementation detail. Architecturally, it belongs to the Panel — not
the Store — for the same reason established in the Selection decision
above: selection is view state.

**2. Event delegation, not a per-row `onSelect` callback.** A single
delegated click handler on the event-list container — not
`createEventRow()` taking an `onSelect` prop — determines which event
was clicked and updates `selectedEvent`. This isn't primarily a
performance choice (there aren't enough rows for that to matter at
`MAX_RENDERED_EVENTS = 300`); it preserves `createEventRow()`'s single
responsibility ("given an event, produce a DOM representation") without
teaching it about selection, ownership, or Panel behavior.

**3. Selection changes do not trigger event-list reconstruction.**
This is a deliberate, narrow departure from ADR-0008's "just re-render
everything" stance — and worth explaining why it isn't a contradiction.
ADR-0008's simplicity applied to **Store changes**: the list had one
projection (Store → List), so a full re-render on every new event was
the correct, boring default. The architecture is no longer that
simple — the Store now has two independent projections:

```text
Store
      │
      ├──► List
      │
      └──► Inspector
```

Selection changing does not change the Store. The list has no new data
to show; only the inspector does. Applying "re-render everything" here
would mean rebuilding up to 300 rows on every click just to move a
highlight and swap the inspector's contents — that's not consistency
with ADR-0008, it's reapplying its rule outside the context it was
written for.

The resulting rule:

- **Store changes** → the event list re-renders (existing ADR-0008
  behavior, unchanged).
- **Selection changes** → the inspector renders the newly selected
  event; the list only updates the visual selected-row state (e.g. a
  `data-selected` attribute toggle) — it does not reconstruct rows.

**Invariant to record:** selection changes are UI state transitions.
They do not trigger event-list reconstruction unless the underlying
Store contents change. The exact mechanism (`classList.toggle()`,
`data-selected`, cached DOM references) is an implementation concern,
not a spec concern.

This also clarifies the emerging component boundary, though it doesn't
require its own ADR — it's implementation structure growing naturally
out of the decisions above, not a new architectural commitment:

```text
panel.ts     — owns selectedEvent, install(), subscriptions, delegation
renderer.ts  — owns rendering the event list, updating selection visuals
inspector.ts — owns rendering the currently selected event (new file)
```

### Filtering model — Accepted: faceted (AND-across/OR-within), hide, Panel-local, filter-before-window

Four sub-decisions, recorded together because — like the Panel state
model — they only make sense as a set.

**1. Dimensions combine with AND; values within a dimension combine
with OR.** Filtering is scoped to category and severity (per
ADR-0009). Selecting multiple values within one dimension (e.g.
severity = error, warn) is a widening operation — either matches.
Selecting values across dimensions (severity = error AND category =
network) is a narrowing operation — both must match. An unset
dimension imposes no constraint (equivalent to "all values selected").

```text
event passes ⟺
  (event.severity ∈ selectedSeverities ∨ selectedSeverities is empty)
  ∧
  (event.category ∈ selectedCategories ∨ selectedCategories is empty)
```

This generalizes cleanly to future dimensions (origin, tags, plugin)
without redesigning the combination rule — a new dimension is just
another clause ANDed in.

**Rejected: single active filter at a time.** Doesn't compose — every
new filter type would compete for ownership of "the" active filter,
and turning one on would silently discard another the developer just
set. That's worse UX than two independent sets, for no real
implementation savings.

**2. Non-matching events are hidden, not de-emphasized.** They are
absent from the rendered list, not present-but-dimmed.

**Rejected: de-emphasize (grey out, keep rendered).** Fails the
purpose test: filtering exists to reduce scanning cost (see
Principles — "the list is still the primary navigation surface"), and
a de-emphasized-but-present row doesn't reduce it. It also collides
with `MAX_RENDERED_EVENTS`: if de-emphasized events still occupy a
rendered slot, filtering can make the events you *do* want harder to
find inside the 300-row budget — the opposite of the feature's intent.

**3. Filter state is Panel-local UI state, never Store state** — the
same reasoning as Selection. The Store answers "what exists"; a
category/severity filter, like `selectedEvent`, is "what the developer
is currently choosing to look at," and belongs to the consumer (Panel),
not to a data structure a future CLI or other integration would also
inherit. Selection and filters are siblings in the same conceptual
state:

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
  filters: FilterState;
}
```
(Illustrative shape, not a commitment to a literal object over closure
variables — same caveat as the Panel state model decision above.)

**4. Filtering is applied to the full Store, before
`MAX_RENDERED_EVENTS` windowing — not applied within an
already-windowed slice.** Today, `panel.ts` computes
`store.getAll().slice(-MAX_RENDERED_EVENTS)` and renders that directly.
Once a filter exists, the order matters:

- **Filter-then-window (accepted):** filter the full Store, then take
  the last `MAX_RENDERED_EVENTS` *matching* events. A "severity: error"
  filter shows your most recent errors, however far back they occurred.
- **Window-then-filter (rejected):** take the last 300 events, then
  filter within that slice. A "severity: error" filter could show
  *nothing* — not because no errors exist, but because none happened
  to fall inside an unrelated, invisible windowing limit the developer
  has no way to know about. That's not a smaller result set, it's an
  incorrect one: the UI would be silently lying about what the Store
  contains.

This means `panel.ts`'s existing slicing logic moves to *after*
filtering rather than before — a small, contained change to something
already documented as Panel's responsibility (not the renderer's,
which stays purely mechanical per the ADR-0008 amendment above).

#### A concept this discussion surfaced: Navigation Context

Filtering makes explicit something that's existed implicitly since the
Selection decision: there's a stage between "what the Store contains"
and "what's actually rendered."

> **Navigation Context:** the ordered collection of events currently
> available for navigation — the *result* of applying zero or more
> view-level transformations (filtering, and later search) to the
> Store's contents, before presentation constraints like
> `MAX_RENDERED_EVENTS` are applied.

Precisely: Navigation Context is a **result**, not a transformation
step. `applyFilters()` is the transformation; the array it returns is
*a* Navigation Context. This matters once Search exists — Search
doesn't operate "inside" some single Navigation Context stage, it
takes one Navigation Context (the output of filtering) and produces
another. Each pure transformation produces its own Navigation Context;
there can be more than one in a pipeline, not one fixed stage all
transformations share:

```text
Store
  │
  ▼
applyFilters()
  │
  ▼
Navigation Context  (result of filtering)
  │
  ▼
applySearch()   (future)
  │
  ▼
Navigation Context  (result of filtering + search)
  │
  ▼
window()  (MAX_RENDERED_EVENTS — presentation constraint, not a
           transformation of the Navigation Context, a slice of it)
  │
  ▼
Renderer
```

This gives a name to the thing Selection's persistence rule was
already describing without naming it — "cleared... when the event is
excluded from that context (e.g. by a filter)" (see Selection model,
above) *is* a statement about a Navigation Context, written before the
term existed. Once named, future features can be specified against it
directly rather than re-deriving the pipeline each time:

- **Search**, once designed, takes the Navigation Context that
  filtering produced and returns a narrower one — not a second,
  parallel mechanism.
- **Keyboard navigation** (next/previous/page up/down), if it exists,
  moves through the current Navigation Context, not the Store and not
  the rendered DOM window directly.
- **Export**, per the existing "Implications to preserve" under
  Presentation model, operates on the Store (or an explicitly filtered
  view of it) — a deliberate exception, since exporting is about
  session data, not the developer's current navigation state.

**Invariant: every transformation that produces a Navigation Context
must be a pure function.** `applyFilters(events, filters)` takes an
event array and a filter state and returns an event array — no
renderer, no DOM, no selection logic, no side effects. This keeps it
trivially unit-testable in isolation from Panel/Renderer, and means
Search later composes as `applySearch(applyFilters(events, filters),
query)` — each transformation stays independent and pure, only the
final result gets windowed and handed to the renderer.

**Invariant: filtering is order-independent (commutative) across
dimensions.** Given the AND-across-dimensions design already accepted,
applying the category filter and then the severity filter must produce
the same result as applying them in the reverse order, and the same
result as applying both at once:

```text
applyFilters(events, {categories: A, severities: B})
  ==
applyFilters(applyFilters(events, {categories: A}), {severities: B})
  ==
applyFilters(applyFilters(events, {severities: B}), {categories: A})
```

This falls out naturally from the AND/OR combination rule already
decided — no extra implementation work is required — but it's worth
stating explicitly: it tells future implementers that filters are a
**declarative constraint** (a predicate an event either satisfies or
doesn't), not a **procedural pipeline** where sequence matters. A
future dimension (e.g. a text search) that *isn't* order-independent
with the others would be a deliberate, notable exception, not a silent
one.

**Scope note: filter engine vs. filter controls.** This section
decides the filter *engine* — `FilterState`'s shape and
`applyFilters()`'s behavior — as pure, DOM-free logic. It deliberately
does **not** decide filter *controls* — whatever UI lets a developer
actually set `filters` (toolbar, dropdown, chips, keyboard shortcut).
That's a Presentation-layer concern, decided separately, likely as its
own small ADR-0008 amendment once it's being built. Keeping these
separate avoids coupling the filter engine to whichever UI happens to
be designed first — the same reason `renderer.ts` knows nothing about
click handling or selection ownership (see Panel state model, above).

**Rendering consequence.** Selection changes deliberately skip
`renderEventList()` (see Panel state model, above) because Store
membership doesn't change. Filtering is the opposite case: it changes
which events are in the Navigation Context, which is exactly the
condition that already triggers a full list re-render today (a Store
change). So a filter change goes through the *existing* `Store change →
renderEventList()` path — this isn't a new rendering mode, it's the
current one, invoked for a new reason:

```text
filter changed
  → recompute Navigation Context (applyFilters, pure)
  → window to MAX_RENDERED_EVENTS
  → renderEventList(windowed events)
  → re-apply selection: if selectedEvent still in Navigation Context,
    setSelectedRow(); otherwise selectEvent(null) — per the Selection
    persistence rule already recorded above
```

### Filter controls model — Accepted: toolbar above the list, immediate apply, checkbox groups

Three decisions, following the same pattern as every prior Session 4
decision — recorded together since, like Panel state and Filtering
model, they only make sense as a set.

**1. Placement: a toolbar region above the event list, not above the
whole Panel.** Filtering changes navigation (which events are
browsable); it has no relationship to inspection. Scoping the toolbar
visually and structurally to the list — not spanning the inspector
too — keeps that boundary honest. See ADR-0008's Session 5 amendment
for the resulting ShadowRoot region structure.

**2. Apply immediately, no "Apply" button.** Every checkbox toggle
calls `setFilters()` directly; there is no intermediate "draft
filters" state a developer has to commit. `applyFilters()` being pure
and cheap is what makes this affordable — recomputing the Navigation
Context on every toggle costs nothing worth guarding behind an
explicit commit step. An Apply button would introduce a second piece
of state (draft vs. active filters) that duplicates a decision this
project already made once with Selection ("no arrays, no sets, no
extra state the simplest model doesn't need") for no evidenced benefit.

**3. Checkbox groups, not dropdowns**, one group per dimension
(Severity, Category). A dropdown typically implies "pick one";
checkboxes directly communicate the OR-within-a-dimension behavior
already decided in the Filtering model — seeing multiple boxes checked
*is* the mental model, rather than something a developer has to infer.

**Architectural constraint carried over from the Filtering model: the
toolbar never calls `applyFilters()`.** Its only outward call is
`panel.setFilters(filters)` — it does not know the filtering engine
exists beyond the shape of `FilterState` it must construct. This keeps
the dependency graph one-directional and each layer talking only to
its immediate neighbor:

```text
Toolbar → panel.setFilters() → updateEventList()
        → computeNavigationContext() → applyFilters()
```

A future control-surface redesign (chips, a different grouping, a
search-adjacent filter bar) only ever has to satisfy this same seam —
it never needs to know how filtering is computed.

**Deferred cleanup, explicitly not done now:** the click handler that
resolves a clicked row back to an event still searches
`store.getAll()` rather than the current Navigation Context. This is
harmless today (a click can only land on a row that's already in the
Navigation Context, since that's what was rendered), but it's a seam
worth tightening once Search exists and "what's clickable" and "what's
in the Store" can diverge more meaningfully. Noted here rather than
fixed now, per the project's discipline against unforced changes.

### Search model — Accepted: developer-facing text fields, trimmed case-insensitive substring, pure engine before controls

Four decisions, following the same pattern as Filtering — recorded
together because, like the Filtering model, they only make sense as a
set. Search is a second, independent transformation on the Navigation
Context, not a special case bolted onto Filtering.

**1. Scope: title, message, stack, and tags — developer-facing
textual content, not arbitrary structured payloads.** These are the
fields a developer reads to understand what happened, or explicitly
chose as short lookup labels (tags). This is deliberately phrased as a
principle rather than a fixed field list, so it scales if a future
event shape adds another human-authored text field without requiring
a redesign.

**Rejected: also search `metadata`/`context`.** These are open,
structured key-value data — arbitrary numbers, booleans, nested
objects, rendered generically by the Inspector. Substring-matching a
stringified value produces answers with no principled basis (should
searching `"true"` match every event with any boolean-`true` metadata
value? should `"3"` match a `retryCount` of `3`, or a stack line
number, or neither?). Structured fields already have a structured way
to narrow them — Filtering — and Search deliberately doesn't duplicate
that with a blunter, textual version of the same capability.

**2. Match semantics: trimmed, case-insensitive substring match on
the whole query string.** Leading/trailing whitespace is stripped
before matching, so `"runtime error"` and `" runtime error "` behave
identically — a small friendliness guarantee that costs nothing and
keeps the function fully deterministic.

**Rejected: fuzzy matching.** Requires selecting and tuning an
algorithm (or a dependency) for a need nothing in this project has
yet demonstrated — the same "no speculative abstraction" reasoning
that killed `assert.ts`/`now()` in Core.
**Rejected: regex.** Real footgun (unbounded/backtracking patterns
from arbitrary developer input) and immediately raises unresolved
questions with no good default (does `"("` throw? auto-escape?
silently fail to match?) — that's designing a regex engine, not a
diagnostics tool.
**Deferred, not rejected: multi-term AND-token matching** (e.g.
`"error network"` matching a field containing both words, in either
order). Genuinely useful eventually; whole-string substring is
simpler to build and test first, and multi-term search is additive
later, not a rewrite.

**3. Composition: Search is a second transformation on the Navigation
Context, applied after Filtering.** This was already committed to
when Navigation Context was named (see Filtering model, above) —
Search doesn't need a new decision here, only confirmation that it
holds:

```text
Store
  │
  ▼
applyFilters()
  │
  ▼
Navigation Context  (result of filtering)
  │
  ▼
applySearch()
  │
  ▼
Navigation Context  (result of filtering + search)
  │
  ▼
window()
  │
  ▼
Renderer
```

**4. Engine before controls — stated as an explicit architectural
principle, not just a build order.** The search engine has no
knowledge of text inputs, focus, keyboard events, rendering, or
highlighting. It knows only `applySearch(events, query): DevLensEvent[]`.
Search *input* (a text field), *match highlighting* (decorating
matched substrings in rendered rows/inspector text), and *keyboard
navigation* (traversing the Navigation Context — a Navigation concern,
not a Search one; explicitly un-bundled from this milestone) are each
separate, later slices, following the exact engine-then-controls
sequence Filtering already proved out:

```text
Search engine  →  Panel integration  →  Search controls  →
Highlighting  →  Keyboard navigation
```

Highlighting in particular is two nearly-independent responsibilities
— Search locates matches and narrows the Navigation Context; rendering
decorates matched text — and disabling highlighting entirely wouldn't
change whether Search functions correctly. That independence is the
signal they're different slices, not one feature.

#### Search invariants

Mirroring the commutativity invariant recorded for Filtering:

- **Pure.** `applySearch(events, query)` takes an event array and a
  string, returns an event array — no DOM, no renderer, no side
  effects, same as `applyFilters()`.
- **Empty query is the identity transformation.** `applySearch(events, "")`
  (after trimming) returns `events.slice()` — a fresh array, same
  members, same order. Same philosophy as `applyFilters()`'s
  no-active-filters fast path.
- **Order-preserving.** Matching events are returned in their original
  relative order, same as `applyFilters()`.
- **Never mutates** either argument.
- **Idempotent for the same query.** `applySearch(applySearch(events, q), q)`
  equals `applySearch(events, q)` — searching twice with the same
  query doesn't continue narrowing anything further, which falls out
  naturally from being a pure predicate over already-matching events,
  but is worth stating explicitly the same way commutativity was for
  Filtering.

### Search controls model — Accepted: no debounce, update on every keystroke, separate component from the toolbar

**1. No debounce.** `setSearchQuery()` is called on every keystroke
(the input's `input` event), with no delay. `applySearch()`,
`applyFilters()`, and windowing are all linear scans over in-memory
arrays bounded by realistic event volumes; recomputing the Navigation
Context on every character of a five-character query is a handful of
cheap operations, not a performance concern. Debounce would introduce
real design questions (how many milliseconds? does Enter bypass it?
does blur flush it? IME composition?) to solve a problem that doesn't
exist yet — the same "don't solve tomorrow's performance problem with
today's complexity" principle that kept `applyFilters()` and
`applySearch()` free of premature optimization. If DevLens ever
handles event volumes where this stops being true, that's a windowing/
indexing problem to solve then, not a reason to add input latency now.

**2. The search box is its own component, not folded into the
toolbar.** `createSearchBox(onQueryChange)` lives beside
`createToolbar(onFiltersChange)`, not inside it. They're both filter
*controls* in the broad sense (both narrow the Navigation Context, both
sit above the event list, per the Filtering model's placement
rationale), but they drive independent state (`filters` vs.
`searchQuery`) through independent seams (`setFilters()` vs.
`setSearchQuery()`), and mixing them into one component would blur
that. See ADR-0008's Session 6 amendment for the resulting region
structure.

**Scope note, mirroring Filtering's engine/controls split: Search
*presentation* is explicitly not decided here.** Match highlighting
(in the list, the inspector, or both), a "no results" empty state
distinct from "nothing selected," and a match count are all
rendering concerns layered on top of a Navigation Context that's
already correctly narrowed — the search box above proves the engine
and controls work without any of them. These get their own short
design pass before being built, the same way Filter controls got one
separate from the Filtering engine.

### Search presentation model — Accepted: decorate what's already rendered, three-state empty messaging, count on divergence

Three decisions. Unlike every prior Session 4 decision, none of these
touch state flow — the Navigation Context, Panel state, and the
engine/controls seams are all unchanged. This is purely about what the
already-correct data looks like on screen.

**1. Highlight scope: each component decorates only the text it
already renders — there is no separate decision about which fields to
highlight.** `event-row.ts` renders severity/title/message today, so
list highlighting only ever touches title/message. `inspector.ts`
renders severity/title/message/stack/tags, so all four text fields get
highlighting there. A match that exists only in an event's stack shows
no highlight in the list (correct — there's no stack text in a row to
highlight) but does once the inspector is showing it. This isn't an
inconsistency to paper over; each component's highlighting scope is a
direct consequence of its existing rendering scope, not a new,
independent policy that could drift out of sync with it.

**2. Three distinct states, not two:**

```text
Store empty                          → "Nothing captured yet."
Store non-empty, Navigation Context
  empty (filter/search excludes
  everything)                        → "Nothing matches the current
                                         filter or search."
Navigation Context non-empty         → render the list normally.
```

**Rejected: one generic "no events" empty state for both cases.**
Conflating them actively misleads in the second case — a developer
staring at "no events" when the Store actually holds hundreds is
exactly the silently-confusing UI the Navigation Context concept was
built to prevent. The two states require different actions (capture
some events vs. loosen a filter), so the message should say which.

**3. Show a match count only when the (unwindowed) Navigation Context
differs from the Store's full contents — not whenever a filter or
search is "active."** This is a deliberately precise trigger, not
"any control has a value": `filters = { categories: [], severities: [] }`
or `searchQuery = ""` are technically "set," but change nothing, and
showing a count in that case would falsely imply narrowing is
happening. The correct condition is a direct comparison —
`navigationContext.length !== store.getAll().length` — tying the
presentation to what actually changed, not to whether a UI control has
been touched.

**Rejected: always show a count.** Adds visual noise to the common,
unfiltered case for a question ("how many am I looking at, out of how
many total") nobody's asking when nothing is narrowing anything.

#### Where highlighting lives: a pure rendering helper, not per-component logic

`event-row.ts` and `inspector.ts` own *that* they highlight and *which*
fields; neither owns substring matching, `<mark>` construction, or
escaping. Those live in one shared function,
`highlightText(text, query)`, that both components call. This buys two
things a duplicated implementation wouldn't: changing the highlight
mechanism (e.g. `<mark>` to a different wrapper element) is a
one-file change instead of an N-component change, and the matching
logic gets one focused test suite instead of being re-verified
per-component.

This is a pure rendering *leaf*, in the same sense `applyFilters()` and
`applySearch()` are — deterministic output from its inputs, no DOM
side effects beyond the fragment it returns, no dependency on Panel,
the Store, or the search engine. It has no idea `applySearch()` exists;
it receives a query string, not a Navigation Context.

**Invariant: highlighting is purely decorative — it never influences
matching.** `applySearch()` alone determines which events are in the
Navigation Context; `highlightText()` only decorates text that's
already going to be rendered, for events already known to match. There
is deliberately no path by which highlighting output feeds back into
search, filtering, or selection. (This is what keeps the two systems
independently testable and prevents a class of bug where, say,
inserted markup accidentally changes what a *later* search considers a
match.)

**Invariant: highlighting preserves text exactly.** Stripping
`highlightText()`'s output back down to plain text (concatenating
every text node's content, ignoring the wrapper elements) must equal
the original input string exactly — no inserted or removed characters,
no whitespace normalization. Highlighting only ever adds decoration
around existing text; it never edits the text itself.

### Keyboard navigation model — Accepted: reuses selectEvent(), traverses the rendered portion of the Navigation Context, stops at ends

The first feature to treat the Navigation Context as an **ordered
sequence to move through**, rather than a set to narrow (Filtering,
Search) or a single member to inspect (Selection). Six decisions.

**1. No separate `focusedEvent` state — arrow keys call the exact same
`selectEvent()` clicks already call.** Selection is single-select with
no draft/commit step (the same reasoning that rejected a Filter
controls "Apply" button); there is no product need for "arrow to
preview, Enter to commit" that a focus/selection split exists to
serve. Introducing one now would immediately raise questions with no
good answer — what happens if filtering removes the focused item but
not the selected one? which one highlights? which one does the
inspector show? — that only exist because of the invented state.
Rejected outright, not deferred.

**2. Traversal scope, precisely worded: keyboard navigation traverses
the currently *rendered* portion of the Navigation Context — not "the
Navigation Context" unqualified, and not "the rendered window" as an
independent concept.** The Navigation Context is still the thing being
navigated, conceptually; today's renderer just exposes only a window
of it (`MAX_RENDERED_EVENTS`). Phrasing it this way leaves room for a
future virtualized renderer (showing a different window without
changing what "navigating" means) without redefining this decision.
Practically: "next"/"previous" only ever move between rows that
actually exist in the DOM.

**3. Stop at the ends — no wraparound.** Pressing "next" on the last
row does nothing (stays put), same for "previous" on the first.

**Rejected: wrapping from last back to first (or vice versa).** Some
list widgets do this, but it risks a silent, disorienting jump — press
"next" enough times and you're back at the top with no signal a loop
happened. Stopping is the less surprising default and trivial to test
(`first + previous → still first`; `last + next → still last`).
Wraparound is easy to add later if it's ever actually missed.

**4. With no current selection, both "next" and "previous" select the
first visible row — not "next selects first, previous selects last."**
There is no current position to move relative to, so falling back to
the first row is the deterministic choice for either direction.
Defaulting "previous" to the *last* row would be asymmetric behavior a
developer has no way to anticipate the first time they press an arrow
key with nothing selected.

**5. Home/End are supported (jump to first/last visible row);
PageUp/PageDown are not.** Home/End cost almost nothing once arrow-key
traversal exists — they're the same "jump to an end" operation arrow
keys already need for the stop-at-ends rule. PageUp/PageDown are
deferred because they depend on scroll-viewport math (how many rows
constitute a "page") that doesn't have a settled answer yet and isn't
needed for Home/End to work.

**6. Traversal is strictly linear — index±1 over the rendered
ordering, never "skip to the next match" or any other semantic
jump.** `ArrowDown` from row N always goes to row N+1 in the rendered
list, full stop. This is deliberately boring, the same way
`applyFilters()`/`applySearch()` are boring: a developer's mental model
of "the list, top to bottom" should never be second-guessed by the
navigation implementation.

#### Scope: navigation is active only while the event list has focus

The Panel must never intercept arrow keys globally — that would steal
keyboard input from the host page, unacceptable for an embedded tool.
Concretely: the event list container is focusable (`tabindex`), and
the keydown listener only acts when focus is currently somewhere
inside that region. The moment focus moves to the search box, the
inspector, or outside the Panel entirely, arrow keys stop navigating
events and do whatever they'd otherwise do (e.g. move the text cursor
in the search box). This is also the first concrete answer to
ADR-0008's originally-deferred "appropriate accessibility semantics for
a live, updating list" intent — a roving-focus-adjacent pattern, not a
global keyboard shortcut.

#### Where scrolling lives: an internal consequence of selection, not a new public method

Keeping the selected row visible on screen is necessary once keyboard
navigation exists (arrowing past the visible viewport with nothing
scrolling into view would be unusable) but is deliberately **not** a
new method on `Renderer`. `setSelectedRow()`'s public contract is
unchanged; internally, after applying the `data-selected` highlight, it
calls a private helper that scrolls the row into view if needed.
Scrolling is a *consequence* of selection, not part of what selection
*means* — keeping it as an internal implementation detail means future
changes (scroll only if outside the viewport vs. always scroll to a
fixed position, an animated scroll, etc.) never touch the public API
or any caller.

#### Filter/Search interaction: no new rule needed

The existing Selection persistence rule (Selection model, above)
already fully covers this: a keyboard-selected event is retained if
still present in the Navigation Context, cleared if a filter or search
change excludes it. Keyboard navigation doesn't add a new rule here,
it inherits this one for free — worth stating explicitly so it isn't
left as an unstated assumption.

### Pause/Resume/Clear/Export model — Accepted: operational layer, not a rendering layer; viewport-freeze pause; Store-scoped export

Everything decided above (Presentation, Selection, Filtering, Search,
Keyboard Navigation) answers *which events the developer sees and how
they move through them*. This phase answers a different question:
*what control does the developer have over the stream itself?* Four
sub-decisions, recorded together because — like Filtering and Search —
they only cohere as a set, plus one constraint that governs all four.

**0. Constraint that shapes everything below: this is Panel-only
behavior. The Store, the Navigation Context pipeline, and the Renderer
do not change.**

- **Store stays exactly what it is today: retain events, notify
  subscribers.** It must not learn about pause, panels, or export.
  Anything upstream of the Panel (Runtime, Console, future Network,
  the Bus, the Store) keeps running regardless of what the Panel is
  doing — the same "Plugin independence" constraint already recorded
  above extends naturally to this phase.
- **No parallel pipeline.** There is no "paused Navigation Context" or
  "paused Store." `Store → applyFilters() → applySearch() → window() →
  Renderer` remains the one pipeline. Pause changes *when* the Panel
  chooses to run that pipeline, never what it computes.
- **Renderer stays exactly as dumb as it already is.** It has no
  concept of paused/resumed/exporting/clearing; it renders whatever
  `renderEventList()`/`renderInspector()` are called with, same as
  today.

This mirrors the Filtering model's Store-as-read-only constraint and
the Panel state model's "renderer knows nothing about selection
ownership" — the same seam discipline, applied to a fourth kind of
Panel-local state.

> **Operational invariant (stated once, prominently, precisely because
> it's easy to erode by accident later):** while paused, a developer
> can still filter, search, inspect, navigate, clear, and export.
> **Only automatic Store-driven refreshes stop.** Nothing about pause
> disables an explicit action. A future change that makes any of
> `setFilters()`/`setSearchQuery()`/`selectEvent()`/`clear()`/
> `exportEvents()` check `isPaused()` would be silently widening pause
> into "freeze the whole Panel" — a different, unreviewed feature — and
> should be treated as a regression against this invariant, not a
> reasonable extension of it.

**1. Pause semantics: pause freezes the Panel's *viewport*, not the
Store's *capture*.** Runtime, Console, and the Store continue exactly
as before while paused — events keep arriving and keep being retained,
up to the Store's own limits. What changes is narrower: the Panel's
Store-subscription callback stops re-deriving and re-rendering the
Navigation Context in response to each new-event notification.

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
  filters: FilterState;
  searchQuery: string;
  isPaused: boolean;
}
```

(Same caveat as every prior state-shape sketch in this document —
illustrative, not a commitment to a literal object over closure
variables.)

**Rejected: pause stops capture (e.g. by unsubscribing the Runtime/
Console plugins, or telling the Bus to stop dispatching).** This would
mean pausing DevLens changes what the *application* does, not just
what the *panel shows* — a diagnostics tool silently dropping events
while "paused" is actively dangerous: the exact error a developer
paused to go read could be followed by three more that never get
captured. Framed the way the brief put it: pause means "stop
refreshing the viewport," not "stop recording."

**API shape: `pause()` / `resume()`, not `setPaused(boolean)`.**
Matches the existing verb-pair lifecycle style already established by
`install()`/`uninstall()`. A boolean setter invites the question "is
calling it twice with the same value a no-op or an error?"; `pause()`
answers that by construction — both methods are idempotent (pausing
an already-paused Panel, or resuming an already-running one, is simply
a no-op beyond whatever `resume()`'s explicit resync does).

**State visibility: a synchronous `isPaused()` query, not a
subscription/observer seam.** Something needs to answer "is the Panel
currently paused?" so a future Pause/Resume control can render the
right label — but this is a narrow, one-off read, not a reason to
introduce a general `onStateChange()`-style observation mechanism.
`isPaused: boolean` is Panel-owned state (per the constraint above);
exposing a way to *read* it doesn't move ownership anywhere, the same
way `store.getAll()` lets you read Store state without the Store
becoming reactive. A broader state-observation API is a real
architectural step this project hasn't needed yet and shouldn't invent
speculatively here — same discipline as everywhere else in this
document.

**2. The pause check lives in exactly one place: the Store-subscription
callback.** `setFilters()`, `setSearchQuery()`, and `selectEvent()` are
explicit developer actions and always run against the current Store
snapshot, whether or not the Panel is paused — a developer who tightens
a filter while paused expects to see the up-to-the-moment matching
events, not a stale pre-pause snapshot re-filtered. Only the automatic
path — "a new event arrived, re-derive and re-render" — is what pause
suppresses. This is the same "don't reapply a rule outside the context
it was written for" reasoning already used once in this document (see
Panel state model, above, on selection vs. Store re-renders): pause is
a statement about *automatic* refresh, not about *all* rendering.

**3. Resume performs exactly one explicit resync — no replay.** On
resume, the Panel reads `store.getAll()` once, recomputes the
Navigation Context (filters → search → window), and renders once. There
is no event-by-event catch-up and no animation. Events that arrived
while paused become visible all at once, in their normal position,
exactly as if the Panel had been rendering the whole time and the
developer just hadn't scrolled to look.

**Rejected: buffering paused events for a replay/catch-up sequence.**
Nothing about DevLens's model treats event arrival as something to
dramatize — the Store is already the durable record. Building a replay
mechanism would be exactly the kind of speculative complexity this
project rejects by default (the `assert.ts`/`now()` precedent); nothing
today demonstrates a developer wants to watch events "catch up" rather
than simply see the current state.

**4. Clear is Panel-initiated and Panel-refreshed, because
`store.clear()` does not call `notify()`.** This was already flagged as
a fact (not a bug) during Session 4 implementation: only `add()`
notifies subscribers today, and changing that is explicitly out of
scope — Store stays untouched per the constraint above. Clear is
therefore implemented as an explicit two-step Panel action, not a
"call clear and let the subscription pick it up":

```text
panel clear()
  → store.clear()
  → refresh()   (same recompute-and-render the subscription callback
                 would normally do — called directly, since no
                 notification will arrive to trigger it)
```

`refresh()` runs unconditionally here, even if the Panel is currently
paused — Clear is an explicit developer action (like `setFilters()`),
not an automatic Store-driven update, so the same reasoning from
decision 2 applies: pause only suppresses the *automatic* path.

**Consequence, not a new rule:** clearing empties the Navigation
Context, which means a currently-selected event (if any) is no longer
part of it. The existing Selection persistence rule already covers
this — selection clears because the event is excluded from the
navigation context, the same as a filter excluding it. No special case
needed.

**5. Export is Store-scoped, not view-scoped, and is a plain
`DevLensEvent[]` JSON array — no wrapper object.** Export answers "give
me this session's data," not "give me what I'm currently looking at";
it deliberately ignores the current filters, search query, and
selection, per the "Implications to preserve" note already recorded
under the Presentation model above. Concretely:

```text
store.getAll()  →  serializeEvents()  →  string
```

**Export vs. download is a real seam, not one step.** `panel.ts`
exposes `exportEvents(): string` — it returns serialized session data
and stops there. Turning that string into an actual downloaded file
(`Blob`, `URL.createObjectURL`, a programmatically-clicked
`<a download>`) is a browser-presentation concern, not something the
Panel's data layer should own — the same reasoning that keeps
`applyFilters()`/`applySearch()` free of DOM, extended one layer
further. The download mechanics live in the controls component (see
Session controls model, below), which calls `panel.exportEvents()` and
does the rest.

**Rejected: exporting the current Navigation Context instead of the
full Store.** A developer sharing a bug report wants the whole session,
not an accidental subset determined by whatever filter they happened
to leave active. Filters and search are navigation aids for the live
UI; they have no business silently truncating an export artifact.

**Rejected (for now): a wrapped format with session metadata (export
timestamp, DevLens version, event count).** This is exactly the
"building for a future consumer that doesn't exist yet" pattern this
project has rejected before (`RuntimePlugin` type alias, `assert.ts`) —
nothing today reads an exported file back in, so there's no concrete
need a wrapper would serve yet. A raw array is the smaller, sufficient
artifact; if/when Import is designed, wrapping (and the versioning
questions that come with it) becomes that feature's decision to make,
not one to guess at now on Export's behalf.

**Import is explicitly out of scope for this phase** — reconfirming
the existing Non-goal; no abstraction is being introduced here to
anticipate it.

### Session controls model — Accepted: a dedicated `session-controls.ts`, not an expansion of the toolbar

Mirroring the Search controls model's "its own component, not folded
into the toolbar" decision, Pause/Resume, Clear, and Export get their
own controls component, separate from `toolbar.ts` (filtering) and
`search-box.ts` (search). All three are, in the broad sense, "controls
that call a Panel seam and nothing else" — but they drive three
different Panel behaviors (`pause()`/`resume()`, `clear()`,
`exportEvents()`) that have nothing to do with filtering or search.
Folding them into `toolbar.ts` would start that file down the path
every UI project eventually regrets: "just one more button" today,
an unrelated-responsibility grab-bag in six months. Keeping filtering,
search, and session operations as three separate, single-purpose
components is the same discipline already applied twice.

`session-controls.ts` follows the exact mounting pattern already
established for the toolbar and search box: created and appended to
`overlay.shadowRoot` by `panel.ts`, before `createRenderer()` is
called, so it lands in DOM order alongside its siblings.
`createRenderer()` remains unaware it exists — same as the other two.

This introduces a fifth ShadowRoot region (toolbar, search, session
controls, event-list, inspector). Every prior region of this kind —
the toolbar (Session 5) and the search box (Session 6) — got its own
short ADR-0008 amendment recording the region and the mounting
decision, even though neither was a large architectural shift in
isolation; the amendments exist because ADR-0008 is where this
project's ShadowRoot region structure is documented end to end, and
letting one region diverge from that record undermines the reason the
prior two amendments were written at all. This phase gets the same
treatment — see ADR-0008's Session 7 amendment.

#### Summary of what does *not* change

Worth stating plainly, since this phase's whole shape is "prove the
architecture absorbs this without new layers":

- `EventStore`'s public contract: unchanged.
- The `Store → applyFilters() → applySearch() → window() → Renderer`
  pipeline: unchanged.
- `Renderer`'s contract (`renderEventList`, `renderInspector`,
  `setSelectedRow`): unchanged.
- Selection, Filtering, and Search's own rules: unchanged, and not
  special-cased for pause.

## User stories

As a developer using an app with DevLens embedded...

- ...I want to click an event row and see its full stack trace, so I
  can find the failing line without opening devtools.
- ...I want to see an event's `metadata`/`context`/`tags`, so I can
  understand what the plugin captured beyond the summary line.
- ...I want to narrow the event list to a specific category or
  severity, so I'm not scrolling past noise to find what I care about.
- ...I want to search event text, so I can find a specific error
  message in a long session.
- ...I want to pause capture, so the list stops scrolling while I read
  something.
- ...I want to export the current session as JSON, so I can share a
  bug report without asking someone to reproduce it live.

*(To be expanded/refined during Session 4 design discussion — this is
a starting set, not exhaustive.)*

## Open questions

None remain from the original Session 4 sequence — Pause/resume
semantics and Export semantics are now decided (see Pause/Resume/
Clear/Export model, above). Import's own open questions (format
validation, versioning) are deliberately not pre-answered here; they
belong to whichever future session actually designs Import.

## Constraints

Derived from existing ADRs, not up for revisiting casually:

- **Shadow DOM isolation** (ADR-0008) — any new UI (drawer, toolbar,
  search input) mounts inside the existing Panel's Shadow Root, not as
  a separate host element.
- **Vanilla DOM, no framework** (ADR-0008) — inspection UI follows the
  same incremental-DOM-update approach already used for event rows.
- **Store as read-only for Panel** (ADR-0004, ADR-0008) — Panel/
  inspection reads from `EventStore`, never mutates it or introduces a
  parallel state store for the "same" data.
- **Plugin independence** — none of this should require Runtime or
  Console to change; inspection operates entirely on data already in
  `DevLensEvent`.
- **Rendering performance** — `MAX_RENDERED_EVENTS` and the "renderer
  owns the whole ShadowRoot" limitation (ADR-0008) are known
  constraints inspection will likely bump into; see the flagged items
  in ADR-0009's Consequences section. Resolving the ShadowRoot/renderer
  container split is expected to become its own ADR-0008 amendment
  once inspection's actual DOM structure is designed — not something
  to decide inside this spec.

## Proposed milestones

Rough phases, not commitments — sequencing may change if later Open
Questions surface something that forces revisiting an earlier phase:

- **Phase 1 — unblocked, ready for implementation.** Presentation,
  Selection, and Panel state model are all decided (see Session 4
  decisions above). Persistent inspector region, single-selection via
  delegated click handling, targeted (not full-list) re-render on
  selection change, full event data shown (stack/metadata/context/tags).
- **Phase 2 — complete.** Filtering model and Filter controls model
  are both decided and implemented (see Session 4 decisions above):
  faceted category/severity filters (AND across dimensions, OR
  within), hide (not de-emphasize) non-matching events, Panel-local
  filter state, filter-before-window against the Navigation Context,
  and a checkbox-group toolbar above the event list that calls
  `setFilters()` and nothing else.
- **Phase 3 — complete.** Search model, Search controls model, and
  Search presentation model are all decided and implemented (see
  Session 4 decisions above): title/message/stack/tags scope, trimmed
  case-insensitive substring match applied after Filtering, a
  dedicated search-box component (no debounce), highlighting via a
  shared `highlightText()` leaf scoped to whatever each component
  already renders, three-state empty messaging (Store empty / Navigation
  Context empty / normal), and a match count shown only when the
  Navigation Context diverges from the Store's full contents.
- **Phase 3.5 — decided, ready for implementation.** Keyboard
  navigation model is decided (see Session 4 decisions above): arrow
  keys reuse `selectEvent()` directly (no separate focus state), linear
  traversal of the rendered portion of the Navigation Context, stop at
  ends (no wraparound), no-selection defaults to the first visible row
  for either direction, Home/End supported, active only while the
  event list has focus, scrolling handled internally by
  `setSelectedRow()` with no public API change.
- **Phase 4 — decided, ready for implementation.** Pause/resume/clear/
  export model is decided (see Pause/Resume/Clear/Export model, above):
  pause freezes the Panel's automatic re-render on new-event
  notifications while Store capture continues unaffected; explicit
  developer actions (`setFilters`, `setSearchQuery`, `selectEvent`,
  `clear`) always run live regardless of pause state; resume performs
  one explicit recompute-and-render with no replay; clear explicitly
  calls `store.clear()` followed by an explicit refresh (since
  `store.clear()` doesn't notify); export serializes the full Store
  (`store.getAll()`) as a raw `DevLensEvent[]` JSON array, ignoring
  current filters/search/selection. Import remains out of scope.

## Future extensions

Noted for later, explicitly out of scope now:

- Multi-event comparison / diffing.
- Saved filter presets.
- Timeline/waterfall view (likely belongs to Network capture, not this
  spec).
- A floating trigger + expand/collapse toggle for the whole Panel
  (show/hide the entire overlay, not any one region within it). Carried
  over from ADR-0008's original Non-goals (v1) list; previously tracked
  only in a stale code comment in `overlay.ts`, moved here during the
  post-v0.3.0 review pass so it has one real home.
- PageUp/PageDown for keyboard navigation — deferred pending settled
  scroll-viewport/"page size" semantics; Home/End cover the common
  jump-to-end cases without needing this.
- Wraparound for keyboard navigation (next past the last row jumps to
  the first, or vice versa) — deliberately rejected for v1 in favor of
  stopping at the ends; revisit only if this is actually missed in
  practice.
