/**
 * Noun Registry for Graph Things
 *
 * Provides lookup functions for registered Nouns (type definitions) in the
 * graph model. Nouns define the types of Things that can be stored.
 *
 * The Workflow noun is registered at rowid=100.
 *
 * @see dotdo-1oy0j - [GREEN] Workflow definition as Thing - schema tests
 *
 * @example
 * ```typescript
 * import { getNoun, getNounById, listNouns } from 'db/graph/nouns'
 *
 * const workflowNoun = await getNoun(store, 'Workflow')
 * // { rowid: 100, name: 'Workflow' }
 * ```
 */

import type { GraphStore } from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Noun definition - represents a type in the graph.
 */
export interface Noun {
  /** The rowid/typeId for this noun */
  rowid: number
  /** The noun name */
  name: string
  /** Human-readable description */
  description?: string
  /** Schema definition for data validation */
  schema?: Record<string, unknown>
}

// ============================================================================
// NOUN REGISTRY
// ============================================================================

/**
 * Built-in noun definitions.
 *
 * These are the canonical noun types registered in the system.
 * The rowid values correspond to typeId values in GraphThing.
 */
export const NOUN_REGISTRY: Record<string, Noun> = {
  // Auth types (1-9)
  User: { rowid: 1, name: 'User', description: 'Auth user (legacy compat)' },
  Session: { rowid: 2, name: 'Session', description: 'Auth session' },
  Account: { rowid: 3, name: 'Account', description: 'Auth account' },
  Verification: { rowid: 4, name: 'Verification', description: 'Auth verification' },
  JWKS: { rowid: 5, name: 'JWKS', description: 'JSON Web Key Set' },
  Organization: { rowid: 6, name: 'Organization', description: 'Auth organization (legacy)' },
  Member: { rowid: 7, name: 'Member', description: 'Organization member' },
  Invitation: { rowid: 8, name: 'Invitation', description: 'Organization invitation' },
  ApiKey: { rowid: 9, name: 'ApiKey', description: 'API key' },

  // Human types (10-29)
  HumanUser: { rowid: 10, name: 'HumanUser', description: 'Human user' },
  HumanOrganization: { rowid: 11, name: 'HumanOrganization', description: 'Human organization' },
  Role: { rowid: 12, name: 'Role', description: 'User role' },
  HumanSession: { rowid: 13, name: 'HumanSession', description: 'Human session' },
  HumanAccount: { rowid: 14, name: 'HumanAccount', description: 'Human account' },
  HumanInvitation: { rowid: 15, name: 'HumanInvitation', description: 'Human invitation' },
  ApprovalRequest: { rowid: 16, name: 'ApprovalRequest', description: 'Approval request' },
  Team: { rowid: 17, name: 'Team', description: 'Team' },
  HumanApiKey: { rowid: 18, name: 'HumanApiKey', description: 'Human API key' },
  HumanVerification: { rowid: 19, name: 'HumanVerification', description: 'Human verification' },

  // Git types (50-99)
  Commit: { rowid: 50, name: 'Commit', description: 'Git commit' },
  Tree: { rowid: 51, name: 'Tree', description: 'Git tree' },
  Blob: { rowid: 52, name: 'Blob', description: 'Git blob' },
  Ref: { rowid: 53, name: 'Ref', description: 'Git reference' },

  // Workflow type (100)
  Workflow: {
    rowid: 100,
    name: 'Workflow',
    description: 'Workflow definition with steps and triggers',
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        version: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              type: { enum: ['do', 'sleep', 'waitForEvent'] },
              timeout: { type: 'number' },
              retries: { type: 'number' },
              duration: { type: 'number' },
              event: { type: 'string' },
              handler: { type: 'string' },
            },
          },
        },
        triggers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'config'],
            properties: {
              type: { enum: ['event', 'cron', 'webhook', 'manual'] },
              config: { type: 'object' },
            },
          },
        },
        metadata: { type: 'object' },
      },
    },
  },

  // Function types (100-119) - Note: CodeFunction overlaps with Workflow at 100
  // This is legacy compatibility - use specific type IDs
  GenerativeFunction: { rowid: 101, name: 'GenerativeFunction', description: 'Generative function' },
  AgenticFunction: { rowid: 102, name: 'AgenticFunction', description: 'Agentic function' },
  HumanFunction: { rowid: 103, name: 'HumanFunction', description: 'Human-in-the-loop function' },
  FunctionVersion: { rowid: 110, name: 'FunctionVersion', description: 'Function version' },
  FunctionRef: { rowid: 111, name: 'FunctionRef', description: 'Function reference' },
  FunctionBlob: { rowid: 112, name: 'FunctionBlob', description: 'Function blob' },

  // Function version adapter types (120-129) - gitx-style versioning
  // Used by function-version-adapter.ts for content-addressable storage
  Function: { rowid: 120, name: 'Function', description: 'Function definition' },
  FunctionVersionV2: { rowid: 121, name: 'FunctionVersion', description: 'Function version (gitx-style)' },
  FunctionBlobV2: { rowid: 122, name: 'FunctionBlob', description: 'Function blob (content-addressable)' },
  FunctionRefV2: { rowid: 123, name: 'FunctionRef', description: 'Function reference (branch/tag)' },

  // Human execution types (150-199)
  HumanTask: { rowid: 150, name: 'HumanTask', description: 'Human task' },
  HumanNotification: { rowid: 151, name: 'HumanNotification', description: 'Human notification' },
  HumanAudit: { rowid: 152, name: 'HumanAudit', description: 'Human audit record' },

  // Human request types (200-249)
  ApprovalRequestType: { rowid: 200, name: 'approval', description: 'Approval request type' },
  TaskRequestType: { rowid: 201, name: 'task', description: 'Task request type' },
  DecisionRequestType: { rowid: 202, name: 'decision', description: 'Decision request type' },
  ReviewRequestType: { rowid: 203, name: 'review', description: 'Review request type' },
  QuestionRequestType: { rowid: 204, name: 'question', description: 'Question request type' },

  // Workflow instance types (400-499)
  WorkflowInstance: { rowid: 400, name: 'WorkflowInstance', description: 'Running workflow instance' },
  Schedule: { rowid: 401, name: 'Schedule', description: 'Workflow schedule' },

  // Customer type (used in tests)
  Customer: { rowid: 500, name: 'Customer', description: 'Customer entity' },
}

/**
 * Lookup table by rowid for efficient ID-based lookups.
 */
const NOUN_BY_ID: Map<number, Noun> = new Map(
  Object.values(NOUN_REGISTRY).map((noun) => [noun.rowid, noun])
)

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Get a Noun by its name.
 *
 * This function returns the noun definition from the built-in registry.
 * The GraphStore parameter is accepted for API consistency but currently
 * only looks up from the static registry.
 *
 * @param store - GraphStore instance (for future database-backed lookups)
 * @param name - The noun name to look up
 * @returns The Noun or null if not found
 *
 * @example
 * ```typescript
 * const workflowNoun = await getNoun(store, 'Workflow')
 * // { rowid: 100, name: 'Workflow', ... }
 * ```
 */
export async function getNoun(
  store: GraphStore,
  name: string
): Promise<Noun | null> {
  return NOUN_REGISTRY[name] ?? null
}

/**
 * Get a Noun by its rowid/typeId.
 *
 * @param store - GraphStore instance
 * @param rowid - The noun rowid/typeId
 * @returns The Noun or null if not found
 *
 * @example
 * ```typescript
 * const noun = await getNounById(store, 100)
 * // { rowid: 100, name: 'Workflow', ... }
 * ```
 */
export async function getNounById(
  store: GraphStore,
  rowid: number
): Promise<Noun | null> {
  return NOUN_BY_ID.get(rowid) ?? null
}

/**
 * List all registered Nouns.
 *
 * @param store - GraphStore instance
 * @returns Array of all Noun definitions
 */
export async function listNouns(store: GraphStore): Promise<Noun[]> {
  return Object.values(NOUN_REGISTRY)
}

/**
 * Check if a noun with the given name exists.
 *
 * @param store - GraphStore instance
 * @param name - The noun name to check
 * @returns true if the noun exists
 */
export async function hasNoun(store: GraphStore, name: string): Promise<boolean> {
  return name in NOUN_REGISTRY
}

/**
 * Check if a noun with the given rowid exists.
 *
 * @param store - GraphStore instance
 * @param rowid - The noun rowid to check
 * @returns true if the noun exists
 */
export async function hasNounById(store: GraphStore, rowid: number): Promise<boolean> {
  return NOUN_BY_ID.has(rowid)
}

/**
 * Get the rowid for a noun name.
 *
 * @param name - The noun name
 * @returns The rowid or undefined if not found
 */
export function getNounRowid(name: string): number | undefined {
  return NOUN_REGISTRY[name]?.rowid
}

/**
 * Get the noun name for a rowid.
 *
 * @param rowid - The noun rowid
 * @returns The noun name or undefined if not found
 */
export function getNounName(rowid: number): string | undefined {
  return NOUN_BY_ID.get(rowid)?.name
}

// ============================================================================
// CONSTANTS EXPORT
// ============================================================================

/**
 * Workflow noun rowid constant.
 */
export const WORKFLOW_NOUN_ROWID = 100
