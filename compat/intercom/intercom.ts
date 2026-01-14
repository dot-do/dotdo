/**
 * @dotdo/intercom - Intercom API Compatibility Layer
 *
 * Drop-in replacement for intercom-client SDK with edge compatibility.
 *
 * This module re-exports from separate resource modules for better organization:
 * - contacts.ts - Users and leads management
 * - conversations.ts - Conversations and messages
 * - articles.ts - Help center articles
 * - events.ts - Event tracking
 * - client.ts - Main client
 * - local.ts - Local/edge implementation with primitives
 *
 * @example
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({ tokenAuth: { token: 'access_token' } })
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
 * ```
 *
 * @module @dotdo/intercom
 */

// Re-export from separate modules
export { Client, IntercomError } from './client'
export {
  ContactsResource,
  ContactTagsResource,
  ContactCompaniesResource,
  ContactNotesResource,
  ContactSegmentsResource,
  ContactSubscriptionsResource,
  type IntercomClientInterface,
} from './contacts'
export { ConversationsResource, MessagesResource } from './conversations'
export { ArticlesResource } from './articles'
export { EventsResource } from './events'

// Default export for compatibility with `import Intercom from '@dotdo/intercom'`
import { Client } from './client'
export default { Client }
