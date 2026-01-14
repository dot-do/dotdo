/**
 * Entities domain - Domain object containers and collections
 *
 * Exports:
 * - Entity: Base class for domain objects with schema validation and indexed queries
 * - Collection: Named collection of entities with bulk operations and aggregations
 * - CollectionDO: Single-collection Durable Object with /:id routing
 * - Directory: Hierarchical entity organization with path-based access
 * - Package: Versioned code package with dependencies
 */

// Entity - Base domain object with schema validation
export { Entity } from './Entity'
export type { EntitySchema, FieldDefinition, EntityRecord } from './Entity'

// Collection - Named collection with bulk operations
export { Collection } from './Collection'
export type { CollectionConfig } from './Collection'

// CollectionDO - Single-collection DO with /:id routing
export { CollectionDO } from './CollectionDO'
export type {
  MockThingsStore,
  CollectionDOConfig,
  CollectionRootResponse,
  CollectionItemResponse,
} from './CollectionDO'

// Directory - Hierarchical entity organization
export { Directory } from './Directory'
export type { DirectoryEntry } from './Directory'

// Package - Versioned code package
export { Package } from './Package'
export type { PackageVersion, PackageConfig } from './Package'
