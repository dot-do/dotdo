// @dotdo/integrations - Third-party integration registry
// Central registry for managing external service integrations (do-laux)

// Core types
export type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationCategory,
  IntegrationResult,
  IntegrationError,
  IntegrationEvent,
  IntegrationWebhookHandler,
  IntegrationMethods,
  IntegrationFactory,
  RegisterIntegrationOptions,
  RegisteredIntegration,
} from './types'

// Registry
export {
  IntegrationRegistry,
  IntegrationRegistryError,
  integrationRegistry,
  registerIntegration,
  getIntegration,
  successResult,
  errorResult,
  type ListIntegrationsOptions,
  type IntegrationSummary,
} from './registry'

// Webhook verification utilities
export {
  verifyStripeSignature,
  verifySendGridSignature,
  verifyTwilioSignature,
  verifyHmacSignature,
  parseStripeSignature,
  type StripeSignatureParts,
} from './webhook-verify'

// Circuit breaker for resilient integrations
export {
  CircuitState,
  CircuitBreakerIntegration,
  IntegrationCircuitBreakerRegistry,
  createCircuitBreakerIntegration,
  createIntegrationCircuitBreakerRegistry,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitStats,
  type CircuitBreakerIntegrationConfig,
} from './circuit-breaker'
