/**
 * @dotdo/sentry - Transport Implementations
 *
 * Transport implementations for sending events to Sentry.
 *
 * @module @dotdo/sentry/transport
 */

import type {
  Transport,
  TransportResult,
  Envelope,
  ParsedDsn,
  SentryEvent,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/sentry'
const SDK_VERSION = '0.1.0'

// =============================================================================
// Utilities
// =============================================================================

/**
 * Build the Sentry API URL from parsed DSN.
 */
function buildApiUrl(dsn: ParsedDsn): string {
  const { protocol, host, port, path, projectId } = dsn
  const portStr = port ? `:${port}` : ''
  const pathStr = path ? path : ''
  return `${protocol}://${host}${portStr}${pathStr}/api/${projectId}/envelope/`
}

// =============================================================================
// FetchTransport
// =============================================================================

/**
 * Default HTTP transport for sending events to Sentry.
 */
export class FetchTransport implements Transport {
  private readonly url: string
  private readonly publicKey: string
  private readonly fetchImpl: typeof fetch

  constructor(dsn: ParsedDsn, fetchImpl?: typeof fetch) {
    this.url = buildApiUrl(dsn)
    this.publicKey = dsn.publicKey
    this.fetchImpl = fetchImpl ?? globalThis.fetch
  }

  async send(envelope: Envelope): Promise<TransportResult> {
    const [header, items] = envelope

    // Build envelope body
    const lines: string[] = []
    lines.push(JSON.stringify(header))

    for (const [itemHeader, payload] of items) {
      lines.push(JSON.stringify(itemHeader))
      lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload))
    }

    const body = lines.join('\n')

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=${this.publicKey}`,
        },
        body,
      })

      // Extract headers from response
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        statusCode: response.status,
        headers: responseHeaders,
      }
    } catch (error) {
      // Return a failed result on network errors
      return {
        statusCode: 0,
      }
    }
  }

  async flush(_timeout?: number): Promise<boolean> {
    // For the fetch transport, there's nothing to flush
    return true
  }
}

// =============================================================================
// InMemoryTransport
// =============================================================================

/**
 * In-memory transport for testing (stores events locally).
 */
export class InMemoryTransport implements Transport {
  private events: SentryEvent[] = []

  async send(envelope: Envelope): Promise<TransportResult> {
    const [, items] = envelope

    for (const [header, payload] of items) {
      if (header.type === 'event' && payload) {
        this.events.push(payload as SentryEvent)
      }
    }

    return { statusCode: 200 }
  }

  async flush(_timeout?: number): Promise<boolean> {
    return true
  }

  getEvents(): SentryEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
  }
}
