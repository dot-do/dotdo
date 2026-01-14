/**
 * @dotdo/hubspot - HubSpot API Compatibility Layer
 *
 * Drop-in replacement for @hubspot/api-client with edge compatibility.
 * Works in Cloudflare Workers, Deno, and other edge environments.
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/hubspot'
 *
 * const hubspot = new Client({ accessToken: 'pat-xxx' })
 *
 * // Create a contact
 * const contact = await hubspot.crm.contacts.basicApi.create({
 *   properties: { email: 'user@example.com', firstname: 'John' }
 * })
 *
 * // Search contacts
 * const results = await hubspot.crm.contacts.searchApi.doSearch({
 *   filterGroups: [{
 *     filters: [{ propertyName: 'email', operator: 'EQ', value: 'user@example.com' }]
 *   }]
 * })
 * ```
 *
 * @module @dotdo/hubspot
 */

// Re-export client
export { Client, HubSpotError } from './client'

// Re-export types
export type {
  // Base types
  CRMObject,
  Contact,
  Company,
  Deal,
  Ticket,
  Engagement,
  LineItem,
  Product,
  Quote,
  Owner,

  // Association types
  Association,
  AssociationType,
  AssociationResult,

  // Pipeline types
  Pipeline,
  PipelineStage,

  // Property types
  Property,
  PropertyOption,
  PropertyGroup,

  // Schema types
  Schema,

  // Search types
  SearchFilter,
  SearchFilterGroup,
  SearchRequest,
  SearchResult,

  // Batch types
  BatchCreateInput,
  BatchReadInput,
  BatchUpdateInput,
  BatchArchiveInput,
  BatchResult,

  // List types
  ListResult,

  // Input types
  CreateInput,
  UpdateInput,

  // Config types
  ClientConfig,

  // Error types
  HubSpotErrorResponse,
} from './types'
