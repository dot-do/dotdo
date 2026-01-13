/**
 * LLM Router Module
 *
 * Multi-provider routing with fallback, load balancing, and cost tracking.
 *
 * @module agents/router
 */

export {
  LLMRouter,
  createRouter,
  type RouterConfig,
  type ProviderConfig,
  type LoadBalanceStrategy,
  type FallbackConfig,
  type BudgetConfig,
  type HealthCheckConfig,
  type RouterMetrics,
  type ProviderHealthStatus,
} from './router'
