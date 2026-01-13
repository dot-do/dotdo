/**
 * Tool Thing Type Definition
 *
 * Defines the Tool entity type for the graph storage system.
 * Tools represent executable operations that can be invoked by
 * agents or humans.
 *
 * Features:
 * - Category hierarchy for organization
 * - Parameter schema validation
 * - Audience targeting (agent/human/both)
 * - Security levels for access control
 * - Version tracking
 */

// ============================================================================
// Tool Categories
// ============================================================================

/**
 * Tool category hierarchy - top-level categories
 */
export type ToolCategory =
  | 'communication'
  | 'data'
  | 'development'
  | 'ai'
  | 'integration'
  | 'system'
  | 'custom'

/**
 * Tool audience - who can use this tool
 */
export type ToolAudience = 'agent' | 'human' | 'both'

/**
 * Security level for tool execution
 */
export type SecurityLevel = 'public' | 'internal' | 'restricted' | 'admin'

// ============================================================================
// Tool Parameters
// ============================================================================

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  /** Parameter name (required) */
  name: string
  /** Parameter type (string, number, boolean, object, array, null) */
  type: string
  /** Whether the parameter is required */
  required?: boolean
  /** Parameter description */
  description?: string
  /** Default value */
  default?: unknown
  /** Allowed values for enum types */
  enum?: string[]
}

/**
 * Tool output definition
 */
export interface ToolOutput {
  /** Output type */
  type: string
  /** Output description */
  description?: string
  /** JSON Schema for the output */
  schema?: Record<string, unknown>
}

// ============================================================================
// Tool Thing
// ============================================================================

/**
 * Tool Thing data interface
 *
 * Represents an executable tool in the system that can be
 * invoked by agents or humans.
 */
export interface ToolThingData {
  // Identity
  /** Unique tool identifier (e.g., 'communication.email.send') */
  id: string
  /** Human-readable tool name */
  name: string
  /** Tool description */
  description: string
  /** Tool version string */
  version?: string

  // Classification
  /** Top-level category */
  category: ToolCategory
  /** Subcategory within the main category */
  subcategory?: string
  /** Tags for additional classification */
  tags?: string[]

  // Access Control
  /** Who can use this tool */
  audience?: ToolAudience
  /** Security level required to execute */
  securityLevel?: SecurityLevel

  // Schema
  /** Input parameters */
  parameters: ToolParameter[]
  /** Output definition */
  output?: ToolOutput

  // Metadata
  /** Tool author */
  author?: string
  /** Documentation URL */
  docsUrl?: string
  /** Whether human confirmation is required before execution */
  requiresConfirmation?: boolean
  /** Whether the tool is idempotent (safe to retry) */
  idempotent?: boolean
  /** Estimated execution duration in milliseconds */
  estimatedDuration?: number
  /** Cost per execution (in credits or currency) */
  costPerExecution?: number
}

/**
 * Full Tool Thing interface with graph metadata
 */
export interface ToolThing extends ToolThingData {
  /** Graph node ID */
  $id: string
  /** Type discriminator */
  $type: 'Tool'
  /** Numeric version for optimistic locking */
  versionNumber: number
  /** Required permissions to execute */
  permissions: string[]
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
  /** Soft delete timestamp */
  deletedAt?: Date
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid ToolCategory
 */
export function isToolCategory(value: unknown): value is ToolCategory {
  return (
    typeof value === 'string' &&
    ['communication', 'data', 'development', 'ai', 'integration', 'system', 'custom'].includes(value)
  )
}

/**
 * Check if a value is a valid ToolAudience
 */
export function isToolAudience(value: unknown): value is ToolAudience {
  return typeof value === 'string' && ['agent', 'human', 'both'].includes(value)
}

/**
 * Check if a value is a valid SecurityLevel
 */
export function isSecurityLevel(value: unknown): value is SecurityLevel {
  return typeof value === 'string' && ['public', 'internal', 'restricted', 'admin'].includes(value)
}

/**
 * Check if a value is a ToolThing
 */
export function isToolThing(value: unknown): value is ToolThing {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    obj.$type === 'Tool' &&
    typeof obj.$id === 'string' &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    isToolCategory(obj.category)
  )
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid tool categories
 */
export const TOOL_CATEGORIES: ToolCategory[] = [
  'communication',
  'data',
  'development',
  'ai',
  'integration',
  'system',
  'custom',
]

/**
 * Valid tool audiences
 */
export const TOOL_AUDIENCES: ToolAudience[] = ['agent', 'human', 'both']

/**
 * Security levels in order from lowest to highest
 */
export const SECURITY_LEVELS: SecurityLevel[] = ['public', 'internal', 'restricted', 'admin']

/**
 * Valid parameter types
 */
export const PARAMETER_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const

export type ParameterType = (typeof PARAMETER_TYPES)[number]
