/**
 * Bulkhead Circuit Breaker Implementation
 *
 * Implements the bulkhead pattern for circuit breakers, isolating failures
 * by category (agent, workflow, entity) so that failures in one category
 * do not affect calls in another category.
 *
 * Key features:
 * - Category isolation: agent failures don't affect workflow calls
 * - Namespace isolation: failures in one namespace don't affect others
 * - State transitions: closed -> open -> half-open -> closed/open
 * - Per-category configuration: custom thresholds and timeouts
 * - Aggregate metrics: observability across all namespaces in a category
 */

export type BulkheadCategory = 'agent' | 'workflow' | 'entity'

export interface BulkheadMetrics {
  category: BulkheadCategory
  state: 'closed' | 'open' | 'half-open'
  failures: number
  successes: number
  lastFailure: Date | null
  lastSuccess: Date | null
  openUntil: Date | null
  totalRequests: number
  failureRate: number
}

export interface BulkheadAggregateMetrics {
  category: BulkheadCategory
  totalNamespaces: number
  openCircuits: number
  totalFailures: number
  totalSuccesses: number
}

export interface BulkheadCircuitBreakerOptions {
  threshold: number
  timeout: number
  categoryThresholds?: Partial<Record<BulkheadCategory, number>>
  categoryTimeouts?: Partial<Record<BulkheadCategory, number>>
}

interface CircuitState {
  failures: number
  successes: number
  lastFailure: Date | null
  lastSuccess: Date | null
  openUntil: Date | null
}

export class CircuitOpenError extends Error {
  constructor(category: BulkheadCategory, ns: string) {
    super(`Circuit breaker open for ${category}:${ns}`)
    this.name = 'CircuitOpenError'
  }
}

export class BulkheadCircuitBreaker {
  private defaultThreshold: number
  private defaultTimeout: number
  private categoryThresholds: Partial<Record<BulkheadCategory, number>>
  private categoryTimeouts: Partial<Record<BulkheadCategory, number>>

  // Map structure: category -> namespace -> CircuitState
  private circuits: Map<BulkheadCategory, Map<string, CircuitState>>

  constructor(options: BulkheadCircuitBreakerOptions) {
    this.defaultThreshold = options.threshold
    this.defaultTimeout = options.timeout
    this.categoryThresholds = options.categoryThresholds ?? {}
    this.categoryTimeouts = options.categoryTimeouts ?? {}

    this.circuits = new Map([
      ['agent', new Map()],
      ['workflow', new Map()],
      ['entity', new Map()],
    ])
  }

  private getThreshold(category: BulkheadCategory): number {
    return this.categoryThresholds[category] ?? this.defaultThreshold
  }

  private getTimeout(category: BulkheadCategory): number {
    return this.categoryTimeouts[category] ?? this.defaultTimeout
  }

  private getOrCreateCircuit(category: BulkheadCategory, ns: string): CircuitState {
    const categoryMap = this.circuits.get(category)!
    let circuit = categoryMap.get(ns)

    if (!circuit) {
      circuit = {
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        openUntil: null,
      }
      categoryMap.set(ns, circuit)
    }

    return circuit
  }

  recordFailure(category: BulkheadCategory, ns: string): void {
    const circuit = this.getOrCreateCircuit(category, ns)
    const currentState = this.getState(category, ns)

    circuit.failures++
    circuit.lastFailure = new Date()

    const threshold = this.getThreshold(category)
    const timeout = this.getTimeout(category)

    // If in half-open state, any failure reopens the circuit
    if (currentState === 'half-open') {
      circuit.openUntil = new Date(Date.now() + timeout)
    }
    // If we've reached the threshold, open the circuit
    else if (circuit.failures >= threshold) {
      circuit.openUntil = new Date(Date.now() + timeout)
    }
  }

  recordSuccess(category: BulkheadCategory, ns: string): void {
    const circuit = this.getOrCreateCircuit(category, ns)
    const currentState = this.getState(category, ns)

    circuit.successes++
    circuit.lastSuccess = new Date()

    // If in half-open state, success closes the circuit
    if (currentState === 'half-open') {
      circuit.openUntil = null
      circuit.failures = 0
    }
  }

  isOpen(category: BulkheadCategory, ns: string): boolean {
    return this.getState(category, ns) === 'open'
  }

  canExecute(category: BulkheadCategory, ns: string): boolean {
    const state = this.getState(category, ns)
    return state === 'closed' || state === 'half-open'
  }

  getState(category: BulkheadCategory, ns: string): 'closed' | 'open' | 'half-open' {
    const categoryMap = this.circuits.get(category)!
    const circuit = categoryMap.get(ns)

    if (!circuit || circuit.openUntil === null) {
      return 'closed'
    }

    const now = Date.now()

    if (now > circuit.openUntil.getTime()) {
      // Timeout has passed, transition to half-open
      return 'half-open'
    }

    return 'open'
  }

  getMetrics(category: BulkheadCategory, ns: string): BulkheadMetrics {
    const circuit = this.getOrCreateCircuit(category, ns)
    const state = this.getState(category, ns)
    const totalRequests = circuit.failures + circuit.successes

    return {
      category,
      state,
      failures: circuit.failures,
      successes: circuit.successes,
      lastFailure: circuit.lastFailure,
      lastSuccess: circuit.lastSuccess,
      openUntil: circuit.openUntil,
      totalRequests,
      failureRate: totalRequests > 0 ? circuit.failures / totalRequests : 0,
    }
  }

  getAggregateMetrics(category: BulkheadCategory): BulkheadAggregateMetrics {
    const categoryMap = this.circuits.get(category)!
    let totalFailures = 0
    let totalSuccesses = 0
    let openCircuits = 0

    for (const [ns, circuit] of categoryMap) {
      totalFailures += circuit.failures
      totalSuccesses += circuit.successes

      if (this.getState(category, ns) === 'open') {
        openCircuits++
      }
    }

    return {
      category,
      totalNamespaces: categoryMap.size,
      openCircuits,
      totalFailures,
      totalSuccesses,
    }
  }

  async execute<T>(category: BulkheadCategory, ns: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute(category, ns)) {
      throw new CircuitOpenError(category, ns)
    }

    try {
      const result = await fn()
      this.recordSuccess(category, ns)
      return result
    } catch (error) {
      this.recordFailure(category, ns)
      throw error
    }
  }

  reset(category: BulkheadCategory, ns: string): void {
    const categoryMap = this.circuits.get(category)!
    categoryMap.set(ns, {
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      openUntil: null,
    })
  }

  resetCategory(category: BulkheadCategory): void {
    this.circuits.set(category, new Map())
  }

  resetAll(): void {
    this.circuits = new Map([
      ['agent', new Map()],
      ['workflow', new Map()],
      ['entity', new Map()],
    ])
  }
}
