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

// Example integrations
export {
  StripeIntegration,
  createStripeIntegration,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripeSubscription,
  type StripeMethods,
} from './stripe'

export {
  SendGridIntegration,
  createSendGridIntegration,
  type SendGridConfig,
  type EmailRecipient,
  type EmailAttachment,
  type SendEmailRequest,
  type SendEmailResponse,
  type SendGridContact,
  type EmailStats,
  type SendGridMethods,
} from './sendgrid'
