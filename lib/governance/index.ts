/**
 * Governance Layer - Platform Infrastructure
 *
 * Provides governance primitives for the dotdo platform:
 * - API Keys: Hashed key management following Unkey patterns
 * - Rate Limiting: Already available in lib/rate-limit
 * - Metering: Usage event ingestion following Orb patterns
 * - Entitlements: Cached feature checks following Polar patterns
 *
 * @example API Keys
 * ```typescript
 * import { ApiKeyManager } from 'dotdo/lib/governance'
 *
 * const keys = new ApiKeyManager(storage)
 * const { key, keyId } = await keys.create({ prefix: 'sk_live_' })
 * const result = await keys.verify(key)
 * ```
 *
 * @example Usage Metering
 * ```typescript
 * import { UsageMeter } from 'dotdo/lib/governance'
 *
 * const meter = new UsageMeter(storage)
 * await meter.ingest({
 *   eventName: 'api_request',
 *   customerId: 'cust_123',
 *   value: 1,
 * })
 * ```
 *
 * @example Entitlements
 * ```typescript
 * import { EntitlementChecker } from 'dotdo/lib/governance'
 *
 * const checker = new EntitlementChecker(source, { cacheTtlMs: 60000 })
 * const result = await checker.check('cust_123', 'premium_support')
 * ```
 *
 * @packageDocumentation
 */

// API Keys
export {
  ApiKeyManager,
  type ApiKeyStorage,
  type CreateKeyOptions,
  type CreateKeyResult,
  type VerifyResult,
  type KeyInfo,
  type UpdateKeyOptions,
  type ListKeysOptions,
} from './api-keys'

// Usage Metering
export {
  UsageMeter,
  type MeterStorage,
  type MeterEvent,
  type MeterEventInput,
  type MeterQuery,
  type AggregatedUsage,
  type MeterOptions,
} from './metering'

// Entitlements
export {
  EntitlementChecker,
  type EntitlementSource,
  type Entitlement,
  type CheckResult,
  type EntitlementConfig,
  type AllFeaturesResult,
} from './entitlements'
