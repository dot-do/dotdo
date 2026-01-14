/**
 * @dotdo/convex - Convex SDK compat
 *
 * Drop-in replacement for convex/browser backed by DO SQLite.
 * This implementation provides the full Convex Client API including:
 * - One-shot queries
 * - Reactive subscriptions (onUpdate)
 * - Mutations with optimistic updates
 * - Actions (server-side with external API access)
 * - Authentication
 *
 * @example
 * ```typescript
 * import { ConvexClient } from '@dotdo/convex'
 *
 * const client = new ConvexClient('https://your-deployment.convex.cloud', {
 *   // Extended DO options
 *   shard: { key: 'channel', count: 16 },
 *   replica: { jurisdiction: 'eu', readPreference: 'nearest' },
 * })
 *
 * // One-shot query
 * const messages = await client.query(api.messages.list, {})
 *
 * // Reactive subscription
 * const unsubscribe = client.onUpdate(api.messages.list, {}, (messages) => {
 *   console.log('Messages:', messages)
 * })
 *
 * // Mutation
 * await client.mutation(api.messages.send, { body: 'Hello' })
 *
 * // Action (can call external APIs)
 * const result = await client.action(api.openai.chat, { prompt: 'Hi' })
 *
 * // Authentication
 * client.setAuth(async () => fetchTokenFromAuth0())
 * ```
 *
 * @see https://docs.convex.dev/client/javascript
 */

// Types
export type {
  // Document types
  DocumentId,
  GenericId,
  SystemFields,

  // Function reference types
  FunctionType,
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,

  // Subscription types
  Unsubscribe,
  QueryToken,
  SubscriptionCallback,
  ErrorCallback,

  // Optimistic update types
  OptimisticLocalStore,
  OptimisticUpdate,
  MutationOptions,

  // Authentication types
  AuthTokenFetcher,
  AuthOptions,

  // Error types
  ConvexError,

  // Pagination types
  PaginationOptions,
  PaginationResult,

  // Client types
  ConvexClientOptions,
  ExtendedConvexConfig,
} from './types'

// Core class (also re-exports the type)
export { ConvexClient } from './convex'
