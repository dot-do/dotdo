/**
 * Array Standard Library
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export function length(arr: unknown[]): number {
  return arr.length
}

export function first(arr: unknown[]): unknown {
  return arr[0]
}

export function last(arr: unknown[]): unknown {
  return arr[arr.length - 1]
}

export function join(arr: unknown[], separator: string = ','): string {
  return arr.map(String).join(separator)
}

export function flatten(arr: unknown[]): unknown[] {
  return arr.flat()
}

export function unique(arr: unknown[]): unknown[] {
  return [...new Set(arr)]
}

export function sum(arr: unknown[]): number {
  return arr.reduce((acc: number, val) => acc + (typeof val === 'number' ? val : 0), 0)
}

export function append(arr: unknown[], item: unknown): unknown[] {
  return [...arr, item]
}

export function concat(arr: unknown[], other: unknown[]): unknown[] {
  return [...arr, ...other]
}

export function slice(arr: unknown[], start: number, end?: number): unknown[] {
  return arr.slice(start, end)
}

export function contains(arr: unknown[], item: unknown): boolean {
  return arr.includes(item)
}

export function reverse(arr: unknown[]): unknown[] {
  return [...arr].reverse()
}

export function sort(arr: unknown[]): unknown[] {
  return [...arr].sort()
}

export function index(arr: unknown[], item: unknown): number {
  return arr.indexOf(item)
}
