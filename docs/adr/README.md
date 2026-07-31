# Documentation structure

DevLens splits project documentation into three layers, each answering
a different question:

```text
ADRs            answer "Why?"
Specifications  answer "What?" and "How?"
Implementation  answers "Exactly how, in code?"
```

## `docs/adr/`

Architecture Decision Records. Long-lived, rarely-revisited decisions
about the system's shape: package boundaries, ownership between
Runtime/Console/Store/Panel, the Plugin contract, Shadow DOM isolation,
event versioning, public API philosophy.

An ADR should still be true years from now unless something concrete
forces a reversal. If a decision is likely to be revisited during
normal iteration (a component's internal state shape, a drawer vs. a
modal, a toolbar layout), it does not belong here — see `docs/specs/`
instead.

Note: ADR-0008 (Panel) predates this distinction and mixes
architecture with implementation detail (package tree, exact
interfaces, constants). That wasn't a mistake — there was nowhere else
to put that content at the time — but it's not the pattern to follow
going forward. New ADRs should stay closer to "why" than ADR-0008 did.

## `docs/specs/`

Specifications for a feature area's problem space: purpose, goals,
non-goals, user stories, constraints inherited from relevant ADRs, and
explicitly open questions. A spec should guide implementation without
pretending to have decided every implementation detail in advance —
genuinely open questions should stay open until a real design
discussion resolves them, not get quietly settled by whoever writes
the document.

## Implementation

Code, plus inline comments and TODOs for anything narrow enough that
it doesn't need its own doc. Package-level structure/API decisions
that used to live inline in an ADR (see ADR-0008's "Package structure"
section) can live here going forward instead.

## Why this split exists

It keeps the ADR collection trustworthy. An ADR that gets casually
revised every time a UI detail changes stops being a reliable record
of "this was decided and why" — contributors need to be able to trust
that an ADR still reflects reality without re-reading the whole
history. Specs are allowed to be more disposable; ADRs are not.
