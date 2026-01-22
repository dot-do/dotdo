// Health check service - business logic for health/readiness endpoints
// Separates health check logic from route handlers (clean architecture)

/**
 * Health check response structure
 */
export interface HealthResponse {
  status: 'ok'
  service: string
  timestamp: string
  uptime?: number
}

/**
 * Readiness check response structure
 */
export interface ReadinessResponse {
  status: 'ready' | 'not_ready'
  service: string
  timestamp: string
  checks: Record<string, boolean>
}

/**
 * Health check dependency interface for extensibility
 */
export interface HealthDependency {
  name: string
  check: () => Promise<boolean> | boolean
}

/**
 * Health service configuration
 */
export interface HealthServiceConfig {
  serviceName?: string
  dependencies?: HealthDependency[]
}

/**
 * HealthService handles health and readiness check business logic.
 *
 * Separates the "what" (health status) from the "how" (HTTP response).
 * Route handlers call this service and format the response.
 */
export class HealthService {
  private readonly serviceName: string
  private readonly dependencies: HealthDependency[]

  constructor(config: HealthServiceConfig = {}) {
    this.serviceName = config.serviceName ?? 'dotdo-api'
    this.dependencies = config.dependencies ?? []
  }

  /**
   * Get liveness status.
   * Used by load balancers to check if the process is alive.
   * Returns true if the process is running, regardless of downstream dependencies.
   */
  getHealth(): HealthResponse {
    const uptime = this.getUptime()
    return {
      status: 'ok',
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      ...(uptime !== undefined && { uptime }),
    }
  }

  /**
   * Get readiness status.
   * Used by load balancers to determine if the service can accept traffic.
   * Checks all registered dependencies.
   */
  async getReadiness(): Promise<ReadinessResponse> {
    const checks: Record<string, boolean> = {
      api: true // Base API is always ready if we can respond
    }

    // Check all registered dependencies
    for (const dep of this.dependencies) {
      try {
        checks[dep.name] = await dep.check()
      } catch {
        checks[dep.name] = false
      }
    }

    const allReady = Object.values(checks).every(Boolean)

    return {
      status: allReady ? 'ready' : 'not_ready',
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      checks
    }
  }

  /**
   * Get process uptime in seconds (if available)
   */
  private getUptime(): number | undefined {
    if (typeof process !== 'undefined' && process.uptime) {
      return process.uptime()
    }
    return undefined
  }

  /**
   * Register a health dependency to check during readiness
   */
  registerDependency(dependency: HealthDependency): void {
    this.dependencies.push(dependency)
  }
}

// Default singleton instance for simple use cases
let defaultHealthService: HealthService | null = null

/**
 * Get or create the default health service instance
 */
export function getHealthService(config?: HealthServiceConfig): HealthService {
  if (!defaultHealthService || config) {
    defaultHealthService = new HealthService(config)
  }
  return defaultHealthService
}

/**
 * Reset the default health service (useful for testing)
 */
export function resetHealthService(): void {
  defaultHealthService = null
}
