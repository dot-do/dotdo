/**
 * Admin Schema Exports
 *
 * Zod schemas for the dotdo admin UI, adapted from the main branch.
 * Provides validation schemas for all core entity types.
 *
 * @module schemas
 */

import { z } from 'zod'

// Import schemas directly for SCHEMAS map
import { NounSchema as _NounSchema } from './noun'
import { VerbSchema as _VerbSchema } from './verb'
import { EventSchema as _EventSchema } from './event'
import { ActionSchema as _ActionSchema } from './action'
import { RelationshipSchema as _RelationshipSchema } from './relationship'
import { FunctionSchema as _FunctionSchema } from './function'
import { ThingSchema as _ThingSchema } from './thing'
import { WorkflowSchema as _WorkflowSchema } from './workflow'

// ============================================================================
// SCHEMA EXPORTS
// ============================================================================

// Noun - Type Registry
export {
  NounSchema,
  NounFieldSchema,
  StorageTierSchema,
  ConsistencyModeSchema,
  NsStrategySchema,
  type NounSchemaType,
  type NounFieldSchemaType,
} from './noun'

// Verb - Predicate Registry
export {
  VerbSchema,
  COMMON_VERBS,
  type VerbSchemaType,
} from './verb'

// Event - 5W+H Event Model
export {
  EventSchema,
  EventSummarySchema,
  FunctionMethodSchema,
  ActorTypeSchema,
  CascadeAttemptSchema,
  EventCascadeSchema,
  type EventSchemaType,
  type EventSummaryType,
  type FunctionMethod,
  type ActorType,
} from './event'

// Action - Command Log
export {
  ActionSchema,
  NewActionSchema,
  ActionStatusSchema,
  ActionDurabilitySchema,
  ActionErrorSchema,
  type ActionSchemaType,
  type NewActionType,
  type ActionStatus,
  type ActionDurability,
} from './action'

// Relationship - Graph Edges
export {
  RelationshipSchema,
  NewRelationshipSchema,
  RelationshipFilterSchema,
  type RelationshipSchemaType,
  type NewRelationshipType,
  type RelationshipFilterType,
} from './relationship'

// Function - Four Implementation Types
export {
  FunctionSchema,
  FunctionTypeSchema,
  RetryConfigSchema,
  BaseFunctionSchema,
  CodeFunctionSchema,
  GenerativeFunctionSchema,
  AgenticFunctionSchema,
  HumanFunctionSchema,
  BackoffStrategySchema,
  isCodeFunction,
  isGenerativeFunction,
  isAgenticFunction,
  isHumanFunction,
  type FunctionSchemaType,
  type FunctionType,
  type RetryConfigType,
  type CodeFunctionType,
  type GenerativeFunctionType,
  type AgenticFunctionType,
  type HumanFunctionType,
  type BackoffStrategy,
} from './function'

// Thing - Versioned Entity Storage
export {
  ThingSchema,
  NewThingSchema,
  ThingFilterSchema,
  ThingWithMetaSchema,
  VisibilitySchema,
  type ThingSchemaType,
  type NewThingType,
  type ThingFilterType,
  type ThingWithMetaType,
  type Visibility,
} from './thing'

// Workflow - Durable Execution Flows
export {
  WorkflowSchema,
  WorkflowStepSchema,
  WorkflowExecutionSchema,
  WorkflowStatusSchema,
  StepTypeSchema,
  ScheduleSchema,
  EventTriggerSchema,
  type WorkflowSchemaType,
  type WorkflowStepType,
  type WorkflowExecutionType,
  type WorkflowStatus,
  type StepType,
  type ScheduleType,
  type EventTriggerType,
} from './workflow'

// ============================================================================
// ZOD TO JSON HELPER
// ============================================================================

/**
 * JSON representation of a Zod schema field
 */
export interface JsonSchemaField {
  type: string
  description?: string
  optional?: boolean
  nullable?: boolean
  default?: unknown
  enum?: string[]
  items?: JsonSchemaField
  properties?: Record<string, JsonSchemaField>
  required?: string[]
}

/**
 * JSON representation of a Zod schema
 */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, JsonSchemaField>
  required: string[]
  description?: string
}

/**
 * Convert a Zod schema to a JSON-serializable format for RPC/API documentation.
 *
 * This is useful for:
 * - Generating API documentation
 * - Sending schema definitions over RPC
 * - Dynamic form generation in admin UI
 *
 * @param schema - Zod schema to convert
 * @param description - Optional schema description
 * @returns JSON-serializable schema representation
 *
 * @example
 * ```typescript
 * import { ThingSchema, zodToJson } from './schemas'
 *
 * const jsonSchema = zodToJson(ThingSchema, 'Versioned entity schema')
 * // Can be sent over RPC or used for form generation
 * ```
 */
export function zodToJson(schema: z.ZodType, description?: string): JsonSchema | JsonSchemaField {
  return processZodType(schema, description)
}

/**
 * Get type name from Zod definition safely
 */
function getZodTypeName(zodType: z.ZodType): string {
  // Access typeName through _def which exists on all Zod types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (zodType._def as any).typeName ?? 'unknown'
}

/**
 * Process a Zod type and convert to JSON schema representation
 */
function processZodType(zodType: z.ZodType, description?: string): JsonSchemaField {
  const typeName = getZodTypeName(zodType)

  // Handle optional wrapper
  if (typeName === 'ZodOptional') {
    const inner = processZodType((zodType as z.ZodOptional<z.ZodType>)._def.innerType)
    return { ...inner, optional: true }
  }

  // Handle nullable wrapper
  if (typeName === 'ZodNullable') {
    const inner = processZodType((zodType as z.ZodNullable<z.ZodType>)._def.innerType)
    return { ...inner, nullable: true }
  }

  // Handle default wrapper
  if (typeName === 'ZodDefault') {
    const def = (zodType as z.ZodDefault<z.ZodType>)._def
    const inner = processZodType(def.innerType)
    return { ...inner, default: def.defaultValue(), optional: true }
  }

  // Handle effects (refine, transform, etc.)
  if (typeName === 'ZodEffects') {
    return processZodType((zodType as z.ZodEffects<z.ZodType>)._def.schema)
  }

  // Handle union (including discriminated unions)
  if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    const options = (zodType as z.ZodUnion<[z.ZodType, ...z.ZodType[]]>)._def.options
    // Return the first option's type as representative
    if (options.length > 0) {
      const firstOption = processZodType(options[0])
      return {
        ...firstOption,
        description: description || `One of: ${options.map((o) => getTypeName(o)).join(', ')}`,
      }
    }
    return { type: 'unknown' }
  }

  // Handle lazy (recursive schemas)
  if (typeName === 'ZodLazy') {
    return { type: 'object', description: description || 'Recursive schema' }
  }

  // Handle primitives
  switch (typeName) {
    case 'ZodString':
      return { type: 'string', description }

    case 'ZodNumber':
      return { type: 'number', description }

    case 'ZodBoolean':
      return { type: 'boolean', description }

    case 'ZodDate':
      return { type: 'date', description }

    case 'ZodBigInt':
      return { type: 'bigint', description }

    case 'ZodUndefined':
      return { type: 'undefined', description }

    case 'ZodNull':
      return { type: 'null', description }

    case 'ZodAny':
    case 'ZodUnknown':
      return { type: 'any', description }

    case 'ZodLiteral': {
      const literalValue = (zodType as z.ZodLiteral<unknown>)._def.value
      return { type: 'literal', default: literalValue, description }
    }

    case 'ZodEnum': {
      const values = (zodType as z.ZodEnum<[string, ...string[]]>)._def.values
      return { type: 'enum', enum: values as string[], description }
    }

    case 'ZodNativeEnum': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enumObj = (zodType as any)._def.values
      const values = Object.values(enumObj).filter((v) => typeof v === 'string')
      return { type: 'enum', enum: values as string[], description }
    }

    case 'ZodArray': {
      const itemType = processZodType((zodType as z.ZodArray<z.ZodType>)._def.type)
      return { type: 'array', items: itemType, description }
    }

    case 'ZodObject': {
      const shape = (zodType as z.ZodObject<z.ZodRawShape>)._def.shape()
      const properties: Record<string, JsonSchemaField> = {}
      const required: string[] = []

      for (const [key, value] of Object.entries(shape)) {
        const field = processZodType(value as z.ZodType)
        properties[key] = field
        if (!field.optional && !field.nullable) {
          required.push(key)
        }
      }

      return {
        type: 'object',
        properties,
        required,
        description,
      }
    }

    case 'ZodRecord': {
      const valueType = processZodType((zodType as z.ZodRecord<z.ZodString, z.ZodType>)._def.valueType)
      return {
        type: 'record',
        items: valueType,
        description: description || 'Record/dictionary type',
      }
    }

    case 'ZodTuple': {
      const items = (zodType as z.ZodTuple<[z.ZodType, ...z.ZodType[]]>)._def.items
      return {
        type: 'tuple',
        items: { type: items.map((i) => processZodType(i).type).join(', ') },
        description,
      }
    }

    default:
      return { type: 'unknown', description: description || `Unknown type: ${typeName}` }
  }
}

/**
 * Get a readable type name for a Zod type
 */
function getTypeName(zodType: z.ZodType): string {
  const typeName = getZodTypeName(zodType)

  if (typeName === 'ZodObject') {
    const shape = (zodType as z.ZodObject<z.ZodRawShape>)._def.shape()
    const typeField = shape['type']
    if (typeField && getZodTypeName(typeField) === 'ZodLiteral') {
      return String((typeField as z.ZodLiteral<unknown>)._def.value)
    }
  }

  if (typeName === 'ZodLiteral') {
    return String((zodType as z.ZodLiteral<unknown>)._def.value)
  }

  return typeName.replace('Zod', '').toLowerCase()
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * All schema names for iteration
 */
export const SCHEMA_NAMES = [
  'Noun',
  'Verb',
  'Event',
  'Action',
  'Relationship',
  'Function',
  'Thing',
  'Workflow',
] as const

export type SchemaName = (typeof SCHEMA_NAMES)[number]

/**
 * Map of schema name to schema
 */
export const SCHEMAS = {
  Noun: _NounSchema,
  Verb: _VerbSchema,
  Event: _EventSchema,
  Action: _ActionSchema,
  Relationship: _RelationshipSchema,
  Function: _FunctionSchema,
  Thing: _ThingSchema,
  Workflow: _WorkflowSchema,
} as const

/**
 * Get a schema by name
 */
export function getSchema(name: SchemaName): z.ZodType {
  return SCHEMAS[name]
}

/**
 * Validate data against a named schema
 */
export function validateWithSchema<T extends SchemaName>(
  name: T,
  data: unknown
): z.infer<(typeof SCHEMAS)[T]> {
  return SCHEMAS[name].parse(data) as z.infer<(typeof SCHEMAS)[T]>
}

/**
 * Safely validate data against a named schema
 */
export function safeValidateWithSchema<T extends SchemaName>(
  name: T,
  data: unknown
): z.SafeParseReturnType<unknown, z.infer<(typeof SCHEMAS)[T]>> {
  return SCHEMAS[name].safeParse(data)
}

// Re-export zod for convenience
export { z }
