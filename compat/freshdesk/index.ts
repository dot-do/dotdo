/**
 * @dotdo/freshdesk - Freshdesk SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Freshdesk API SDK backed by Durable Objects with
 * edge-native performance.
 *
 * Features:
 * - API-compatible with Freshdesk API v2
 * - Tickets management (create, get, update, delete, list, search)
 * - Contacts management (create, get, update, list, search)
 * - Companies management (create, get, update, list)
 * - Agents management (list, get, update)
 * - Groups management (list, get, create, update)
 * - Conversations (replies, notes)
 * - Canned Responses (macros)
 *
 * @example Basic Usage
 * ```typescript
 * import Freshdesk from '@dotdo/freshdesk'
 *
 * const client = new Freshdesk.Client({
 *   domain: 'mycompany',
 *   apiKey: 'your_api_key',
 * })
 *
 * // Create a ticket
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need help with...',
 *   email: 'user@example.com',
 *   priority: 2,
 *   status: 2,
 * })
 * ```
 *
 * @example Tickets
 * ```typescript
 * import Freshdesk from '@dotdo/freshdesk'
 *
 * const client = new Freshdesk.Client({
 *   domain: 'mycompany',
 *   apiKey: 'your_api_key',
 * })
 *
 * // List tickets
 * const tickets = await client.tickets.list({ filter: 'open' })
 *
 * // Search tickets
 * const searchResults = await client.tickets.search({ query: '"status:2 AND priority:4"' })
 *
 * // Add a reply
 * await client.conversations.createReply(ticket.id, {
 *   body: 'Here is an update...',
 * })
 * ```
 *
 * @example Contacts
 * ```typescript
 * import Freshdesk from '@dotdo/freshdesk'
 *
 * const client = new Freshdesk.Client({
 *   domain: 'mycompany',
 *   apiKey: 'your_api_key',
 * })
 *
 * // Create a contact
 * const contact = await client.contacts.create({
 *   name: 'John Doe',
 *   email: 'john@example.com',
 * })
 *
 * // Search contacts
 * const contacts = await client.contacts.search({ query: '"email:john@example.com"' })
 * ```
 *
 * @example Companies
 * ```typescript
 * import Freshdesk from '@dotdo/freshdesk'
 *
 * const client = new Freshdesk.Client({
 *   domain: 'mycompany',
 *   apiKey: 'your_api_key',
 * })
 *
 * // Create a company
 * const company = await client.companies.create({
 *   name: 'Acme Inc',
 *   domains: ['acme.com'],
 * })
 * ```
 *
 * @see https://developers.freshdesk.com/api/
 */

// Re-export main client
export {
  Client,
  FreshdeskError,
  TicketsResource,
  ConversationsResource,
  ContactsResource,
  CompaniesResource,
  AgentsResource,
  GroupsResource,
  CannedResponsesResource,
} from './freshdesk'

export { default } from './freshdesk'

// Re-export types
export type {
  // Core types
  TicketStatus,
  TicketPriority,
  TicketSource,
  CustomFieldValue,
  CustomFields,

  // Ticket types
  Ticket,
  TicketStats,
  TicketCreateParams,
  TicketUpdateParams,
  TicketListParams,
  TicketSearchParams,
  SearchResponse,

  // Conversation types
  Conversation,
  ReplyCreateParams,
  NoteCreateParams,

  // Contact types
  Contact,
  ContactAvatar,
  ContactCompanyAssociation,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,

  // Company types
  Company,
  CompanyCreateParams,
  CompanyUpdateParams,
  CompanyListParams,

  // Agent types
  Agent,
  AgentContact,
  AgentCreateParams,
  AgentUpdateParams,
  AgentListParams,

  // Group types
  Group,
  GroupCreateParams,
  GroupUpdateParams,

  // Canned Response types
  CannedResponse,
  CannedResponseFolder,

  // Automation types
  AutomationRule,
  AutomationConditions,
  AutomationCondition,
  AutomationAction,

  // Solution (KB) types
  SolutionCategory,
  SolutionFolder,
  SolutionArticle,
  SeoData,
  SolutionArticleCreateParams,
  SolutionArticleUpdateParams,

  // Attachment types
  Attachment,
  AttachmentUploadParams,

  // SLA types
  SLAPolicy,
  SLAApplicableTo,
  SLATarget,
  SLAEscalation,
  SLAEscalationLevel,

  // Webhook types
  Webhook,

  // List response types
  ListResponse,

  // Error types
  FreshdeskErrorDetail,
  FreshdeskErrorResponse,

  // Client types
  ClientConfig,
  FetchFunction,
  RequestOptions,
} from './types'
