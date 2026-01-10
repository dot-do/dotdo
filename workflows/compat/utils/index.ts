/**
 * Shared utilities for workflow compat layers
 */

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isError(error: unknown): error is Error {
  return error instanceof Error
}

export function ensureError(error: unknown): Error {
  if (isError(error)) return error
  if (typeof error === 'string') return new Error(error)
  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String((error as { message: unknown }).message))
  }
  return new Error(String(error))
}

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`)
}

// ============================================================================
// DURATION PARSING
// ============================================================================

export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|hour|d|day|w|week)s?$/i)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    sec: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return Math.floor(value * (multipliers[unit] ?? 1000))
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`
  return `${Math.floor(ms / 86400000)}d`
}

// ============================================================================
// ID GENERATION
// ============================================================================

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`
}
