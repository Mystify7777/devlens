/**
 * Issue #17 / ADR-0010's amendment. A pure leaf function — no DOM
 * side effects, no bus access, no interceptor-specific knowledge —
 * same discipline as the classifiers and the normalizer. Used by both
 * `fetch-interceptor.ts` and `xhr-interceptor.ts`, at the exact point
 * each currently resolves what was requested, so `network.ts` and
 * everything downstream of it continue to receive an already-correct
 * `url` and need no changes.
 *
 * Two independent transformations, both safe without any
 * application-specific route knowledge (see the ADR-0010 amendment
 * for the full reasoning and the authoritative sources each claim was
 * verified against):
 *
 * 1. Canonicalization via the URL parser itself: lowercases
 *    scheme/host, strips the scheme's default port, percent-encodes
 *    any unsafe literal characters, resolves a relative input against
 *    `base`, and explicitly clears the fragment (a fragment is never
 *    transmitted to the server, so reporting one in a *network
 *    request* event would describe something that was never sent).
 *    Already-present percent-encoding is left exactly as-is — the
 *    native URL parser does not decode or re-case it, verified
 *    empirically rather than assumed (see normalize-url.test.ts).
 * 2. Query-value redaction: every non-empty parameter value becomes
 *    `***`; parameter names are always preserved; a bare flag with no
 *    value at all is left empty rather than forced to `***`, since
 *    there is nothing to redact and marking it anyway would
 *    misrepresent an already-empty value as hidden data.
 *
 * The non-interference invariant this package holds everywhere else
 * (fetch-interceptor.ts's file-level comment: "DevLens observes; it
 * never interferes") governs the failure path too: if `raw` can't be
 * parsed as a URL at all (relative to `base` or otherwise), this
 * returns `raw` completely unchanged rather than throwing. A capture
 * mechanism raising an exception over a URL it doesn't fully
 * understand is a worse outcome than reporting one unredacted/
 * uncanonicalized value — the request itself already happened; this
 * function's only job is describing it, and a failed description must
 * never become the caller's problem.
 */
export function normalizeCapturedUrl(raw: string, base: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return raw;
  }

  parsed.hash = "";

  const original = new URLSearchParams(parsed.search);
  const redacted = new URLSearchParams();
  original.forEach((value, key) => {
    redacted.append(key, value === "" ? "" : "***");
  });
  parsed.search = redacted.toString();

  return parsed.href;
}
