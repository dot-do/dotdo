/**
 * @dotdo/helpscout - Help Scout SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Help Scout API SDK backed by Durable Objects with
 * edge-native performance.
 *
 * Features:
 * - API-compatible with Help Scout Mailbox API v2
 * - Conversations management (create, get, update, delete, list, search)
 * - Threads (customer messages, replies, notes)
 * - Customers management (create, get, update, list, search)
 * - Mailboxes (list, get, folders, custom fields)
 * - Users (list, get, me)
 * - Tags (list, create)
 * - Saved Replies (macros)
 * - Webhooks
 *
 * @example Basic Usage
 * ```typescript
 * import HelpScout from '@dotdo/helpscout'
 *
 * const client = new HelpScout.Client({
 *   oauth: {
 *     clientId: 'your_client_id',
 *     clientSecret: 'your_client_secret',
 *     accessToken: 'your_access_token',
 *   },
 * })
 *
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   subject: 'Help needed',
 *   customer: { email: 'customer@example.com' },
 *   mailboxId: 1,
 *   type: 'email',
 *   threads: [{ type: 'customer', text: 'I need help with...' }],
 * })
 * ```
 *
 * @example Conversations
 * ```typescript
 * import HelpScout from '@dotdo/helpscout'
 *
 * const client = new HelpScout.Client({
 *   oauth: {
 *     clientId: 'your_client_id',
 *     clientSecret: 'your_client_secret',
 *     accessToken: 'your_access_token',
 *   },
 * })
 *
 * // List conversations in a mailbox
 * const conversations = await client.conversations.list({ mailbox: 1 })
 *
 * // Search conversations
 * const results = await client.conversations.search({ query: 'status:active' })
 *
 * // Reply to a conversation
 * await client.conversations.createReply(conversationId, {
 *   text: 'Here is my response...',
 *   user: 123,
 * })
 * ```
 *
 * @example Customers
 * ```typescript
 * import HelpScout from '@dotdo/helpscout'
 *
 * const client = new HelpScout.Client({
 *   oauth: {
 *     clientId: 'your_client_id',
 *     clientSecret: 'your_client_secret',
 *     accessToken: 'your_access_token',
 *   },
 * })
 *
 * // Create a customer
 * const customer = await client.customers.create({
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   emails: [{ type: 'work', value: 'john@example.com' }],
 * })
 *
 * // Search customers
 * const customers = await client.customers.search({ query: 'email:john@example.com' })
 * ```
 *
 * @see https://developer.helpscout.com/mailbox-api/
 */

// Re-export main client
export {
  Client,
  HelpScoutError,
  ConversationsResource,
  CustomersResource,
  MailboxesResource,
  UsersResource,
  SavedRepliesResource,
  TagsResource,
  WebhooksResource,
} from './helpscout'

export { default } from './helpscout'

// Re-export types
export type {
  // Core types
  ConversationStatus,
  ConversationType,
  ThreadType,
  ThreadState,
  ThreadAction,

  // HAL types
  HalLink,
  HalLinks,
  HalEmbedded,
  HalPage,
  HalCollectionResponse,

  // Conversation types
  Source,
  CustomerRef,
  UserRef,
  MailboxRef,
  TagRef,
  CustomFieldValue,
  Conversation,
  Thread,
  ConversationCreateParams,
  ConversationUpdateParams,
  ConversationListParams,
  ConversationSearchParams,
  ThreadCreateParams,

  // Customer types
  SocialProfile,
  CustomerEmail,
  CustomerPhone,
  CustomerWebsite,
  CustomerAddress,
  CustomerChat,
  CustomerProperty,
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,

  // Mailbox types
  Mailbox,
  Folder,
  MailboxField,

  // User types
  User,
  UserListParams,

  // Saved Reply types
  SavedReply,
  SavedReplyCreateParams,
  SavedReplyUpdateParams,

  // Tag types
  Tag,
  TagCreateParams,

  // Workflow types
  Workflow,

  // Docs types
  DocsSite,
  DocsCollection,
  DocsArticle,
  DocsArticleCreateParams,
  DocsArticleUpdateParams,

  // Attachment types
  Attachment,
  AttachmentCreateParams,

  // Webhook types
  Webhook,
  WebhookCreateParams,

  // Report types
  ConversationReport,

  // Error types
  HelpScoutErrorDetail,
  HelpScoutErrorResponse,

  // Client types
  OAuth2Credentials,
  ClientConfig,
  FetchFunction,
  RequestOptions,
} from './types'
