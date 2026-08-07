# 0010: Network Plugin

## Status

Accepted — drafted from `docs/research/network-capture.md`, reviewed,
and revised through one editorial pass. The "Decision" section below
is what's settled; the "Open questions" section is deliberately not
decided by this ADR and should not be treated as settled just because
it appears in an Accepted document.

## Context

Runtime and Console both observe something that happens once —
`bus.report()`, done. Network requests have a duration: they start,
time passes, and only later do they succeed, fail, time out, or get
aborted. `docs/research/network-capture.md` exists specifically because
that mismatch had to be resolved deliberately, not inherited by
accident from how Runtime and Console happened to work. That research
surveyed OpenTelemetry, the Resource Timing API, Sentry, Datadog RUM,
Chrome DevTools, and Mock Service Worker, evaluated three candidate
designs against DevLens's own existing ADRs (not general best
practice), and stress-tested the result against concrete scenarios.
This ADR records what that process converged on.

## Decision

### Semantic unit of observation: one event, reported on completion

A network request produces exactly one `DevLensEvent`, reported when
the request settles (succeeds, fails, times out, or is aborted). A
redirect chain is represented as one completed network operation, not
one event per hop; nor is this a start event paired with a separate end
event, nor a mutable event updated in place. An in-flight request
produces no event until it settles; if it never settles (a hung
connection) or the page is torn down first, no event is ever reported
for it — consistent with DevLens observing completed operations rather
than transport state, and an accepted, understood gap (see "What this
doesn't give us," below), not an oversight.

This was decided principally on the evaluation in the research
document's "Architectural evaluation" section: it's the only one of
the three candidates considered that requires no changes to Core
(events stay immutable per ADR-0001/0002, the Store stays append-only
per ADR-0004), asks nothing of the Panel beyond what it already does
for Runtime/Console, and doesn't leak any request-correlation concept
into Export or a future Import. The other two candidates (two
correlated start/end events; a mutable event updated in place) were
considered and are not being carried forward — seeing them written out
in full is in the research document if that reasoning needs revisiting
later, but they are not being kept as live options here.

### Interception mechanism: monkey-patch `fetch` and `XHR`, directly

Both `fetch` (the global function) and `XMLHttpRequest.prototype`
(`open`/`send`) are wrapped directly. `uninstall()` restores the
original references — same idempotent install/uninstall shape as
every other plugin (see "Network is still a Plugin," below).

This is a deliberate, acknowledged departure from Runtime's own stated
principle of never overwriting a global the host app might be using
(ADR-0005) — forced by the absence of any event-based alternative:
neither `fetch` nor `XHR` exposes an `addEventListener`-style hook the
way `window.error` did. A Service Worker–based alternative was
considered and is explicitly not being used for v1: it's framed by
tools that use it (MSW) as more principled specifically because it
avoids patching globals, but MSW's own documented limitations page
states Firefox does not notify a Service Worker of `XMLHttpRequest`
calls at all — a documented cross-browser reliability gap, for exactly
the API (XHR) this plugin needs to intercept. Every comparable
*observation* tool surveyed (Sentry, Datadog RUM, `@mswjs/interceptors`
in Node) patches directly rather than using a Service Worker; MSW's own
Service Worker use case is mocking, not observing, and isn't a directly
comparable precedent.

Timing is captured directly by the interceptor (a timestamp
immediately before delegating to the original `fetch`/`send`, and
again when the promise/event fires) rather than read from the
`PerformanceResourceTiming` buffer after the fact — cross-origin
Resource Timing entries are mostly zeroed out without an explicit
`Timing-Allow-Origin` response header, and correlating buffer entries
back to a specific call by URL alone is unreliable for anything not
guaranteed same-origin.

### Data captured by default: method, URL, status, duration, outcome — nothing else

v1 captures method, URL, HTTP status (when available), duration, and
an explicit `outcome`. **Headers and request/response bodies are not
captured, and there is no v1 configuration to opt into capturing
them.** Query parameter *values* are redacted by default
(`?token=***`), while parameter *names* are preserved — stripping the
whole query string would throw away real diagnostic value (which
parameters were even sent), while keeping values by default is the
wrong default for anything that might carry a token or PII. This
mirrors what every comparable tool surveyed does by default (Sentry
and Datadog both make headers/bodies opt-in; OTel's own HTTP
conventions treat query-value redaction as a first-class default, not
an afterthought) — but the deciding reason is DevLens's own trust
model, not imitation: Console captures things a developer already
chose to log; Network would capture things an application never
intended to expose in a diagnostics overlay. That's a different trust
boundary, and v1 draws it conservatively on purpose.

One consequence worth stating explicitly, because it resolves a
question that might otherwise look like a separate judgment call:
since response bodies are never read, Network cannot know and does not
report whether application code parsing that body (`response.json()`
throwing on a malformed payload, for instance) succeeded — a received
HTTP response is `success` regardless of what the application does
with it afterward. A parsing failure the application doesn't catch
becomes Runtime's `unhandledrejection`, with no coordination required
between the two plugins.

### Outcome: an explicit field exists; its exact values are not finalized here

Network events carry an `outcome` describing what actually happened,
kept as a separate concept from `severity` (DevLens's existing
`EventSeverity` union) — `outcome` is a factual classification
(`http-error`, `aborted`, etc.); `severity` is an interpretation
layered on top, and the two don't map one-to-one (a `404` on an
optional prefetch and one on a page's critical data fetch are the same
`outcome` with arguably different `severity`; an `aborted` outcome is
often not an error in the developer's eyes at all). This was motivated
by three independent sources converging on the same complaint —
OpenTelemetry's spec explicitly treats cancellation as distinct from
failure, and both Sentry's and Datadog's own issue trackers have real,
independent user complaints about an ambiguous `status: 0` collapsing
aborted/timeout/network-error/CORS-block into one indistinguishable
signal.

The research document's candidate sketch proposed
`success | http-error | network-error | aborted | timeout` as a
starting shape. That sketch is a strong, well-reasoned starting point,
not a locked schema — see "Open questions," below. Worth noting as a
real browser-API constraint rather than a DevLens gap: XHR has native,
distinct `timeout`/`abort` events, so its outcome is reliably
classifiable; `fetch()` only produces a distinguishable `TimeoutError`
if the calling code uses the newer `AbortSignal.timeout()`
specifically, and falls back to an ambiguous `AbortError` for the
still-common `setTimeout(() => controller.abort(), ms)` pattern.
Whatever the final enum, this asymmetry needs to be documented as a
best-effort distinction for `fetch`, not a guarantee.

### Network is still a Plugin

The `Plugin` contract (ADR-0006) — `install()`/`uninstall()`, both
idempotent — says nothing about *how* a plugin captures data.
Runtime's `install()` attaches listeners; Console's wraps five console
methods; Network's wraps `fetch`/`XHR` and restores them on
`uninstall()`. The mechanism scales in how invasive it is across those
three; the contract behind it does not change. Network is not a new
category of thing requiring new infrastructure — it consumes Core's
public API exactly like every other plugin, and is expected to be as
self-contained as Runtime and Console are: its complexity (interception,
outcome classification, redaction) stays inside `@devlens/network` and
is not expected to leak into Panel, Export, or any other package.

### Panel requires no changes

A Network event is expected to render through the exact same
`renderEventList()`/`renderInspector()` contract Runtime/Console
events already use, with no Network-specific code anywhere in
`@devlens/panel`. This isn't a new claim being made here — the
Inspector was explicitly designed during Session 4 with generic
key-value rendering and no hardcoded knowledge of event categories,
specifically so that a future category could "render with zero
Inspector changes later." This ADR is the point where that design bet
actually gets tested; if it turns out Panel *does* need changes to
render Network events well, that's a real finding worth its own
amendment, not something to route around silently.

## Scope: v1 boundary

| In scope for v1 | Deferred, not rejected |
|---|---|
| Fetch API | WebSocket |
| XMLHttpRequest | Server-Sent Events |
| success / http-error / network-error / aborted / timeout (draft shape — see Open questions) | Streaming response bodies |
| Method, URL (query values redacted), status, duration | Request/response headers |
| | Request/response bodies |
| | Service-Worker-intercepted requests |
| | Response `Content-Type`/size without the body itself |
| | `redirect: "manual"` (surfacing intermediate redirect hops) |

## Open questions (not decided by this ADR)

- **URL identity / normalization.** Whether `/users/123` and
  `/users/456` should ever collapse into one conceptual endpoint, and
  whether that's DevLens's decision to make automatically or (per
  Sentry's precedent) an opt-in hook the host app configures with its
  own route knowledge. Undecided; the raw URL is shown as a safe
  default until this is resolved.
- **Exact `outcome` enum values.** The draft five-value shape above is
  a strong starting point, not final.
- **Severity mapping per outcome.** Deliberately decoupled from
  `outcome` itself (see Decision, above) and not decided here.
- **Redirect manual mode.** Whether v1 should opt into
  `redirect: "manual"` to deliberately surface intermediate redirect
  hops as separate events, versus the default behavior (where a
  redirect chain is already invisible to the interceptor as anything
  but one final request, requiring no extra design to get "one event
  per chain"). Leaning toward not doing this for v1, not decided.
- **Response `Content-Type`/size without the body.** Arguably
  lower-risk than full body capture; not researched yet.
- **Uninstalling the Network plugin mid-request.** Whether an
  in-flight request whose completion callback fires after
  `uninstall()` needs special handling, or whether it should simply
  produce no event — matching Runtime/Console's existing
  idempotent-uninstall behavior. Leaning toward the latter, not
  argued for here.

## What this doesn't give us

Stated plainly rather than left implicit: **Candidate A cannot show a
request that is currently in flight, and if a request hangs forever
without the tab closing, the Panel will show no trace of it, ever.**
This is a real, acknowledged capability gap, not a rounding error, and
nothing in the research or this ADR closes it — the two-correlated-
event alternative that could narrow it was evaluated and is not being
carried forward, on the grounds that its cost (leaking a correlation
concept into Panel, Export, and any future consumer) outweighs a gap
nothing so far suggests any DevLens user has actually hit. If that
changes, it's a reason to reopen this section specifically, not a
reason this ADR was wrong to accept the trade today.

## Consequences

- `@devlens/network` becomes the first DevLens package whose
  `install()` modifies globals rather than only listening to them —
  worth calling out in that package's own documentation, not just
  buried in this ADR.
- No other package needs to change to support Network's first release.
  If implementation reveals otherwise, that's a signal worth treating
  as a real finding (see "Panel requires no changes," above) rather
  than quietly working around.
- The next capture source after Network inherits a Plugin/mechanism
  distinction that's now explicit rather than assumed, and inherits
  Network's own precedent for how much interception invasiveness is
  acceptable inside `install()`.

## References

- `docs/research/network-capture.md` — the full survey, tradeoffs, and
  stress-testing this ADR is drawn from.
- ADR-0001/0002 (event immutability), ADR-0004 (append-only Store),
  ADR-0005 (Runtime — the "don't overwrite globals" principle this ADR
  deliberately departs from and explains why), ADR-0006 (Plugin
  contract).
