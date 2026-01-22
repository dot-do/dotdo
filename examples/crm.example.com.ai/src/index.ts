/**
 * CRM Tenant DO Example
 *
 * This module exports the tenant context factory, TenantDO class,
 * and worker entry point for the crm.example.com.ai example.
 *
 * @module examples/crm.example.com.ai/src
 */

// Export the tenant context factory
export { $Context } from './context'
export type {
  TenantContext,
  ParentContext,
  TenantEvent,
  TenantThing,
  ThingInput,
  TenantRelationship,
  RelationshipInput,
  TenantStoredEvent,
  TenantThingsStore,
  TenantRelationshipsStore,
  TenantEventsStore,
} from './context'

// Export the TenantDO class
export { TenantDO } from './TenantDO'

// Export the worker entry point types
export type { Env } from './worker'
