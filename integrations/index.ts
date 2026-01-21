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
  createIntegrationRegistry,
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

// Twilio SMS/MMS integration (do-h3in)
export {
  TwilioIntegration,
  createTwilioIntegration,
  type TwilioConfig,
  type SendSmsRequest,
  type SendSmsResponse,
  type TwilioMessage,
  type TwilioMessageStatus,
  type ListMessagesOptions,
  type PhoneNumberLookup,
  type TwilioMethods,
} from './twilio'

// AWS S3 storage integration (do-h3in)
export {
  S3Integration,
  createS3Integration,
  type S3Config,
  type S3Object,
  type S3Bucket,
  type PutObjectRequest,
  type PutObjectResponse,
  type GetObjectResponse,
  type HeadObjectResponse,
  type CopyObjectResponse,
  type ListObjectsOptions,
  type ListObjectsResponse,
  type S3Methods,
} from './s3'

// Redis database integration (do-h3in)
export {
  RedisIntegration,
  createRedisIntegration,
  type RedisConfig,
  type RedisValue,
  type SetOptions,
  type ScanOptions,
  type ScanResult,
  type RedisMethods,
} from './redis'

// Circuit breaker for integration protection (do-j8ky)
export {
  CircuitBreakerIntegration,
  IntegrationCircuitBreakerRegistry,
  createCircuitBreakerIntegration,
  createIntegrationCircuitBreakerRegistry,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerIntegrationConfig,
  type CircuitState,
  type CircuitStats,
} from './circuit-breaker'
