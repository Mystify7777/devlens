/**
 * Issue #18 / ADR-0010's amendment. A pure leaf function — no DOM
 * access, no header-reading of its own — same discipline as
 * normalize-url.ts's normalizeCapturedUrl(). Used by network.ts (for
 * Fetch, extracted from the already-available Response) and by
 * xhr-interceptor.ts (for XHR, extracted where the XHR instance is in
 * scope).
 *
 * Enforces Content-Length's own grammar (`1*DIGIT` per RFC 9110)
 * before accepting a value as a number at all — deliberately NOT a
 * bare `Number(raw)` coercion, which would wrongly accept strings
 * that are not valid Content-Length syntax: scientific notation
 * ("1e3"), hex prefixes ("0x10"), a leading "+", or a whitespace-only
 * string (which Number() coerces to 0, a real and meaningful value
 * that must never be produced from garbage input). A duplicate/
 * comma-joined header value (multiple same-name headers, surfaced by
 * both Headers.get() and XHR's getResponseHeader() as one comma-
 * joined string) is not specially handled — it simply fails this
 * grammar check and becomes null, the same as any other
 * non-conforming value. This function does not attempt to
 * disambiguate, average, or pick a value out of an ambiguous header;
 * it uses the browser-exposed string as-is and parses only what
 * unambiguously conforms.
 *
 * A value that parses but can't be represented as a JavaScript safe
 * integer is also null, rather than silently returning a
 * precision-losing number.
 *
 * `null` in, `null` out — this function has no opinion about *why*
 * a header value is missing (absent header, opaque response, no
 * response at all); that distinction is made by the caller, not here.
 */
export function parseContentLength(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
