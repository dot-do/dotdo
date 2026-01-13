/**
 * Payments Primitives - Subscription, billing, and payment method management
 *
 * @module db/primitives/payments
 */

// Payment Methods - Tokenized storage
export {
  PaymentMethodStore,
  createPaymentMethodStore,
  detectCardBrand,
  detectProvider,
  isCardExpired,
  validateCardExpiry,
  validateLast4,
  validateBillingAddress,
  validatePaymentMethodMetadata,
  type PaymentMethodType,
  type CardBrand,
  type WalletType,
  type BankAccountType,
  type AccountHolderType,
  type CardDetails,
  type BankAccountDetails,
  type WalletDetails,
  type BillingAddress,
  type PaymentMethodMetadata,
  type PaymentMethod,
  type StoreOptions,
  type ListOptions,
  type ValidationResult,
  type PaymentMethodStoreConfig,
  type ValidateMetadataOptions,
} from './payment-methods'

// Subscription Engine
export {
  createSubscriptionEngine,
  SubscriptionEngine,
  type SubscriptionStatus,
  type BillingCycle,
  type ProrationBehavior,
  type CollectionMethod,
  type CancelBehavior,
  type InvoiceStatus,
  type PaymentStatus,
  type UsageAction,
  type DunningAction,
  type Plan,
  type Subscription,
  type Invoice,
  type InvoiceLineItem,
  type UsageRecord,
  type ProrationItem,
  type PaymentIntent,
  type DunningStep,
  type SubscriptionEvent,
  type CreateSubscriptionOptions,
  type UpdateSubscriptionOptions,
  type CancelSubscriptionOptions,
  type RecordUsageOptions,
  type AlarmSchedule,
  type SubscriptionEngineOptions,
} from './subscription-engine'

// =============================================================================
// Tokenization Service Types (RED Phase - implementation pending)
// =============================================================================

/**
 * Token status
 */
export type TokenStatus = 'active' | 'expired' | 'revoked' | 'pending_verification' | 'verified'

/**
 * Token type for tokenization
 */
export type TokenType = 'card' | 'bank_account' | 'wallet'

/**
 * Card data for tokenization (sensitive - never stored)
 */
export interface CardData {
  number: string
  expMonth: number
  expYear: number
  cvc: string
  holderName?: string
  billingAddress?: BillingAddress
}

/**
 * Bank account data for tokenization (sensitive - never stored)
 */
export interface BankAccountData {
  accountNumber: string
  routingNumber: string
  accountHolderName: string
  accountHolderType: AccountHolderType
  accountType: BankAccountType
}

/**
 * Wallet data for tokenization
 */
export interface WalletData {
  walletType: WalletType
  paymentData: string // Encrypted payment data from wallet provider
}

/**
 * Token metadata (safe to store)
 */
export interface TokenMetadata {
  last4: string
  brand?: CardBrand
  expMonth?: number
  expYear?: number
  walletType?: WalletType
  bankName?: string
  accountHolderType?: AccountHolderType
  billingAddress?: BillingAddress
  hasDevicePAN?: boolean
}

/**
 * Token record
 */
export interface Token {
  id: string
  type: TokenType
  customerId: string
  status: TokenStatus
  fingerprint?: string
  metadata: TokenMetadata
  provider: string
  providerMetadata?: Record<string, unknown>
  isDefault?: boolean
  isExpired?: boolean
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * Stored token (encrypted)
 */
export interface StoredToken {
  id: string
  type: TokenType
  customerId: string
  status: TokenStatus
  fingerprint?: string
  metadata: TokenMetadata
  provider: string
  encryptedProviderToken: string
  iv: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean
  exists?: boolean
  isActive?: boolean
  isExpired?: boolean
  providerValid?: boolean
  error?: string
}

/**
 * Token usage record
 */
export interface TokenUsage {
  action: string
  amount?: number
  currency?: string
  chargeId?: string
  timestamp: Date
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  action: string
  tokenId: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

/**
 * Client token for JS SDK
 */
export interface ClientToken {
  token: string
  provider: string
  expiresAt: Date
}

/**
 * Client token request
 */
export interface ClientTokenRequest {
  customerId: string
  provider?: string
  ttl?: number
}

/**
 * Setup intent for saving cards
 */
export interface SetupIntent {
  id: string
  clientSecret: string
  provider: string
}

/**
 * 3D Secure challenge
 */
export interface ThreeDSChallenge {
  redirectUrl: string
  transactionId: string
}

/**
 * 3D Secure result
 */
export interface ThreeDSResult {
  authenticated: boolean
  authenticationValue?: string
  eci?: string
}

/**
 * Iframe configuration
 */
export interface IframeConfig {
  url: string
  sessionId: string
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  minTLSVersion: string
}

/**
 * Customer data export
 */
export interface CustomerDataExport {
  customerId: string
  tokens: Token[]
  exportedAt: Date
}

/**
 * Tokenization provider adapter interface
 */
export interface TokenizationProvider {
  name: string
  tokenize(data: CardData | BankAccountData | WalletData): Promise<{
    providerToken: string
    fingerprint: string
    last4: string
    brand?: CardBrand
    expMonth?: number
    expYear?: number
    walletType?: WalletType
    bankName?: string
    accountHolderType?: AccountHolderType
    status?: TokenStatus
    providerMetadata?: Record<string, unknown>
  }>
  detokenize?(tokenId: string): Promise<TokenMetadata>
  deleteToken(tokenId: string): Promise<boolean>
  validateToken(tokenId: string): Promise<{ valid: boolean; error?: string }>
  createClientToken(customerId: string): Promise<{ clientToken: string; expiresAt: Date }>
  exchangeNonce?(nonce: string): Promise<{
    providerToken: string
    fingerprint: string
    last4: string
    brand?: CardBrand
    expMonth?: number
    expYear?: number
  }>
  createSetupIntent?(options: { customerId: string; usage?: string }): Promise<{
    id: string
    clientSecret: string
  }>
  confirmSetupIntent?(setupIntentId: string): Promise<{
    providerToken: string
    fingerprint: string
    last4: string
    brand?: CardBrand
    expMonth?: number
    expYear?: number
  }>
  verifyMicroDeposits?(tokenId: string, amounts: number[]): Promise<{ verified: boolean }>
  verifyWithPlaid?(options: { plaidPublicToken: string; plaidAccountId: string }): Promise<{
    providerToken: string
    fingerprint: string
    last4: string
    bankName: string
    status: TokenStatus
  }>
  create3DSChallenge?(options: {
    tokenId: string
    amount: number
    currency: string
    returnUrl: string
  }): Promise<ThreeDSChallenge>
  handle3DSResult?(transactionId: string): Promise<ThreeDSResult>
}

/**
 * Tokenization service configuration
 */
export interface TokenizationConfig {
  encryptionKey: string
  tokenTTL?: number
  expirationWarningDays?: number
  expiredTokenRetentionDays?: number
  versionRetention?: number
  onTokenExpiringSoon?: (token: Token) => void | Promise<void>
}

/**
 * Tokenization service interface
 */
export interface TokenizationService {
  // Provider management
  registerProvider(name: string, provider: TokenizationProvider): void
  setDefaultProvider(name: string): void
  listProviders(): string[]

  // Tokenization
  tokenize(options: {
    type: TokenType
    data: CardData | BankAccountData | WalletData
    customerId: string
    provider?: string
  }): Promise<Token>

  // Token retrieval
  getToken(id: string): Promise<Token>
  getProviderToken(id: string): Promise<string>
  getStoredToken(id: string): Promise<StoredToken>
  listTokens(customerId: string): Promise<Token[]>
  getDefaultToken(customerId: string): Promise<Token | null>
  setDefaultToken(customerId: string, tokenId: string): Promise<void>

  // Token lifecycle
  deleteToken(id: string): Promise<void>
  updateTokenExpiry(id: string, options: { expMonth: number; expYear: number }): Promise<Token>
  migrateToken(id: string, targetProvider: string): Promise<Token>

  // Validation
  validateToken(id: string, options?: { checkProvider?: boolean; customerId?: string }): Promise<TokenValidationResult>
  isValidTokenFormat(id: string): boolean

  // Expiration
  checkExpiringTokens(): Promise<void>
  cleanupExpiredTokens(): Promise<void>

  // Security
  rotateEncryptionKey(newKey: string): Promise<void>
  getSecurityConfig(): SecurityConfig
  getAuditLog(tokenId: string): Promise<AuditLogEntry[]>

  // Usage tracking
  recordTokenUsage(tokenId: string, usage: Omit<TokenUsage, 'timestamp'>): Promise<void>
  getTokenUsage(tokenId: string): Promise<TokenUsage[]>

  // GDPR / compliance
  exportCustomerData(customerId: string): Promise<CustomerDataExport>

  // JS SDK / iframe integration
  createClientToken(request: ClientTokenRequest): Promise<ClientToken>
  exchangeNonce(options: { nonce: string; customerId: string; provider: string }): Promise<Token>
  createSetupIntent(options: { customerId: string; provider: string; usage?: string }): Promise<SetupIntent>
  confirmSetupIntent(options: { setupIntentId: string; customerId: string; provider: string }): Promise<Token>
  getIframeConfig(options: { customerId: string; provider: string; returnUrl: string }): Promise<IframeConfig>

  // 3D Secure
  create3DSChallenge(options: {
    tokenId: string
    amount: number
    currency: string
    returnUrl: string
  }): Promise<ThreeDSChallenge>
  handle3DSResult(options: { transactionId: string; provider: string }): Promise<ThreeDSResult>

  // Bank account verification
  verifyBankAccount(tokenId: string, options: { amounts: number[] }): Promise<Token>
  tokenizeWithPlaid(options: {
    plaidPublicToken: string
    plaidAccountId: string
    customerId: string
  }): Promise<Token>

  // Internal / testing
  _tamperStoredToken(id: string, data: string): Promise<void>
}

/**
 * Creates a tokenization service instance
 *
 * RED PHASE: Not implemented yet - will throw.
 */
export function createTokenizationService(_config: TokenizationConfig): TokenizationService {
  throw new Error('TokenizationService not implemented yet - RED phase')
}

// Usage Metering - Event ingestion, aggregation, limits, tiers
export {
  createUsageMeter,
  type UsageMeter,
  type UsageEvent,
  type UsageAggregate,
  type UsageTier,
  type UsageLimit,
  type UsageAlert,
  type UsageSummary,
  type UsagePricingConfig,
  type UsageReportingMode,
  type AggregationPeriod,
  type TierType,
  type UsageRolloverPolicy,
  type RecordEventInput,
  type ListEventsFilter,
  type AggregationType,
  type GetAggregateInput,
  type GetAggregatesInput,
  type TierConfig,
  type TierPriceResult,
  type CurrentTierInfo,
  type LimitAction,
  type LimitStatus,
  type AlertEvent,
  type BillingCycleConfig,
  type BillingPeriod,
  type RolloverHistoryEntry,
  type ReportingModeConfig,
  type SyncStatus,
  type PeriodPriceResult,
  type TotalPriceResult,
  type GenerateSummaryInput,
  type UsageMeterInvoiceLineItem,
  type MetricDefinition,
} from './usage-metering'
