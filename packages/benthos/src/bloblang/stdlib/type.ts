/**
 * Type Standard Library
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export function type(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function isString(value: unknown): boolean {
  return typeof value === 'string'
}

export function isNumber(value: unknown): boolean {
  return typeof value === 'number'
}

export function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean'
}

export function isArray(value: unknown): boolean {
  return Array.isArray(value)
}

export function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isNull(value: unknown): boolean {
  return value === null
}

export function toString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}

export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== '' && value !== 'false'
  return Boolean(value)
}
