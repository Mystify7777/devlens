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
_observation_ tool surveyed (Sentry, Datadog RUM, `@mswjs/interceptors`
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
them.** Query parameter _values_ are redacted by default
(`?token=***`), while parameter _names_ are preserved — stripping the
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
idempotent — says nothing about _how_ a plugin captures data.
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
actually gets tested; if it turns out Panel _does_ need changes to
render Network events well, that's a real finding worth its own
amendment, not something to route around silently.

## Scope: v1 boundary

| In scope for v1                                                                             | Deferred, not rejected                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Fetch API                                                                                   | WebSocket                                                   |
| XMLHttpRequest                                                                              | Server-Sent Events                                          |
| success / http-error / network-error / aborted / timeout (draft shape — see Open questions) | Streaming response bodies                                   |
| Method, URL (query values redacted), status, duration                                       | Request/response headers                                    |
|                                                                                             | Request/response bodies                                     |
|                                                                                             | Service-Worker-intercepted requests                         |
|                                                                                             | Response `Content-Type`/size without the body itself        |
|                                                                                             | `redirect: "manual"` (surfacing intermediate redirect hops) |

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

## Amendment (Issue #17): URL contract — a bug fix, a resolved question, and a question that stays open

This amendment does three distinct things, kept deliberately separate
because they're different in kind and were at risk of being read as
one undifferentiated "URL work":

### 1. A correction, not a decision: query-value redaction was never implemented

The Decision section above states, and has stated since this ADR was
Accepted, that "Query parameter values are redacted by default
(`?token=***`), while parameter names are preserved." Issue #17's
investigation found this was never actually built — `resolveRequestDescriptor()`
(fetch) and `open()`'s descriptor capture (XHR) both passed the raw,
unredacted URL straight through, and `types.ts`'s own doc comment
("Already redacted by the capture layer") and a normalizer test
("preserves the URL exactly — no redaction happens here") both
asserted a behavior that didn't exist. This is not a new architectural
decision — the decision was already Accepted, above — it's a
correction of an implementation gap against it, and is treated as a
bug fix rather than something requiring fresh justification.

Every non-empty query parameter value is now replaced with `***`;
parameter names are always preserved. A parameter with no value at all
(`?debug`, a common flag pattern) is left empty rather than forced to
`***` — there is nothing to redact, and marking it anyway would
misrepresent an already-empty value as hidden data. This refinement
wasn't specified in the original Decision text and is recorded here as
the concrete rule that text implies.

### 2. Newly resolved: canonical URL semantics (previously an Open question)

The "URL identity / normalization" open question above is resolved,
in part: `url` now means the request's **canonicalized, redacted**
form — one representation, not the raw byte-exact input and not two
parallel fields. Canonicalization is: parse via `new URL(raw, base)`
(`base` is `document.baseURI`, matching how the browser itself
resolves both a relative `fetch()` string argument and XHR's `url`
argument), clear the fragment, and read back `.href`.

This is safe to do automatically, with zero application-specific
route knowledge, because every individual transformation it performs
is either browser-spec-guaranteed or a documented, verified web
platform fact, not a DevLens judgment call:

- **Scheme and hostname are lowercased** — the WHATWG URL parser's own
  normative parsing/serialization behavior, not something this package
  computes itself. Verified empirically (`new URL("HTTPS://API.Example.COM/Path").href`
  → `"https://api.example.com/Path"`) — note the path segment's own
  casing is untouched, correctly, since path casing is meaningful and
  the URL spec never normalizes it.
- **Unsafe literal characters get properly percent-encoded** when
  parsed (a literal space in the input becomes `%20`, for instance).
  This is real, deterministic encoding of unsafe input, not
  normalization of encoding that's already present — verified
  empirically that already-percent-encoded sequences are left
  completely untouched by `.href` (`%61` does not become `a`, and
  `%2f` does not become `%2F`). An earlier draft of this amendment
  claimed the parser also canonicalizes existing percent-encoding;
  that claim was wrong (conflated with a third-party URL library's own
  explicit `.normalize()` step, not native `URL` behavior) and is
  corrected here rather than left in place.
- **The default port for the URL's scheme is omitted** — confirmed
  directly against MDN's `URL.port` documentation (empty string is
  returned, and the port doesn't appear in `.href`, whenever the port
  matches the scheme's default: 80/http, 443/https, 80/ws, 443/wss,
  21/ftp).
- **The fragment is cleared explicitly, not left to chance.** Verified
  against real browser bug history (Mozilla bug 1110476, WebKit bug 160593) that the Fetch spec requires `Request`/`Response` URL
  getters to strip the fragment automatically, on the grounds that a
  fragment is by definition never transmitted to the server as part of
  an HTTP request — reporting one in a _network request_ event would
  describe something that was never sent. This was previously
  inconsistent in this package's own code: `resolveRequestDescriptor()`
  only got fragment-stripping for free when the caller passed a
  `Request` object (because `Request.url` already strips it per spec);
  a plain string argument (`fetch("/x#y")`) kept the fragment, since no
  parsing was ever applied to that branch. Explicit `.hash = ""`
  removes this inconsistency rather than continuing to depend on which
  overload of `fetch()`'s first argument a caller happened to use.

**Trailing slashes are deliberately not touched** — `/users` and
`/users/` are not asserted equivalent anywhere in the URL spec, and
treating them as the same requires knowing whether a given
application's router treats them as the same, which is exactly the
kind of application-specific knowledge this section's other four
transformations don't require. This stays exactly as undecided/unsafe
as path-parameter grouping, below — it's a routing-semantics question,
not a syntactic one.

Two small, accepted syntactic side effects of implementing this via
`URL`/`URLSearchParams` rather than raw string manipulation, worth
naming so they're not mistaken for bugs later: `URLSearchParams`
serializes spaces as `+` (the `application/x-www-form-urlencoded`
convention) even if the original query string used `%20`; and it does
not distinguish a bare flag (`?debug`) from an explicit empty value
(`?debug=`) — both round-trip as `debug=`. Both are syntactic
equivalence classes, not semantic changes, and match the same
"safe because it's spec-level, not app-level" reasoning as everything
else in this section.

### 3. Still open, restated rather than silently dropped: application-specific endpoint identity

Whether `/users/123` and `/users/456` (or `/products?page=1` and
`/products?page=2`) should ever collapse into one conceptual endpoint
remains **undecided, on purpose** — Issue #17's investigation did not
find a second real consumer for this (checked Panel, Export, and
Import; none group, aggregate, or otherwise treat multiple URLs as one
logical thing today), which is the same bar every other deferred
abstraction in this project has been held to. Per Sentry's own
precedent (already cited in the original research this ADR draws
from), if this is ever built, it should be an explicit, host-app-
configured hook using the application's own route knowledge — DevLens
inferring route templates automatically was never a live option and
still isn't. This section of the original Open questions list is not
resolved by this amendment; it's restated so a future reader doesn't
mistake "the ADR got a URL amendment" for "the endpoint-grouping
question got answered too."

### Compatibility

`CapturedRequest.url` and the reported event's `metadata.url` remain a
plain string — no shape/type change, so `@devlens/panel`'s Import
schema validation (which checks field shapes, not the semantic content
of a string) needs no changes. Only the _value_ changes going forward:
newly captured events are canonicalized and properly redacted;
previously exported sessions containing the old, unredacted/
uncanonicalized values remain valid to import, the same as any other
bug fix — DevLens doesn't retroactively rewrite historical data, and
nothing about Session Import's contract asked it to.

### What this amendment does not touch

No changes to Core, `@devlens/panel`, Export, or Import. No changes to
`network.ts`, `types.ts`, or `network-normalizer.ts` — all three
already documented (accurately, as it turns out, just not truthfully
about the implementation) that redaction and URL decisions happen
upstream in the capture layer; this amendment is what makes that
already-stated architecture true, not a change to it. Outcome
classification, severity mapping, redirect-hop handling, and Content-
Type/size capture — every other Open question above — are unaffected
and remain exactly as open as before this amendment.

## Amendment (Issue #18): response metadata contract — `contentType` and `contentLength`

This amendment resolves the "Content-Type/size capture" question the
Issue #17 amendment above explicitly left open. It adds two fields to
`CapturedRequest` and the reported event's `metadata`.

### `contentType: string | null`

The raw, unmodified `Content-Type` response header value, including
any parameters (e.g. `charset=utf-8`). Not parsed into a separate
MIME-type/charset structure, not case-normalized. This matches how
every other captured value in this package is treated (`method`,
`outcome`) — raw, minimally processed — and preserves real diagnostic
value a parsed representation would discard (an unexpected charset is
sometimes the actual thing someone is debugging).

### `contentLength: number | null`

The non-negative decimal integer represented by the `Content-Length`
response header, exposed as a number only when it can be represented
exactly as a JavaScript safe integer. Otherwise `null`.

**This is not a measurement of decoded response-body size or
browser-observed network transfer size.** It is metadata the response
supplied, nothing more. Two independent reasons it can diverge from
"how many bytes the body actually was" once decoded by the browser:
Content-Encoding (e.g. `gzip`) means the header describes the
_encoded_ representation's size, not the decoded size the browser
transparently hands back to application code — RFC 9110 §8.6 confirms
this directly, and it is not a hypothetical: a real, documented case
showed a server correctly declaring `Content-Length: 5084527` for a
response that decoded to `42846965` bytes, roughly 8.4× larger,
correct behavior per spec, not a lying server. Separately,
`Transfer-Encoding: chunked` responses frequently omit `Content-Length`
entirely, since chunked framing has no pre-known length by design.

Naming this field `contentLength`, not `responseSize`, is a deliberate
part of the decision, not a naming preference. DevLens cannot honestly
provide "response size" as a general concept across both capture
mechanisms without reading the response body (explicitly out of scope
— see Scope restrictions), so no field claiming to represent that
concept is added. A future version could add explicitly-named,
narrowly-scoped fields (`encodedBodySize`, `decodedBodySize`,
`transferSize`) if a browser API ever makes them reliably available
without reading the body — they should never collapse into one vague
"size" field, for the same reason `contentLength` isn't named that
now.

### `null` semantics

**`null` means the metadata is unavailable to DevLens at the capture
boundary — not that the header was necessarily absent from the
server's response.** A cross-origin `no-cors` response may carry a
perfectly valid header on the wire that DevLens, running with the same
restrictions as any other page script, simply isn't permitted to see.
Comparing DevLens's `null` against a value visible in a browser's own
DevTools Network panel (which has privileged access page JS does not)
is comparing two different access contexts, not evidence of a DevLens
bug.

Both fields collapse every unavailable case to the same `null` — no
header sent, an invalid/malformed value, a value too large to
represent as a safe integer, or access denied by the browser's opaque-
response model. This is a deliberate single representation, not four
different ones consumers would need to distinguish.

### Fetch/XHR availability matrix

| Situation                                                                 | `contentType`                        | `contentLength`                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Same-origin response                                                      | captured                             | captured (if header present and valid)                                                                                              |
| Cross-origin, CORS-permitted (`cors` mode, the Fetch default)             | captured                             | captured (if present/valid) — both are CORS-safelisted response headers, exposed without any `Access-Control-Expose-Headers` opt-in |
| Cross-origin, `no-cors` (Fetch only — `opaque`/`opaqueredirect` response) | `null`                               | `null` — headers are empty and immutable on an opaque `Response`, confirmed directly against MDN's `Response.type` documentation    |
| No response at all (network-error, aborted, timeout — either mechanism)   | `null`                               | `null`                                                                                                                              |
| HTTP error response (404/500)                                             | captured                             | captured — a failed _outcome_ does not mean metadata is unavailable; these are independent                                          |
| Followed redirect                                                         | reflects the **final** response only | reflects the **final** response only — no redirect-hop reporting is introduced by this amendment                                    |

**A structural Fetch/XHR asymmetry, not a DevLens gap:** XHR has no
equivalent of Fetch's `no-cors` mode — that is a Fetch-only
(`RequestMode`) concept. An unauthorized cross-origin XHR request does
not succeed-with-withheld-headers the way an opaque `fetch()` can; it
fails outright as a network error, already covered by the existing
outcome classification. XHR therefore cannot produce a state
equivalent to Fetch's opaque-success case — there is nothing to report
metadata for in that situation, not a missing capability.

`getResponseHeader()` (XHR) and `Response.headers` (Fetch) are two
different API-level exposure mechanisms, both constrained by the same
underlying CORS-safelisted-response-header set. The mechanisms differ;
the contractual result for DevLens (`accessible → capture, not
accessible → null`) is identical either way.

### Parsing contract for `contentLength`

The header must match `Content-Length`'s own grammar exactly
(`1*DIGIT` per RFC 9110) before being treated as a number at all — not
a bare `Number()` coercion, which would wrongly accept strings that
are not valid `Content-Length` syntax (scientific notation, hex
prefixes, leading `+`, whitespace-only strings coercing to `0`). A
value that parses but cannot be represented as a JavaScript safe
integer is also `null`. `Content-Length: 0` is a valid, meaningful
result and must be distinguished from `null` — an empty response body
is a real, common case (a 204, or any endpoint with nothing to return),
not an absent value.

This strict grammar check is defensive robustness, not a claim that
browsers routinely hand JavaScript malformed headers — a browser's own
HTTP parser is expected to enforce valid framing before a header value
would ever reach `Headers.get()`/`getResponseHeader()` looking
malformed. The check exists so DevLens never reports a wrong number
with false confidence, not because malformed values are expected to be
common in practice.

A duplicate/comma-joined `Content-Length` (multiple same-name headers,
surfaced by both APIs as one comma-joined string) is not
special-cased — it simply fails the single-integer grammar check above
and becomes `null`, the same as any other value that doesn't conform.
DevLens does not attempt to disambiguate, average, or pick the first
of multiple values; it uses the browser-exposed string as-is and
parses only what unambiguously conforms.

### What this amendment does not touch

No request or response body capture, no arbitrary response-header
capture beyond these two, no redirect-hop-level reporting, no
WebSocket/SSE support, no in-flight request events, no endpoint
grouping or route-template inference — every other Open question above
remains exactly as open as before this amendment. No changes to Core,
`@devlens/panel`, Export, or Import.
