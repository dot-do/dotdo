/**
 * Payload Database Adapter Types
 *
 * Type definitions for mapping Payload CMS data structures to dotdo Things.
 *
 * @module @dotdo/payload/adapter/types
 */

import type { NounData, NounSchema } from '../../../../types/Noun'
import type { ThingData, Visibility } from '../../../../types/Thing'

// ============================================================================
// PAYLOAD CMS BASE TYPES
// ============================================================================

/**
 * Payload field types - union of all supported field types
 */
export type PayloadFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'code'
  | 'json'
  | 'richText'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'radio'
  | 'relationship'
  | 'upload'
  | 'array'
  | 'group'
  | 'row'
  | 'collapsible'
  | 'tabs'
  | 'blocks'
  | 'point'

/**
 * Base Payload field definition
 */
export interface PayloadField {
  type: PayloadFieldType
  name: string
  required?: boolean
  unique?: boolean
  index?: boolean
  label?: string
  admin?: {
    description?: string
    placeholder?: string
    condition?: unknown
    hidden?: boolean
  }

  // Specific field properties
  options?: readonly string[] | Array<{ label: string; value: string }>
  relationTo?: string | string[]
  hasMany?: boolean
  fields?: PayloadField[]
  min?: number
  max?: number
  defaultValue?: unknown
}

/**
 * Payload collection configuration
 */
export interface PayloadCollection {
  slug: string
  fields: PayloadField[]
  labels?: {
    singular?: string
    plural?: string
  }
  admin?: {
    description?: string
    useAsTitle?: string
    defaultColumns?: string[]
  }
  timestamps?: boolean
  versions?: {
    drafts?: boolean
    maxPerDoc?: number
  }
  hooks?: {
    beforeChange?: unknown[]
    afterChange?: unknown[]
    beforeDelete?: unknown[]
    afterDelete?: unknown[]
  }
}

/**
 * Payload document - base type for all collection documents
 */
export interface PayloadDocument {
  id: string
  createdAt?: string
  updatedAt?: string
  _status?: 'draft' | 'published'
  // Allow arbitrary data fields
  [key: string]: unknown
}

// ============================================================================
// ADAPTER CONFIGURATION
// ============================================================================

/**
 * Configuration options for the Payload database adapter
 */
export interface PayloadAdapterConfig {
  /** dotdo namespace URL (e.g., 'https://example.do') */
  namespace: string

  /** Payload CMS base URL */
  payloadUrl: string

  /** Optional API key for authentication */
  apiKey?: string

  /** Default visibility for synced documents */
  defaultVisibility?: Visibility

  /** Custom collection slug to Noun name mapping */
  collectionMapping?: Record<string, string>

  /** Hook called when syncing a document */
  onDocumentSync?: (doc: PayloadDocument, thing: ThingData) => Promise<ThingData>

  /** Hook called when syncing a collection */
  onCollectionSync?: (collection: PayloadCollection, noun: NounData) => Promise<NounData>
}

// ============================================================================
// TYPE MAPPING TYPES
// ============================================================================

/**
 * Maps a Payload collection to a dotdo Noun
 *
 * @typeParam TCollection - The Payload collection type
 */
export type CollectionToNoun<TCollection extends { slug: string }> = {
  noun: string
  plural?: string
  description?: string
  schema?: NounSchema
}

/**
 * Maps a Payload field to its data type representation
 *
 * @typeParam TField - The Payload field type
 */
export type FieldToData<TField extends PayloadField> =
  TField['type'] extends 'text' | 'textarea' | 'email' | 'code' | 'richText'
    ? TField extends { required: true }
      ? string
      : string | undefined
    : TField['type'] extends 'number'
      ? TField extends { required: true }
        ? number
        : number | undefined
      : TField['type'] extends 'checkbox'
        ? boolean
        : TField['type'] extends 'date'
          ? Date
          : TField['type'] extends 'select'
            ? TField extends { options: readonly (infer O)[] }
              ? O extends string
                ? O
                : never
              : string
            : TField['type'] extends 'array'
              ? unknown[]
              : TField['type'] extends 'group'
                ? Record<string, unknown>
                : TField['type'] extends 'relationship' | 'upload'
                  ? string | string[]
                  : unknown

/**
 * Maps a Payload document to a dotdo ThingData
 *
 * @typeParam TDocument - The Payload document type
 */
export type PayloadDocumentToThing<TDocument extends { id: string }> = {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  visibility?: Visibility
  createdAt: Date
  updatedAt: Date
}

/**
 * Maps a Payload relationship field to a dotdo relationship
 *
 * @typeParam TField - The Payload relationship field type
 */
export type RelationshipFieldMapping<TField extends { type: 'relationship' | 'upload'; name: string }> = {
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

// ============================================================================
// ADAPTER INTERFACE
// ============================================================================

/**
 * Payload database adapter for syncing with dotdo
 */
export interface PayloadDatabaseAdapter {
  // ─────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────

  /** Initialize the adapter */
  init(): Promise<void>

  /** Connect to Payload */
  connect(): Promise<void>

  /** Disconnect from Payload */
  disconnect(): Promise<void>

  // ─────────────────────────────────────────────────────────────────────────
  // COLLECTION SYNC
  // ─────────────────────────────────────────────────────────────────────────

  /** Sync a Payload collection to a dotdo Noun */
  syncCollection(collection: PayloadCollection): Promise<NounData>

  /** Sync a single document to a dotdo Thing */
  syncDocument(collection: string, doc: PayloadDocument): Promise<ThingData>

  /** Get all available collections */
  getCollections(): Promise<PayloadCollection[]>

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENT CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /** Find a single document by ID */
  findDocument(collection: string, id: string): Promise<PayloadDocument | null>

  /** Find multiple documents with query */
  findDocuments(collection: string, query?: {
    where?: Record<string, unknown>
    limit?: number
    page?: number
    sort?: string
  }): Promise<{
    docs: PayloadDocument[]
    totalDocs: number
    hasNextPage: boolean
    hasPrevPage: boolean
    page: number
    totalPages: number
  }>

  /** Create a new document */
  createDocument(collection: string, data: Record<string, unknown>): Promise<PayloadDocument>

  /** Update an existing document */
  updateDocument(collection: string, id: string, data: Record<string, unknown>): Promise<PayloadDocument>

  /** Delete a document */
  deleteDocument(collection: string, id: string): Promise<PayloadDocument>

  // ─────────────────────────────────────────────────────────────────────────
  // RELATIONSHIPS
  // ─────────────────────────────────────────────────────────────────────────

  /** Resolve a relationship field to actual document(s) */
  resolveRelationship(collection: string, docId: string, fieldName: string): Promise<PayloadDocument | PayloadDocument[] | null>

  /** Sync all relationships for a document */
  syncRelationships(collection: string, doc: PayloadDocument): Promise<void>

  // ─────────────────────────────────────────────────────────────────────────
  // TYPE CONVERSION
  // ─────────────────────────────────────────────────────────────────────────

  /** Convert a Payload collection to a dotdo Noun */
  collectionToNoun(collection: PayloadCollection): NounData

  /** Convert a Payload document to a dotdo Thing */
  documentToThing(collection: string, doc: PayloadDocument): ThingData

  /** Convert a Payload field to a dotdo field definition */
  fieldToData(field: PayloadField, value: unknown): unknown
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a slug to PascalCase for Noun names
 *
 * @example
 * slugToNounName('blog-posts') // 'BlogPost'
 * slugToNounName('users') // 'User'
 */
export function slugToNounName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '') // Remove trailing 's' for singular form
}

/**
 * Derive a relationship verb from a field name
 *
 * @example
 * fieldNameToVerb('author') // 'hasAuthor'
 * fieldNameToVerb('categories') // 'hasCategories'
 */
export function fieldNameToVerb(fieldName: string): string {
  return 'has' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
}

/**
 * Map Payload field type to dotdo field type string
 */
export function mapFieldType(payloadType: PayloadFieldType): string {
  switch (payloadType) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'code':
    case 'richText':
      return 'string'
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    case 'select':
    case 'radio':
      return 'string'
    case 'relationship':
    case 'upload':
      return 'relation'
    case 'array':
      return 'array'
    case 'group':
    case 'json':
      return 'object'
    case 'point':
      return 'point'
    default:
      return 'unknown'
  }
}
