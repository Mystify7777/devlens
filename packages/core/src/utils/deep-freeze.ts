/**
 * Recursively freezes plain objects and arrays only. Skips built-in/host
 * objects (Date, Map, Set, RegExp, Error, DOM nodes, functions, etc.) —
 * freezing those can have unintended side effects, e.g. if a careless
 * plugin attaches `window` or a DOM node to `metadata`. Also guards
 * against cyclic references via a WeakSet of already-visited objects.
 */
function isPlainObjectOrArray(
  value: unknown
): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): Readonly<T> {
  if (!isPlainObjectOrArray(value)) {
    return value;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (!Object.isFrozen(value)) {
    Object.freeze(value);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return value as Readonly<T>;
}