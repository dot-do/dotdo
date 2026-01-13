/**
 * Graph Type ID Constants
 *
 * Centralized type ID definitions for all Things stored in the graph.
 * This file provides a single source of truth to prevent ID conflicts
 * and ensure consistency across all graph adapters.
 *
 * ## Type ID Ranges
 *
 * To avoid conflicts, type IDs are organized into ranges:
 *
 * - 1-9:     Auth/Session types (legacy compat layer)
 * - 10-29:   Human types (User, Org, Role, Session, etc.)
 * - 30-49:   Reserved for future core types
 * - 50-99:   Git types (Commit, Tree, Blob, Ref)
 * - 100-109: Function types by kind (Code, Generative, Agentic, Human)
 * - 110-119: Function versioning types (Version, Ref, Blob)
 * - 120-149: Reserved for future function types
 * - 150-199: Human execution types (Task, Notification, Audit)
 * - 200-249: Human request types (Approval, Task, Decision, Review, Question)
 * - 250-299: Reserved for future human types
 * - 300-399: Agent types
 * - 400-499: Workflow types
 * - 500+:    Custom/application-specific types
 *
 * @module db/graph/constants
 */

// ============================================================================
// AUTH/SESSION TYPE IDS (1-9) - Legacy compat layer
// ============================================================================

/**
 * Auth type IDs for compat layer (session-thing-store, auth adapters)
 *
 * These are kept for backward compatibility with existing auth implementations.
 */
export const AUTH_TYPE_IDS = {
  User: 1,
  Session: 2,
  Account: 3,
  Verification: 4,
  JWKS: 5,
  Organization: 6,
  Member: 7,
  Invitation: 8,
  ApiKey: 9,
} as const

// ============================================================================
// HUMAN TYPE IDS (10-29)
// ============================================================================

/**
 * Type IDs for human-related Things in the graph
 *
 * These are the canonical type IDs for User, Organization, Role, etc.
 * Used by db/graph/humans/ and related modules.
 */
export const HUMAN_TYPE_IDS = {
  User: 10,
  Organization: 11,
  Role: 12,
  Session: 13,
  Account: 14,
  Invitation: 15,
  ApprovalRequest: 16,
  Team: 17,
  ApiKey: 18,
  Verification: 19,
} as const

// ============================================================================
// GIT TYPE IDS (50-99)
// ============================================================================

/**
 * Type IDs for Git objects in the graph
 */
export const GIT_TYPE_IDS = {
  Commit: 50,
  Tree: 51,
  Blob: 52,
  Ref: 53,
} as const

// ============================================================================
// FUNCTION TYPE IDS (100-119)
// ============================================================================

/**
 * Type IDs for function types by kind
 *
 * Range 100-109: Function types by execution kind
 * Range 110-119: Function versioning/metadata types (function-graph-adapter)
 */
export const FUNCTION_TYPE_IDS = {
  // Function types by kind (100-109)
  CodeFunction: 100,
  GenerativeFunction: 101,
  AgenticFunction: 102,
  HumanFunction: 103,

  // Legacy: generic Function type (uses kind-specific ID at runtime)
  Function: 100,

  // Versioning types (110-119) - used by function-graph-adapter
  FunctionVersion: 110,
  FunctionRef: 111,
  FunctionBlob: 112,
} as const

// ============================================================================
// FUNCTION VERSION ADAPTER TYPE IDS (120-129)
// ============================================================================

/**
 * Type IDs for function-version-adapter (gitx-style versioning)
 *
 * This is a separate adapter from function-graph-adapter with its own
 * type ID range for function versioning using content-addressable storage.
 *
 * Range 120-129: Function version adapter types
 */
export const FUNCTION_VERSION_TYPE_IDS = {
  Function: 120,
  FunctionVersion: 121,
  FunctionBlob: 122,
  FunctionRef: 123,
} as const

// ============================================================================
// HUMAN EXECUTION TYPE IDS (150-199)
// ============================================================================

/**
 * Type IDs for human execution service Things
 *
 * Used by lib/executors/HumanGraphService.ts
 */
export const HUMAN_EXECUTION_TYPE_IDS = {
  HumanTask: 150,
  HumanNotification: 151,
  HumanAudit: 152,
} as const

// ============================================================================
// HUMAN REQUEST TYPE IDS (200-249)
// ============================================================================

/**
 * Type IDs for Human Request Things
 *
 * Used by lib/human/graph-store.ts
 */
export const HUMAN_REQUEST_TYPE_IDS = {
  approval: 200,
  task: 201,
  decision: 202,
  review: 203,
  question: 204,
} as const

// ============================================================================
// AGENT TYPE IDS (300-349)
// ============================================================================

/**
 * Type IDs for Agent-related Things
 *
 * Range 300-349: Agent, Tool, Provider types
 */
export const AGENT_TYPE_IDS = {
  Agent: 300,
  Tool: 301,
  Provider: 302,
  Capability: 303,
} as const

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AuthTypeId = (typeof AUTH_TYPE_IDS)[keyof typeof AUTH_TYPE_IDS]
export type HumanTypeId = (typeof HUMAN_TYPE_IDS)[keyof typeof HUMAN_TYPE_IDS]
export type GitTypeId = (typeof GIT_TYPE_IDS)[keyof typeof GIT_TYPE_IDS]
export type FunctionTypeId = (typeof FUNCTION_TYPE_IDS)[keyof typeof FUNCTION_TYPE_IDS]
export type FunctionVersionTypeId = (typeof FUNCTION_VERSION_TYPE_IDS)[keyof typeof FUNCTION_VERSION_TYPE_IDS]
export type HumanExecutionTypeId = (typeof HUMAN_EXECUTION_TYPE_IDS)[keyof typeof HUMAN_EXECUTION_TYPE_IDS]
export type HumanRequestTypeId = (typeof HUMAN_REQUEST_TYPE_IDS)[keyof typeof HUMAN_REQUEST_TYPE_IDS]
export type AgentTypeId = (typeof AGENT_TYPE_IDS)[keyof typeof AGENT_TYPE_IDS]

// ============================================================================
// COMBINED TYPE IDS (for convenience)
// ============================================================================

/**
 * All type IDs combined into a single object
 *
 * Use this for cases where you need access to all type IDs,
 * or prefer the individual exports for domain-specific usage.
 */
export const TYPE_IDS = {
  // Auth (1-9)
  ...AUTH_TYPE_IDS,

  // Note: HUMAN_TYPE_IDS overlap with AUTH_TYPE_IDS for some keys
  // The canonical versions are in HUMAN_TYPE_IDS (10-29 range)
  // Use specific exports when disambiguation is needed

  // Git (50-99)
  ...GIT_TYPE_IDS,

  // Functions (100-119)
  ...FUNCTION_TYPE_IDS,

  // Human Execution (150-199)
  ...HUMAN_EXECUTION_TYPE_IDS,

  // Agents (300-349)
  ...AGENT_TYPE_IDS,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a type ID is in the auth range (1-9)
 */
export function isAuthTypeId(typeId: number): boolean {
  return typeId >= 1 && typeId <= 9
}

/**
 * Check if a type ID is in the human range (10-29)
 */
export function isHumanTypeId(typeId: number): boolean {
  return typeId >= 10 && typeId <= 29
}

/**
 * Check if a type ID is in the git range (50-99)
 */
export function isGitTypeId(typeId: number): boolean {
  return typeId >= 50 && typeId <= 99
}

/**
 * Check if a type ID is in the function range (100-119)
 */
export function isFunctionTypeId(typeId: number): boolean {
  return typeId >= 100 && typeId <= 119
}

/**
 * Check if a type ID is in the function version adapter range (120-129)
 */
export function isFunctionVersionTypeId(typeId: number): boolean {
  return typeId >= 120 && typeId <= 129
}

/**
 * Check if a type ID is in the human execution range (150-199)
 */
export function isHumanExecutionTypeId(typeId: number): boolean {
  return typeId >= 150 && typeId <= 199
}

/**
 * Check if a type ID is in the human request range (200-249)
 */
export function isHumanRequestTypeId(typeId: number): boolean {
  return typeId >= 200 && typeId <= 249
}

/**
 * Check if a type ID is in the agent range (300-349)
 */
export function isAgentTypeId(typeId: number): boolean {
  return typeId >= 300 && typeId <= 349
}

/**
 * Get the domain name for a type ID
 */
export function getTypeIdDomain(typeId: number): string {
  if (isAuthTypeId(typeId)) return 'auth'
  if (isHumanTypeId(typeId)) return 'human'
  if (isGitTypeId(typeId)) return 'git'
  if (isFunctionTypeId(typeId)) return 'function'
  if (isFunctionVersionTypeId(typeId)) return 'function-version'
  if (isHumanExecutionTypeId(typeId)) return 'human-execution'
  if (isHumanRequestTypeId(typeId)) return 'human-request'
  if (isAgentTypeId(typeId)) return 'agent'
  return 'unknown'
}
