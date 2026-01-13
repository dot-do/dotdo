/**
 * Discriminated Union Types for GraphThing
 *
 * Provides type-safe access to GraphThing.data based on typeName.
 * Uses a ThingRegistry to map known type names to their data types,
 * enabling compile-time type safety and discriminated union narrowing.
 *
 * @see dotdo-xsa65 - Add discriminated union for GraphThing types
 *
 * @example
 * ```typescript
 * import { isTypedThing, getTypedThing, TypedThingFor } from 'db/graph/typed-things'
 *
 * // Type guard narrows GraphThing to specific TypedThing
 * const thing = await store.getThing(id)
 * if (thing && isTypedThing(thing, 'User')) {
 *   // thing.data is now typed as UserThingData | null
 *   console.log(thing.data?.email)
 * }
 *
 * // Or use getTypedThing for a nullable return
 * const user = getTypedThing(thing, 'User')
 * if (user?.data) {
 *   console.log(user.data.email)
 * }
 * ```
 *
 * @module db/graph/typed-things
 */

import type { GraphThing } from './things'

// Import data types from domain modules
import type {
  UserThingData,
  OrgThingData,
  RoleThingData,
  SessionThingData,
  AccountThingData,
  InvitationThingData,
  TeamThingData,
  ApprovalRequestThingData,
} from './humans/types'
import type { FunctionData } from './adapters/function-graph-adapter'
import type {
  WorkflowTemplateData,
  WorkflowInstanceData,
  WorkflowStepData,
  StepResultData,
} from './workflows/types'
import type { AgentThingData } from './agent-thing'

// ============================================================================
// EXTENDED DATA TYPES WITH INDEX SIGNATURE
// ============================================================================

/**
 * FunctionData with index signature for GraphStore compatibility.
 * This extends FunctionData to allow it to be used in the ThingRegistry
 * where data types must be compatible with Record<string, unknown>.
 */
export interface FunctionDataIndexed extends FunctionData {
  [key: string]: unknown
}

/**
 * WorkflowTemplateData with index signature for GraphStore compatibility.
 */
export interface WorkflowTemplateDataIndexed extends WorkflowTemplateData {
  [key: string]: unknown
}

/**
 * WorkflowInstanceData with index signature for GraphStore compatibility.
 */
export interface WorkflowInstanceDataIndexed extends WorkflowInstanceData {
  [key: string]: unknown
}

/**
 * WorkflowStepData with index signature for GraphStore compatibility.
 */
export interface WorkflowStepDataIndexed extends WorkflowStepData {
  [key: string]: unknown
}

/**
 * StepResultData with index signature for GraphStore compatibility.
 */
export interface StepResultDataIndexed extends StepResultData {
  [key: string]: unknown
}

// ============================================================================
// THING REGISTRY - Maps typeName to data type
// ============================================================================

/**
 * ThingRegistry maps known typeName strings to their corresponding data types.
 *
 * Add new entries here as new Thing types are added to the system.
 * Each entry maps: typeName (string literal) -> DataType (interface)
 */
export interface ThingRegistry {
  // Human/Auth types
  User: UserThingData
  Org: OrgThingData
  Role: RoleThingData
  Session: SessionThingData
  Account: AccountThingData
  Invitation: InvitationThingData
  Team: TeamThingData
  ApprovalRequest: ApprovalRequestThingData

  // Agent types
  Agent: AgentThingData

  // Function types (all use FunctionData with different type field)
  CodeFunction: FunctionDataIndexed
  GenerativeFunction: FunctionDataIndexed
  AgenticFunction: FunctionDataIndexed
  HumanFunction: FunctionDataIndexed

  // Workflow types
  WorkflowTemplate: WorkflowTemplateDataIndexed
  WorkflowInstance: WorkflowInstanceDataIndexed
  WorkflowStep: WorkflowStepDataIndexed
  StepResult: StepResultDataIndexed
}

// ============================================================================
// DERIVED TYPES
// ============================================================================

/**
 * Union of all known type names in the registry
 */
export type KnownTypeName = keyof ThingRegistry

/**
 * TypedThingFor<T> creates a specific TypedThing type for a given typeName.
 *
 * The typeName field becomes a literal type, and data is typed accordingly.
 *
 * @example
 * ```typescript
 * type UserThing = TypedThingFor<'User'>
 * // Equivalent to:
 * // {
 * //   id: string
 * //   typeId: number
 * //   typeName: 'User'
 * //   data: UserThingData | null
 * //   createdAt: number
 * //   updatedAt: number
 * //   deletedAt: number | null
 * // }
 * ```
 */
export type TypedThingFor<T extends KnownTypeName> = Omit<GraphThing, 'typeName' | 'data'> & {
  typeName: T
  data: ThingRegistry[T] | null
}

/**
 * TypedThing is a discriminated union of all known typed things.
 *
 * When you check the typeName, TypeScript narrows the data type accordingly.
 *
 * @example
 * ```typescript
 * function handle(thing: TypedThing) {
 *   if (thing.typeName === 'User') {
 *     // thing.data is UserThingData | null
 *     console.log(thing.data?.email)
 *   } else if (thing.typeName === 'Agent') {
 *     // thing.data is AgentThingData | null
 *     console.log(thing.data?.persona.name)
 *   }
 * }
 * ```
 */
export type TypedThing = {
  [K in KnownTypeName]: TypedThingFor<K>
}[KnownTypeName]

// ============================================================================
// DATA VALIDATORS
// ============================================================================

/**
 * Data validator registry maps typeName to a validation function.
 * Each validator returns true if the data matches the expected structure.
 */
const dataValidators: Record<KnownTypeName, (data: unknown) => boolean> = {
  // Human/Auth types
  User: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return typeof d.email === 'string' && typeof d.status === 'string'
  },

  Org: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return typeof d.name === 'string' && typeof d.slug === 'string'
  },

  Role: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return typeof d.name === 'string' && Array.isArray(d.permissions)
  },

  Session: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.token === 'string' &&
      typeof d.userId === 'string' &&
      typeof d.expiresAt === 'number'
    )
  },

  Account: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.provider === 'string' &&
      typeof d.providerAccountId === 'string' &&
      typeof d.userId === 'string'
    )
  },

  Invitation: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.email === 'string' &&
      typeof d.orgId === 'string' &&
      typeof d.role === 'string' &&
      typeof d.status === 'string' &&
      typeof d.invitedBy === 'string' &&
      typeof d.expiresAt === 'number' &&
      typeof d.token === 'string'
    )
  },

  Team: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.name === 'string' &&
      typeof d.slug === 'string' &&
      typeof d.orgId === 'string'
    )
  },

  ApprovalRequest: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.title === 'string' &&
      typeof d.message === 'string' &&
      typeof d.type === 'string'
    )
  },

  // Agent type
  Agent: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.model === 'string' &&
      typeof d.mode === 'string' &&
      d.persona !== null &&
      typeof d.persona === 'object'
    )
  },

  // Function types (all use same structure)
  CodeFunction: validateFunctionData,
  GenerativeFunction: validateFunctionData,
  AgenticFunction: validateFunctionData,
  HumanFunction: validateFunctionData,

  // Workflow types
  WorkflowTemplate: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return typeof d.name === 'string' && typeof d.version === 'string'
  },

  WorkflowInstance: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.templateId === 'string' &&
      typeof d.stateVerb === 'string' &&
      typeof d.input === 'object' &&
      d.input !== null
    )
  },

  WorkflowStep: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.name === 'string' &&
      typeof d.type === 'string' &&
      typeof d.index === 'number'
    )
  },

  StepResult: (data) => {
    if (data === null) return true
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.stepName === 'string' &&
      typeof d.output === 'object' &&
      d.output !== null &&
      typeof d.createdAt === 'number'
    )
  },
}

/**
 * Validate FunctionData structure
 */
function validateFunctionData(data: unknown): boolean {
  if (data === null) return true
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.name === 'string' && typeof d.type === 'string'
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard that checks if a GraphThing is a specific known TypedThing.
 *
 * Returns true if:
 * 1. thing.typeName matches the expected typeName
 * 2. thing.data matches the expected data structure (or is null)
 *
 * @param thing - The GraphThing to check
 * @param typeName - The expected type name
 * @returns true if thing is a TypedThing of the specified type
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(id)
 * if (thing && isTypedThing(thing, 'User')) {
 *   // thing.data is now UserThingData | null
 *   console.log(thing.data?.email)
 * }
 * ```
 */
export function isTypedThing<T extends KnownTypeName>(
  thing: GraphThing,
  typeName: T
): thing is TypedThingFor<T> {
  // 1. Check typeName matches
  if (thing.typeName !== typeName) {
    return false
  }

  // 2. Validate data structure using the validator for this type
  const validator = dataValidators[typeName]
  if (!validator) {
    return false
  }

  return validator(thing.data)
}

/**
 * Assertion helper that throws if the thing is not of the expected type.
 *
 * Use this when you're certain of the type and want to fail fast if wrong.
 *
 * @param thing - The GraphThing to check
 * @param typeName - The expected type name
 * @throws Error if thing is not of the expected type
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(id)
 * assertTypedThing(thing!, 'User')
 * // thing.data is now UserThingData | null
 * console.log(thing.data?.email)
 * ```
 */
export function assertTypedThing<T extends KnownTypeName>(
  thing: GraphThing,
  typeName: T
): asserts thing is TypedThingFor<T> {
  if (!isTypedThing(thing, typeName)) {
    throw new Error(`Expected typeName '${typeName}' but got '${thing.typeName}'`)
  }
}

/**
 * Get a typed thing if it matches the expected type, or null otherwise.
 *
 * Combines the type check and type assertion into a single operation.
 *
 * @param thing - The GraphThing to check
 * @param typeName - The expected type name
 * @returns The typed thing if it matches, null otherwise
 *
 * @example
 * ```typescript
 * const user = getTypedThing(thing, 'User')
 * if (user?.data) {
 *   console.log(user.data.email)
 * }
 * ```
 */
export function getTypedThing<T extends KnownTypeName>(
  thing: GraphThing,
  typeName: T
): TypedThingFor<T> | null {
  if (isTypedThing(thing, typeName)) {
    return thing
  }
  return null
}
