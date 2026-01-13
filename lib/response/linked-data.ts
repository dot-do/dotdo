/**
 * Response Shape Builder
 *
 * Functions for adding JSON-LD style linked data properties ($context, $type, $id)
 * to plain objects for consistent API responses.
 */

import { buildContextUrl, buildTypeUrl, buildIdUrl } from './urls'

// ============================================================================
// ERROR RESPONSE TYPES AND BUILDER
// ============================================================================

/**
 * Standard error codes used across the API
 */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'DUPLICATE'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'

/**
 * JSON-LD formatted error response
 */
export interface ErrorResponse {
  $type: 'Error'
  code: ErrorCode
  message: string
}

/**
 * Build a JSON-LD formatted error response
 *
 * @param code - The error code (e.g., 'NOT_FOUND', 'BAD_REQUEST')
 * @param message - Human-readable error message
 * @returns Error response with $type: 'Error'
 *
 * @example
 * ```ts
 * buildErrorResponse('NOT_FOUND', 'Customer not found: alice')
 * // -> { $type: 'Error', code: 'NOT_FOUND', message: 'Customer not found: alice' }
 * ```
 */
export function buildErrorResponse(code: ErrorCode, message: string): ErrorResponse {
  return {
    $type: 'Error',
    code,
    message,
  }
}

// ============================================================================
// LINKED DATA RESPONSE BUILDER
// ============================================================================

/**
 * Options for building a response with linked data properties
 */
export interface ResponseOptions {
  /** Namespace URL like "https://headless.ly" */
  ns: string
  /** Entity type in PascalCase, e.g., "Customer" */
  type: string
  /** Entity ID, e.g., "alice" (undefined for collection) */
  id?: string
  /** Parent namespace for root responses */
  parent?: string
  /** True if this is the DO root response */
  isRoot?: boolean
  /** True for collection responses */
  isCollection?: boolean
}

/**
 * Result type with linked data properties added
 */
export type LinkedDataResponse<T extends object> = T & {
  $context: string
  $type: string
  $id: string
}

/**
 * Build a response object with JSON-LD style linked data properties
 *
 * @param data - The plain object to enhance
 * @param options - Options for building the response URLs
 * @returns The data object with $context, $type, $id added
 *
 * @example Item response:
 * ```ts
 * buildResponse({ name: 'Alice' }, { ns: 'https://headless.ly', type: 'Customer', id: 'alice' })
 * // -> { $context: 'https://headless.ly', $type: 'https://headless.ly/customers', $id: 'https://headless.ly/customers/alice', name: 'Alice' }
 * ```
 *
 * @example Collection response:
 * ```ts
 * buildResponse({ items: [] }, { ns: 'https://headless.ly', type: 'Customer', isCollection: true })
 * // -> { $context: 'https://headless.ly', $type: 'https://headless.ly/customers', $id: 'https://headless.ly/customers', items: [] }
 * ```
 *
 * @example Root response:
 * ```ts
 * buildResponse({ name: 'My Startup' }, { ns: 'https://headless.ly', type: 'Startup', isRoot: true, parent: 'https://Startups.Studio' })
 * // -> { $context: 'https://Startups.Studio', $type: 'https://headless.ly', $id: 'https://headless.ly', name: 'My Startup' }
 * ```
 */
export function buildResponse<T extends object>(
  data: T,
  options: ResponseOptions
): LinkedDataResponse<T> {
  const { ns, type, id, parent, isRoot, isCollection } = options

  // 1. $context:
  //    - If isRoot and parent provided: use parent
  //    - If isRoot and no parent (orphan): use schema.org.ai/{type}
  //    - If isRoot and no parent and isCollection: use schema.org.ai/Collection
  //    - Otherwise: use ns
  const $context = buildContextUrl(ns, { parent, isRoot, isCollection, type })

  // 2. $type:
  //    - If isRoot: use ns (the DO itself is the type)
  //    - Otherwise: buildTypeUrl(ns, type)
  const $type = isRoot ? ns : buildTypeUrl(ns, type)

  // 3. $id:
  //    - If isRoot: use ns
  //    - If isCollection: buildTypeUrl(ns, type) (same as $type)
  //    - Otherwise: buildIdUrl(ns, type, id)
  let $id: string
  if (isRoot) {
    $id = ns
  } else if (isCollection) {
    $id = buildTypeUrl(ns, type)
  } else {
    $id = buildIdUrl(ns, type, id!)
  }

  // Return { $context, $type, $id, ...data }
  // Note: spread data first, then add linked data props after
  // to ensure our values take precedence over any existing $context/$type/$id
  return {
    ...data,
    $context,
    $type,
    $id,
  } as LinkedDataResponse<T>
}
