// Root Worker Entry Point
// Minimal passthrough to the DO (Durable Object = Digital Object)
//
// Namespace derivation: tenant.api.dotdo.dev -> DO('tenant')
// All business logic lives in the DO, not the worker.
//
// Includes graceful degradation with circuit breaker pattern (do-ejab)

import { DO } from './do/DO'
import {
  GracefulDegradationHandler,
  createGracefulDegradationHandler,
  type HealthReport,
} from './do/graceful-degradation'

// Re-export DO class for wrangler to bind
export { DO }

// Environment interface
interface Env {
  DO: DurableObjectNamespace
  JWT_SECRET?: string
  JWKS_URL?: string
  DO_INTERNAL_SECRET?: string
  ENVIRONMENT?: string
  // Graceful degradation configuration
  CIRCUIT_FAILURE_THRESHOLD?: string
  CIRCUIT_RESET_TIMEOUT_MS?: string
  CIRCUIT_TIMEOUT_MS?: string
  ENABLE_GRACEFUL_DEGRADATION?: string
}

// Global graceful degradation handler (initialized per worker instance)
let degradationHandler: GracefulDegradationHandler | null = null

/**
 * Get or create the graceful degradation handler
 */
function getGracefulDegradationHandler(env: Env): GracefulDegradationHandler {
  if (!degradationHandler) {
    degradationHandler = createGracefulDegradationHandler({
      circuitBreakerConfig: {
        failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD ? parseInt(env.CIRCUIT_FAILURE_THRESHOLD, 10) : 5,
        resetTimeoutMs: env.CIRCUIT_RESET_TIMEOUT_MS ? parseInt(env.CIRCUIT_RESET_TIMEOUT_MS, 10) : 30000,
        timeoutMs: env.CIRCUIT_TIMEOUT_MS ? parseInt(env.CIRCUIT_TIMEOUT_MS, 10) : 10000,
        onStateChange: (name, fromState, toState) => {
          console.log(`[CircuitBreaker] ${name}: ${fromState} -> ${toState}`)
        },
        onFailure: (name, error, stats) => {
          console.warn(`[CircuitBreaker] ${name} failure: ${error.message} (consecutive: ${stats.consecutiveFailures})`)
        },
      },
      healthCheckConfig: {
        timeoutMs: 5000,
        degradedLatencyMs: 1000,
      },
      fallbackConfig: {
        statusCode: 503,
        enableCache: true,
        cacheTtlMs: 60000,
      },
    })
  }
  return degradationHandler
}

/**
 * Check if graceful degradation is enabled
 */
function isGracefulDegradationEnabled(env: Env): boolean {
  // Default to enabled in production, can be disabled via env
  if (env.ENABLE_GRACEFUL_DEGRADATION === 'false') {
    return false
  }
  return true
}

/**
 * Extract the Cloudflare colo from the incoming request.
 * In production, this comes from request.cf.colo (3-letter IATA code like 'SJC', 'LHR').
 * In local testing (miniflare/wrangler dev), returns 'local'.
 */
function getWorkerColo(request: Request): string {
  const cf = (request as Request & { cf?: { colo?: string } }).cf
  if (cf?.colo) {
    return cf.colo
  }
  return 'local'
}

/**
 * Add telemetry headers to a response.
 * - X-Worker-Colo: The Cloudflare colo where the worker runs
 * - X-Latency-Ms: Round-trip time from worker to DO in milliseconds
 * The response already includes X-DO-Colo from the DO itself.
 */
function addTelemetryHeaders(
  response: Response,
  workerColo: string,
  latencyMs: number
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Worker-Colo', workerColo)
  headers.set('X-Latency-Ms', latencyMs.toFixed(2))

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Execute a DO request with telemetry capture.
 * Measures latency and adds telemetry headers to the response.
 */
async function executeWithTelemetry(
  request: Request,
  doFetch: () => Promise<Response>
): Promise<Response> {
  const workerColo = getWorkerColo(request)
  const start = performance.now()

  const response = await doFetch()

  const latencyMs = performance.now() - start

  return addTelemetryHeaders(response, workerColo, latencyMs)
}

// Worker fetch handler - routes to DO based on hostname with graceful degradation
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    // Handle health check endpoint
    if (url.pathname === '/_health') {
      return handleHealthCheck(env)
    }

    // Handle circuit breaker status endpoint
    if (url.pathname === '/_circuit-status') {
      return handleCircuitStatus(env)
    }

    // Extract namespace from subdomain
    // tenant.api.dotdo.dev -> 'tenant'
    // api.dotdo.dev -> 'default'
    const ns = hostParts.length > 2 && hostParts[0] ? hostParts[0] : 'default'

    // Get or create DO instance by namespace
    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    // Check if graceful degradation is enabled
    if (!isGracefulDegradationEnabled(env)) {
      // Direct passthrough with telemetry capture
      return executeWithTelemetry(request, () => stub.fetch(request))
    }

    // Use graceful degradation handler with telemetry capture
    const handler = getGracefulDegradationHandler(env)

    return executeWithTelemetry(request, async () => {
      return handler.executeRequest(ns, request, async () => {
        return stub.fetch(request)
      })
    })
  },
}

/**
 * Handle health check endpoint
 */
function handleHealthCheck(env: Env): Response {
  const handler = getGracefulDegradationHandler(env)
  const report: HealthReport = handler.getHealthReport()

  const statusCode = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 200 : 503

  return new Response(JSON.stringify(report, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Handle circuit breaker status endpoint
 */
function handleCircuitStatus(env: Env): Response {
  const handler = getGracefulDegradationHandler(env)
  const stats = handler.getAllCircuitStats()

  return new Response(JSON.stringify(stats, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
}
