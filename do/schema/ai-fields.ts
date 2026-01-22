/**
 * AI-Generated Field Support
 *
 * Provides functions for generating field values using AI based on
 * prompt field definitions in the unified schema. Prompt fields are
 * detected by isPromptField() in the schema parser.
 *
 * @module do/schema/ai-fields
 *
 * @example
 * ```typescript
 * import { generateFieldValue, generateAllFields } from './ai-fields'
 *
 * // Generate a single field
 * const description = await generateFieldValue(fieldDef, entityData, { aiGenerate })
 *
 * // Generate all prompt fields for an entity
 * const dataWithAI = await generateAllFields(schema, entityData, { aiGenerate })
 * ```
 */

import type {
  FieldDefinition,
  EntitySchema,
  SchemaDirectives,
} from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Context provided to AI generation function
 */
export interface AIGenerationContext {
  /** Entity type name */
  entityType: string
  /** Field name being generated */
  fieldName: string
  /** Entity data provided by user (without AI-generated fields) */
  entityData: Record<string, unknown>
  /** Instructions from schema $instructions directive */
  instructions?: string
  /** Fuzzy threshold from schema $fuzzyThreshold directive */
  fuzzyThreshold?: number
}

/**
 * AI generation function signature
 */
export type AIGenerateFunction = (prompt: string, context: AIGenerationContext) => Promise<string>

/**
 * Options for AI field generation
 */
export interface AIFieldOptions {
  /** AI generation function (required) */
  aiGenerate: AIGenerateFunction
  /** Schema directives for additional context */
  directives?: SchemaDirectives
  /** Entity type name for context */
  entityType?: string
}

/**
 * Result of field generation
 */
export interface FieldGenerationResult {
  /** Field name */
  fieldName: string
  /** Generated value (or undefined if generation failed) */
  value: string | undefined
  /** Whether generation succeeded */
  success: boolean
  /** Error message if generation failed */
  error?: string
}

/**
 * Result of generating all fields
 */
export interface AllFieldsGenerationResult {
  /** Entity data with AI-generated fields populated */
  data: Record<string, unknown>
  /** Results for each generated field */
  results: FieldGenerationResult[]
  /** Number of fields successfully generated */
  successCount: number
  /** Number of fields that failed to generate */
  failureCount: number
}

// =============================================================================
// Prompt Building
// =============================================================================

/**
 * Build a full AI prompt with context from entity data and schema instructions.
 *
 * @param fieldPrompt - The field's prompt definition
 * @param context - Generation context with entity data and schema info
 * @returns Full prompt string for AI generation
 */
export function buildAIPrompt(fieldPrompt: string, context: AIGenerationContext): string {
  const { entityType, fieldName, entityData, instructions } = context

  // Build context string from entity data
  const dataContext = Object.entries(entityData)
    .filter(([key]) => !key.startsWith('$')) // Exclude system fields
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')

  // Construct the full prompt
  let fullPrompt = `Generate the "${fieldName}" field for a ${entityType} entity.\n\n`

  if (instructions) {
    fullPrompt += `Instructions: ${instructions}\n\n`
  }

  fullPrompt += `Field description: ${fieldPrompt}\n\n`

  if (dataContext) {
    fullPrompt += `Entity data:\n${dataContext}\n\n`
  }

  fullPrompt += `Generate only the field value, no explanation or formatting.`

  return fullPrompt
}

// =============================================================================
// Field Value Generation
// =============================================================================

/**
 * Generate a single field value using AI.
 *
 * @param fieldDef - The field definition with prompt
 * @param entityData - Current entity data for context
 * @param options - AI generation options
 * @returns The generated field value, or undefined if generation fails
 *
 * @example
 * ```typescript
 * const fieldDef = {
 *   name: 'description',
 *   type: 'string',
 *   prompt: 'A compelling product description',
 *   generated: true,
 *   // ... other fields
 * }
 *
 * const value = await generateFieldValue(fieldDef, { name: 'Widget' }, {
 *   aiGenerate: async (prompt) => ai`${prompt}`,
 *   entityType: 'Product',
 * })
 * // Returns: "The Widget is a versatile tool..."
 * ```
 */
export async function generateFieldValue(
  fieldDef: FieldDefinition,
  entityData: Record<string, unknown>,
  options: AIFieldOptions
): Promise<string | undefined> {
  const { aiGenerate, directives, entityType = 'Entity' } = options

  // Validate field has a prompt
  if (!fieldDef.prompt || !fieldDef.generated) {
    return undefined
  }

  const context: AIGenerationContext = {
    entityType,
    fieldName: fieldDef.name,
    entityData,
    instructions: directives?.$instructions,
    fuzzyThreshold: directives?.$fuzzyThreshold,
  }

  try {
    const value = await aiGenerate(fieldDef.prompt, context)
    return value || undefined
  } catch (error) {
    // Log but don't throw - AI generation is optional
    console.warn(`Failed to generate AI field "${fieldDef.name}" for ${entityType}:`, error)
    return undefined
  }
}

/**
 * Generate a single field value with detailed result.
 *
 * Like generateFieldValue but returns a result object with success/error info.
 *
 * @param fieldDef - The field definition with prompt
 * @param entityData - Current entity data for context
 * @param options - AI generation options
 * @returns FieldGenerationResult with value, success status, and optional error
 */
export async function generateFieldValueWithResult(
  fieldDef: FieldDefinition,
  entityData: Record<string, unknown>,
  options: AIFieldOptions
): Promise<FieldGenerationResult> {
  const { aiGenerate, directives, entityType = 'Entity' } = options

  // Validate field has a prompt
  if (!fieldDef.prompt || !fieldDef.generated) {
    return {
      fieldName: fieldDef.name,
      value: undefined,
      success: false,
      error: 'Field is not a generated/prompt field',
    }
  }

  const context: AIGenerationContext = {
    entityType,
    fieldName: fieldDef.name,
    entityData,
    instructions: directives?.$instructions,
    fuzzyThreshold: directives?.$fuzzyThreshold,
  }

  try {
    const value = await aiGenerate(fieldDef.prompt, context)
    return {
      fieldName: fieldDef.name,
      value: value || undefined,
      success: !!value,
      error: value ? undefined : 'AI returned empty value',
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      fieldName: fieldDef.name,
      value: undefined,
      success: false,
      error: errorMessage,
    }
  }
}

// =============================================================================
// All Fields Generation
// =============================================================================

/**
 * Get all AI-generated fields from a schema that need values.
 *
 * @param schema - The entity schema
 * @param entityData - Current entity data (to check which fields already have values)
 * @returns Map of field name to field definition for fields needing generation
 */
export function getFieldsNeedingGeneration(
  schema: EntitySchema,
  entityData: Record<string, unknown>
): Map<string, FieldDefinition> {
  const fieldsToGenerate = new Map<string, FieldDefinition>()

  // Handle both Map and plain object (workers runtime may serialize Maps as plain objects)
  const fields = schema.fields instanceof Map
    ? schema.fields
    : new Map(Object.entries(schema.fields as Record<string, FieldDefinition>))

  for (const [fieldName, fieldDef] of fields) {
    // Only include fields that:
    // 1. Are AI-generated (have prompt and generated: true)
    // 2. Don't already have a value in entityData
    if (fieldDef.generated && fieldDef.prompt && entityData[fieldName] === undefined) {
      fieldsToGenerate.set(fieldName, fieldDef)
    }
  }

  return fieldsToGenerate
}

/**
 * Generate all AI field values for an entity.
 *
 * This function identifies all prompt fields in the schema that don't have
 * values in the provided entity data, generates values for them using AI,
 * and returns the entity data with generated values populated.
 *
 * @param schema - The entity schema with field definitions
 * @param entityData - Current entity data (AI fields will be added to this)
 * @param options - AI generation options
 * @returns AllFieldsGenerationResult with populated data and generation results
 *
 * @example
 * ```typescript
 * const schema = parseEntitySchema('Product', {
 *   name: 'string!',
 *   description: 'A compelling product description',
 *   seoKeywords: 'SEO keywords for the product',
 * })
 *
 * const result = await generateAllFields(schema, { name: 'Widget' }, {
 *   aiGenerate: async (prompt, ctx) => ai`${prompt}`,
 *   entityType: 'Product',
 * })
 *
 * // result.data = {
 * //   name: 'Widget',
 * //   description: 'The Widget is a versatile...',
 * //   seoKeywords: 'widget, tool, gadget...',
 * // }
 * // result.successCount = 2
 * // result.failureCount = 0
 * ```
 */
export async function generateAllFields(
  schema: EntitySchema,
  entityData: Record<string, unknown>,
  options: AIFieldOptions
): Promise<AllFieldsGenerationResult> {
  const fieldsToGenerate = getFieldsNeedingGeneration(schema, entityData)

  // If no fields need generation, return original data
  if (fieldsToGenerate.size === 0) {
    return {
      data: { ...entityData },
      results: [],
      successCount: 0,
      failureCount: 0,
    }
  }

  const results: FieldGenerationResult[] = []
  const generatedData = { ...entityData }

  // Generate each field
  for (const [fieldName, fieldDef] of fieldsToGenerate) {
    const result = await generateFieldValueWithResult(fieldDef, entityData, {
      ...options,
      entityType: options.entityType ?? schema.name,
      directives: options.directives ?? schema.directives,
    })

    results.push(result)

    if (result.success && result.value !== undefined) {
      generatedData[fieldName] = result.value
    }
  }

  const successCount = results.filter(r => r.success).length
  const failureCount = results.length - successCount

  return {
    data: generatedData,
    results,
    successCount,
    failureCount,
  }
}

/**
 * Generate all AI field values for an entity (simple version).
 *
 * Like generateAllFields but returns just the data object without
 * detailed results. Useful when you don't need to track individual
 * field generation status.
 *
 * @param schema - The entity schema with field definitions
 * @param entityData - Current entity data (AI fields will be added to this)
 * @param options - AI generation options
 * @returns Entity data with AI-generated fields populated
 */
export async function generateAllFieldsSimple(
  schema: EntitySchema,
  entityData: Record<string, unknown>,
  options: AIFieldOptions
): Promise<Record<string, unknown>> {
  const result = await generateAllFields(schema, entityData, options)
  return result.data
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a schema has any AI-generated fields.
 *
 * @param schema - The entity schema to check
 * @returns true if the schema has at least one generated field
 */
export function hasGeneratedFields(schema: EntitySchema): boolean {
  // Handle both Map and plain object
  const fields = schema.fields instanceof Map
    ? schema.fields
    : new Map(Object.entries(schema.fields as Record<string, FieldDefinition>))

  for (const fieldDef of fields.values()) {
    if (fieldDef.generated && fieldDef.prompt) {
      return true
    }
  }

  return false
}

/**
 * Get all AI-generated field definitions from a schema.
 *
 * @param schema - The entity schema
 * @returns Array of field definitions that are AI-generated
 */
export function getGeneratedFieldDefinitions(schema: EntitySchema): FieldDefinition[] {
  const generated: FieldDefinition[] = []

  // Handle both Map and plain object
  const fields = schema.fields instanceof Map
    ? schema.fields
    : new Map(Object.entries(schema.fields as Record<string, FieldDefinition>))

  for (const fieldDef of fields.values()) {
    if (fieldDef.generated && fieldDef.prompt) {
      generated.push(fieldDef)
    }
  }

  return generated
}

/**
 * Create a default AI generation function using @dotdo/ai template literals.
 *
 * This is the default implementation used when no custom aiGenerate function
 * is provided. It uses the buildAIPrompt function to construct the full prompt.
 *
 * @returns An AIGenerateFunction that uses @dotdo/ai
 */
export function createDefaultAIGenerate(): AIGenerateFunction {
  return async (prompt: string, context: AIGenerationContext): Promise<string> => {
    try {
      // Dynamic import to avoid circular dependencies and allow optional AI module
      const { ai } = await import('../../ai')

      // Build the full prompt with context
      const fullPrompt = buildAIPrompt(prompt, context)

      // Generate the value using the AI module
      const result = await ai`${fullPrompt}`
      return result
    } catch (error) {
      // If AI module is not available or fails, return empty string
      // This allows the system to work without AI in test/dev environments
      if (error instanceof Error && (
        error.message.includes('Cannot find module') ||
        error.message.includes('ai-providers not configured') ||
        error.message.includes('Mock model not allowed')
      )) {
        return ''
      }
      throw error
    }
  }
}
