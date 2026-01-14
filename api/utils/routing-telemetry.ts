/**
 * Routing Telemetry Module
 *
 * Provides structured logging and observability for routing decisions.
 * Captures location, consistency mode, replica selection, and routing latency.
 *
 * Events are logged as JSON-LD structured data for easy tail consumption.
 */

/**
 * Routing event telemetry
 */
export interface RoutingEvent {
  timestamp: number
  requestId: string
  pathname: string
  method: string

  // Location information
  colo?: string
  region?: string
  lat?: number
  lon?: number

  // Routing decision
  nounName?: string
  consistencyMode: string
  targetBinding: string
  isReplica: boolean
  replicaRegion?: string

  // Timing
  routingDurationMs: number
}

/**
 * Log a routing event with structured JSON output
 *
 * Format: console.log() with JSON for tail consumption
 * All events prefixed with 'routing' type for filtering
 *
 * @param event - Routing event to log
 */
export function logRoutingEvent(event: RoutingEvent): void {
  // Format for tail consumption and structured logging
  // Use console.log directly so it appears in worker logs
  console.log(JSON.stringify({
    type: 'routing',
    ...event,
  }))
}

/**
 * Timing span for routing operations
 *
 * Usage:
 * ```typescript
 * const span = createRoutingSpan('req-123', '/customers/456', 'GET')
 * // ... do routing
 * span.end({
 *   targetBinding: 'DO',
 *   isReplica: false,
 *   consistencyMode: 'eventual',
 * })
 * ```
 */
export function createRoutingSpan(
  requestId: string,
  pathname: string,
  method: string
): {
  end: (result: Partial<RoutingEvent>) => void
} {
  const start = Date.now()

  return {
    end: (result: Partial<RoutingEvent>) => {
      logRoutingEvent({
        timestamp: Date.now(),
        requestId,
        pathname,
        method,
        routingDurationMs: Date.now() - start,
        consistencyMode: 'eventual',
        targetBinding: '',
        isReplica: false,
        ...result,
      })
    },
  }
}

/**
 * Add routing debugging headers to response
 *
 * Headers added:
 * - X-DO-Target: Target DO binding name
 * - X-DO-Replica: Whether routing to replica (true/false)
 * - X-DO-Replica-Region: Replica region if applicable
 * - X-DO-Consistency-Mode: Consistency mode for this request
 * - X-Location-Colo: Cloudflare colo if known
 * - X-Routing-Duration-Ms: Routing decision time in milliseconds
 *
 * @param headers - Response headers to add to
 * @param event - Routing event with decision info
 */
export function addRoutingHeaders(headers: Headers, event: RoutingEvent): void {
  headers.set('X-DO-Target', event.targetBinding)
  headers.set('X-DO-Replica', String(event.isReplica))

  if (event.replicaRegion) {
    headers.set('X-DO-Replica-Region', event.replicaRegion)
  }

  if (event.colo) {
    headers.set('X-Location-Colo', event.colo)
  }

  headers.set('X-DO-Consistency-Mode', event.consistencyMode)
  headers.set('X-Routing-Duration-Ms', String(event.routingDurationMs))
}

/**
 * Debug info for routing events
 *
 * Usage in development:
 * ```typescript
 * const debug = new RoutingDebugInfo('req-123')
 * debug.recordDecision('checking', 'static-routes')
 * debug.recordDecision('routing', 'customers → REPLICA_DO')
 * debug.print() // Logs decision tree
 * ```
 */
export class RoutingDebugInfo {
  private decisions: Array<{ action: string; detail: string; timestamp: number }> = []

  constructor(private requestId: string) {}

  /**
   * Record a routing decision step
   */
  recordDecision(action: string, detail: string): void {
    this.decisions.push({
      action,
      detail,
      timestamp: Date.now(),
    })
  }

  /**
   * Print all decisions (dev mode only)
   */
  print(): void {
    console.log(JSON.stringify({
      type: 'routing-debug',
      requestId: this.requestId,
      decisions: this.decisions,
    }))
  }

  /**
   * Get decisions for inclusion in telemetry
   */
  getDecisions(): typeof this.decisions {
    return this.decisions
  }
}
