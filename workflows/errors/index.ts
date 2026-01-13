/**
 * Error Escalation Module
 *
 * Provides error classification and escalation chain functionality.
 *
 * @module workflows/errors
 */

export {
  classifyError,
  type ClassifiedError,
  type CapabilityTier,
  type ErrorClassification,
  type ErrorSeverity,
  type ClassifyOptions,
  type ClassificationRule,
  TIER_ORDER,
  getNextTier,
} from './error-classifier'

export {
  createEscalationEngine,
  CircuitState,
  type ErrorEscalationEngine,
  type EscalationEngineConfig,
  type EscalationStep,
  type EscalationChainResult,
  type EscalationOptions,
  type EscalationQueryOptions,
  type EscalationEvent,
  type EscalationEventType,
  type EscalationMetrics,
  type RecoveryStrategy,
  type CircuitBreakerConfig,
} from './escalation-engine'
