/**
 * Relationships Builder Utilities
 *
 * Functions for building relationship and reference links for API responses.
 * Relationships show how items connect to other items - forward relationships
 * (from this item) and reverse references (to this item).
 */

import { pluralize, normalizeNs } from './urls'

/**
 * Options for building relationships
 */
export interface RelationshipsOptions {
  ns: string
  type: string
  id: string
  relationships?: Record<string, string | string[]>
  references?: Record<string, string | string[]>
}

/**
 * Result of building relationships
 */
export interface RelationshipsResult {
  relationships?: Record<string, string | string[]>
  references?: Record<string, string | string[]>
}

/**
 * Map relationship verbs to their target types.
 * Verbs not in this map default to the same type as the source entity.
 */
const VERB_TO_TYPE: Record<string, string> = {
  // Company/organization relationships
  worksAt: 'Company',
  employeeOf: 'Company',

  // Category relationships
  belongsTo: 'Category',

  // User relationships
  assignedTo: 'User',

  // Customer relationships
  placedBy: 'Customer',

  // Product relationships
  contains: 'Product',

  // Project relationships
  // Note: belongsTo is already mapped to Category above, handled specially
}

/**
 * Map for specific verbs that point to Projects
 */
const PROJECT_VERBS = new Set(['belongsTo'])

/**
 * Map for specific verbs that point to Tasks
 */
const TASK_VERBS = new Set(['blocks', 'blockedBy'])

/**
 * Infer the target type from a relationship verb and source type.
 *
 * @param verb - The relationship verb (e.g., "worksAt", "manages")
 * @param sourceType - The type of the source entity (e.g., "Contact")
 * @returns The inferred target type
 */
function inferTargetType(verb: string, sourceType: string): string {
  // Special case: Task type with belongsTo goes to Project
  if (sourceType === 'Task' && PROJECT_VERBS.has(verb)) {
    return 'Project'
  }

  // Special case: Task verbs go to Task
  if (TASK_VERBS.has(verb)) {
    return 'Task'
  }

  // Check if verb has a known mapping
  if (VERB_TO_TYPE[verb]) {
    return VERB_TO_TYPE[verb]
  }

  // Default: same type as source (e.g., manages, reportsTo, managedBy, mentors, etc.)
  return sourceType
}

/**
 * URL-encode an ID for use in a URL path segment
 */
function encodeId(id: string): string {
  return encodeURIComponent(id)
}

/**
 * Build a fully qualified URL for a target ID
 *
 * @param ns - The namespace URL
 * @param targetType - The target entity type
 * @param targetId - The target entity ID
 * @returns The fully qualified URL
 */
function buildTargetUrl(ns: string, targetType: string, targetId: string): string {
  const normalizedNs = normalizeNs(ns)
  const pluralType = pluralize(targetType)
  const encodedId = encodeId(targetId)
  return `${normalizedNs}/${pluralType}/${encodedId}`
}

/**
 * Process a relationship or reference value (single or array) into URLs
 *
 * @param value - The relationship value (ID or array of IDs)
 * @param ns - The namespace URL
 * @param verb - The relationship verb
 * @param sourceType - The source entity type
 * @returns The URL or array of URLs
 */
function processRelationshipValue(
  value: string | string[],
  ns: string,
  verb: string,
  sourceType: string
): string | string[] {
  const targetType = inferTargetType(verb, sourceType)

  if (Array.isArray(value)) {
    return value.map((id) => buildTargetUrl(ns, targetType, id))
  }

  return buildTargetUrl(ns, targetType, value)
}

/**
 * Build relationship and reference links for an item
 *
 * Converts relationship/reference IDs to fully qualified URLs based on
 * the verb semantics. For example, "worksAt: 'acme'" becomes
 * "worksAt: 'https://ns/companies/acme'" because worksAt implies Company.
 *
 * @param options - Relationships options
 * @returns Object with relationship and reference URLs
 */
export function buildRelationships(options: RelationshipsOptions): RelationshipsResult {
  const { ns, type, relationships, references } = options
  const result: RelationshipsResult = {}

  // Process relationships if provided
  if (relationships && Object.keys(relationships).length > 0) {
    result.relationships = {}
    for (const [verb, value] of Object.entries(relationships)) {
      result.relationships[verb] = processRelationshipValue(value, ns, verb, type)
    }
  }

  // Process references if provided
  if (references && Object.keys(references).length > 0) {
    result.references = {}
    for (const [verb, value] of Object.entries(references)) {
      result.references[verb] = processRelationshipValue(value, ns, verb, type)
    }
  }

  return result
}
