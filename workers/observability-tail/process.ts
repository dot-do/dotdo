import type { ObservabilityEvent } from '../../types/observability'

// ============================================================================
// TailItem Type Definition (mirrors Cloudflare's TailItem)
// ============================================================================

export interface TailItem {
  scriptName: string
  eventTimestamp: number
  outcome:
    | 'ok'
    | 'exception'
    | 'exceededCpu'
    | 'exceededMemory'
    | 'canceled'
    | 'unknown'
  event: {
    request: {
      url: string
      method: string
      headers: Record<string, string>
    }
    response?: {
      status: number
    }
  }
  logs: Array<{
    level: 'debug' | 'info' | 'log' | 'warn' | 'error'
    message: any[]
    timestamp: number
  }>
  exceptions: Array<{
    name: string
    message: string
    stack?: string
  }>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a UUID v4
 */
function generateUuid(): string {
  return crypto.randomUUID()
}

/**
 * Extract requestId from headers (case-insensitive for x-request-id)
 */
function extractRequestId(headers: Record<string, string>): string | undefined {
  // Check lowercase first
  if (headers['x-request-id']) {
    return headers['x-request-id']
  }
  // Check uppercase/mixed case
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-request-id') {
      return value
    }
  }
  return undefined
}

/**
 * Map Cloudflare log level to ObservabilityEvent level
 * 'log' maps to 'info', others stay the same
 */
function mapLogLevel(
  level: 'debug' | 'info' | 'log' | 'warn' | 'error'
): 'debug' | 'info' | 'warn' | 'error' {
  if (level === 'log') {
    return 'info'
  }
  return level
}

/**
 * Determine request level based on status code and outcome
 */
function getRequestLevel(
  status: number | undefined,
  outcome: TailItem['outcome']
): 'debug' | 'info' | 'warn' | 'error' {
  // Error outcomes
  if (
    outcome === 'exceededCpu' ||
    outcome === 'exceededMemory' ||
    outcome === 'exception'
  ) {
    return 'error'
  }

  // Status-based level
  if (status !== undefined) {
    if (status >= 500) {
      return 'error'
    }
    if (status >= 400) {
      return 'warn'
    }
  }

  return 'info'
}

/**
 * Serialize message array items to strings
 */
function serializeMessage(message: any[]): string[] {
  return message.map((item) => {
    if (item === null) return 'null'
    if (item === undefined) return 'undefined'
    if (typeof item === 'string') return item
    if (typeof item === 'number' || typeof item === 'boolean') {
      return String(item)
    }
    try {
      return JSON.stringify(item)
    } catch {
      return String(item)
    }
  })
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process TailItem[] and convert to ObservabilityEvent[]
 *
 * Each TailItem produces:
 * - One request event
 * - One log event per log entry
 * - One exception event per exception
 */
export function processTailEvents(tailItems: TailItem[]): ObservabilityEvent[] {
  const events: ObservabilityEvent[] = []

  for (const tailItem of tailItems) {
    const {
      scriptName,
      eventTimestamp,
      outcome,
      event,
      logs,
      exceptions,
    } = tailItem

    // Extract requestId from headers (or generate one if missing)
    const requestId =
      extractRequestId(event.request.headers) ?? generateUuid()

    // Process log entries
    for (const log of logs) {
      const logEvent: ObservabilityEvent = {
        id: generateUuid(),
        type: 'log',
        level: mapLogLevel(log.level),
        script: scriptName,
        timestamp: log.timestamp,
        requestId,
        message: serializeMessage(log.message),
      }
      events.push(logEvent)
    }

    // Process exceptions
    for (const exception of exceptions) {
      // Build message array - include both full message and a short version
      // to support both exact and partial matching in searches
      const messageArray: string[] = [exception.message]

      // Extract short message (before parenthetical notes) if different
      const shortMessage = exception.message.replace(/\s*\(.*\)$/, '').trim()
      if (shortMessage && shortMessage !== exception.message) {
        messageArray.push(shortMessage)
      }

      const exceptionEvent: ObservabilityEvent = {
        id: generateUuid(),
        type: 'exception',
        level: 'error',
        script: scriptName,
        timestamp: eventTimestamp,
        requestId,
        message: messageArray,
        stack: exception.stack,
      }
      events.push(exceptionEvent)
    }

    // Create request event
    const status = event.response?.status
    const requestEvent: ObservabilityEvent = {
      id: generateUuid(),
      type: 'request',
      level: getRequestLevel(status, outcome),
      script: scriptName,
      timestamp: eventTimestamp,
      requestId,
      method: event.request.method,
      url: event.request.url,
      status,
      metadata:
        outcome !== 'ok'
          ? { outcome }
          : undefined,
    }
    events.push(requestEvent)
  }

  return events
}
