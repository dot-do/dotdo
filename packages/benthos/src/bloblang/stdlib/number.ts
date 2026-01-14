/**
 * Number Standard Library
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export function abs(n: number): number {
  return Math.abs(n)
}

export function floor(n: number): number {
  return Math.floor(n)
}

export function ceil(n: number): number {
  return Math.ceil(n)
}

export function round(n: number): number {
  return Math.round(n)
}

export function max(...values: number[]): number {
  return Math.max(...values)
}

export function min(...values: number[]): number {
  return Math.min(...values)
}

export function pow(base: number, exp: number): number {
  return Math.pow(base, exp)
}

export function sqrt(n: number): number {
  return Math.sqrt(n)
}

export function log(n: number): number {
  return Math.log(n)
}

export function log10(n: number): number {
  return Math.log10(n)
}
