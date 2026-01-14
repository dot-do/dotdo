/**
 * Object Standard Library
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export function keys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
}

export function values(obj: Record<string, unknown>): unknown[] {
  return Object.values(obj)
}

export function entries(obj: Record<string, unknown>): [string, unknown][] {
  return Object.entries(obj)
}

export function merge(obj1: Record<string, unknown>, obj2: Record<string, unknown>): Record<string, unknown> {
  return { ...obj1, ...obj2 }
}

export function has(obj: Record<string, unknown>, key: string): boolean {
  return key in obj
}

export function get(obj: Record<string, unknown>, key: string, defaultValue?: unknown): unknown {
  return obj[key] ?? defaultValue
}
