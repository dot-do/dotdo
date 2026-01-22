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

// Redis integration
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

// S3 integration
export {
  S3Integration,
  createS3Integration,
  type S3Config,
  type PutObjectParams,
  type GetObjectParams,
  type DeleteObjectParams,
  type ListObjectsParams,
  type HeadObjectParams,
  type CopyObjectParams,
  type S3Object,
  type ListObjectsResult,
  type S3Metadata,
  type S3Methods,
} from './s3'

// Twilio integration
export {
  TwilioIntegration,
  createTwilioIntegration,
  type TwilioConfig,
  type SendSmsRequest,
  type SendSmsResponse,
  type MakeCallRequest,
  type MakeCallResponse,
  type VerifyStartRequest,
  type VerifyCheckRequest,
  type VerifyResponse,
  type TwilioMethods,
} from './twilio'

// Webhook verification utilities
export {
  verifyStripeSignature,
  verifyGitHubSignature,
  verifySendGridSignature,
  verifySlackSignature,
  verifyTwilioSignature,
  type WebhookVerificationResult,
  type StripeSignatureOptions,
  type GitHubSignatureOptions,
  type SlackSignatureOptions,
  type TwilioSignatureOptions,
} from './webhook-verify'

// Circuit breaker for resilient integrations
export {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitState,
  CircuitBreakerError,
  type CircuitBreakerMetrics,
} from './circuit-breaker'
