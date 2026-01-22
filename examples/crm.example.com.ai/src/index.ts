/**
 * CRM Tenant DO Example
 *
 * This module exports the tenant context factory and worker entry point
 * for the crm.example.com.ai example.
 *
 * @module examples/crm.example.com.ai/src
 */

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
