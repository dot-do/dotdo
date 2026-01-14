/**
 * @dotdo/intercom - Intercom SDK Compatibility Layer
 *
 * Drop-in replacement for intercom-client SDK with edge compatibility.
 * Works on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * @example
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * // Create a client
 * const client = new Intercom.Client({
 *   tokenAuth: { token: 'your_access_token' },
 * })
 *
 * // Create a contact
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   from: { type: 'user', id: contact.id },
 *   body: 'Hello, I need help!',
 * })
 *
 * // Track an event
 * await client.events.create({
 *   event_name: 'signed-up',
 *   user_id: contact.id,
 * })
 * ```
 *
 * ## Local Development
 *
 * For testing and local development, use the in-memory backend:
 *
 * ```typescript
 * import { IntercomLocal } from '@dotdo/intercom'
 *
 * const client = new IntercomLocal({
 *   workspaceId: 'test-workspace',
 * })
 *
 * // Same API as the real client, but data stays in memory
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'test@example.com',
 * })
 * ```
 *
 * @module @dotdo/intercom
 */

// =============================================================================
// Main Exports
// =============================================================================

// Client
export { Client, IntercomError } from './client'
export type { IntercomClientInterface } from './contacts'

// Local/In-Memory Implementation
export { IntercomLocal } from './local'
export type { IntercomLocalConfig } from './local'

// Resources
export { ContactsResource } from './contacts'
export { ConversationsResource, MessagesResource } from './conversations'
export { EventsResource } from './events'
export { ArticlesResource } from './articles'

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core types
  CustomAttributes,
  Pages,
  ListResponse,
  SearchResponse,
  DeletedObject,

  // Contact types
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,
  ContactMergeParams,
  DeletedContact,
  ContactLocation,
  SocialProfile,
  Tag,
  TagRef,
  ContactTagParams,
  Company,
  CompanyRef,
  ContactCompanyAttachParams,
  Note,
  NoteCreateParams,
  NoteRef,
  Segment,
  ContactSubscription,
  ContactSubscriptionUpdateParams,

  // Search query types
  SearchQuery,
  SearchQueryField,
  SearchQueryNested,

  // Conversation types
  Conversation,
  ConversationCreateParams,
  ConversationListParams,
  ConversationListResponse,
  ConversationReplyParams,
  ConversationAssignParams,
  ConversationCloseParams,
  ConversationOpenParams,
  ConversationSnoozeParams,
  ConversationSearchParams,
  ConversationPart,
  ConversationSource,
  ConversationAuthor,
  ConversationContactRef,
  ConversationAdminRef,
  ConversationAttachment,
  ConversationStatistics,
  ConversationRating,
  ConversationSLA,

  // Message types
  Message,
  MessageCreateParams,
  MessageRecipient,
  MessageSender,

  // Event types
  Event,
  EventCreateParams,
  EventListParams,
  EventListResponse,
  EventSummaryParams,
  EventSummaryResponse,
  EventSummaryItem,
  EventMetadata,

  // Article types
  Article,
  ArticleCreateParams,
  ArticleUpdateParams,
  ArticleListParams,
  ArticleSearchParams,
  ArticleSearchResponse,
  ArticleStatistics,
  DeletedArticle,

  // Client config types
  ClientConfig,
  TokenAuth,
  RequestOptions,
  FetchFunction,

  // Error types
  IntercomErrorDetail,
  IntercomErrorResponse,
} from './types'

// =============================================================================
// Default Export (Namespace style like original SDK)
// =============================================================================

import { Client } from './client'

export default { Client }
