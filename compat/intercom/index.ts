/**
 * @dotdo/intercom - Intercom SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for intercom-client backed by Durable Objects with
 * edge-native performance.
 *
 * Features:
 * - API-compatible with `intercom-client` npm package
 * - Contacts management (users and leads)
 * - Conversations (create, reply, assign, close)
 * - Messages (in-app, email)
 * - Events tracking
 * - Articles (help center)
 *
 * @example Basic Usage
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({
 *   tokenAuth: { token: 'access_token' },
 * })
 *
 * // Create a contact
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   custom_attributes: { plan: 'premium' },
 * })
 * ```
 *
 * @example Conversations
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({ tokenAuth: { token: 'token' } })
 *
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   from: { type: 'user', id: 'contact_123' },
 *   body: 'Hello, I need help!',
 * })
 *
 * // Reply as admin
 * await client.conversations.reply({
 *   id: conversation.id,
 *   type: 'admin',
 *   admin_id: 'admin_123',
 *   body: 'How can I help you?',
 *   message_type: 'comment',
 * })
 *
 * // Close the conversation
 * await client.conversations.close({
 *   id: conversation.id,
 *   admin_id: 'admin_123',
 * })
 * ```
 *
 * @example Events Tracking
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({ tokenAuth: { token: 'token' } })
 *
 * // Track an event
 * await client.events.create({
 *   event_name: 'order-completed',
 *   user_id: 'contact_123',
 *   metadata: { order_id: '123', total: 99.99 },
 * })
 * ```
 *
 * @example Messages
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({ tokenAuth: { token: 'token' } })
 *
 * // Send an in-app message
 * await client.messages.create({
 *   message_type: 'inapp',
 *   body: 'Welcome to our service!',
 *   from: { type: 'admin', id: 'admin_123' },
 *   to: { type: 'user', id: 'contact_123' },
 * })
 * ```
 *
 * @see https://developers.intercom.com/docs/references/rest-api/api.intercom.io/
 */

// Re-export main client
export {
  Client,
  IntercomError,
  ContactsResource,
  ConversationsResource,
  MessagesResource,
  EventsResource,
  ArticlesResource,
} from './intercom'

export { default } from './intercom'

// Re-export local implementation
export {
  IntercomLocal,
  type IntercomLocalConfig,
} from './local'

// Re-export types
export type {
  // Core types
  CustomAttributes,
  Pages,
  ListResponse,
  SearchResponse,
  DeletedObject,

  // Contact types
  Contact,
  ContactLocation,
  SocialProfile,
  TagRef,
  NoteRef,
  CompanyRef,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,
  ContactMergeParams,
  DeletedContact,
  SearchQuery,
  SearchQueryField,
  SearchQueryNested,

  // Conversation types
  Conversation,
  ConversationAuthor,
  ConversationSource,
  ConversationAttachment,
  ConversationPart,
  ConversationContactRef,
  ConversationAdminRef,
  ConversationStatistics,
  ConversationRating,
  ConversationSLA,
  ConversationCreateParams,
  ConversationListParams,
  ConversationListResponse,
  ConversationReplyParams,
  ConversationAssignParams,
  ConversationCloseParams,
  ConversationOpenParams,
  ConversationSnoozeParams,
  ConversationSearchParams,

  // Message types
  Message,
  MessageRecipient,
  MessageSender,
  MessageCreateParams,

  // Event types
  Event,
  EventMetadata,
  EventCreateParams,
  EventListParams,
  EventListResponse,
  EventSummaryParams,
  EventSummaryResponse,
  EventSummaryItem,

  // Article types
  Article,
  ArticleStatistics,
  ArticleCreateParams,
  ArticleUpdateParams,
  ArticleListParams,
  ArticleSearchParams,
  ArticleSearchResponse,
  DeletedArticle,

  // Error types
  IntercomErrorDetail,
  IntercomErrorResponse,

  // Client types
  TokenAuth,
  ClientConfig,
  FetchFunction,
  RequestOptions,
} from './types'
