/**
 * Services - Composable services extracted from DOBase
 *
 * These services encapsulate specific concerns:
 * - StoreManager: Store lifecycle and lazy loading
 *
 * Future services (planned):
 * - EventBus: Event emission and dispatch
 * - ActionLogger: Action tracking and logging
 * - CrossDOClient: Inter-DO communication with circuit breaker
 */

export { StoreManager, type StoreManagerConfig, type StoreEnv, type DLQHandlerMap } from './StoreManager'
