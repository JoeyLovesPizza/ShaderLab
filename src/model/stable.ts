/*
 * Value comparison shared by the card store and the project maths: pure,
 * so the tests can import it without the stores' localStorage.
 */

/** JSON with keys sorted at every level: a draft built by the panel and
    one read from a file carry the same values in a different key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

/** Leaf paths where two values differ, dot-separated, arrays by index. */
export function diffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return []
  const isObjLike = (v: unknown) => typeof v === 'object' && v !== null
  if (!isObjLike(a) || !isObjLike(b)) return [prefix]
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  const out: string[] = []
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(...diffPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path))
  }
  return out
}
