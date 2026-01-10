/**
 * Schema Utilities
 *
 * Utilities for inferring resource configurations from Zod schemas.
 * Provides automatic field type detection for form generation.
 *
 * @module @dotdo/react/admin
 */

import type { ZodSchema, ZodTypeAny, ZodObject, ZodRawShape } from 'zod'

// =============================================================================
// Types
// =============================================================================

/**
 * Inferred field type from schema
 */
export type InferredFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'email'
  | 'url'
  | 'enum'
  | 'array'
  | 'object'
  | 'reference'
  | 'unknown'

/**
 * Inferred field definition
 */
export interface InferredField {
  /** Field name */
  name: string
  /** Field type */
  type: InferredFieldType
  /** Whether the field is required */
  required: boolean
  /** Default value if any */
  defaultValue?: unknown
  /** For enum types, the allowed values */
  enumValues?: string[]
  /** For reference types, the referenced resource */
  reference?: string
  /** Human-readable label (derived from name) */
  label: string
  /** Whether this is the ID field */
  isId: boolean
  /** Whether this field should be hidden in forms */
  hidden: boolean
  /** Field description from schema */
  description?: string
  /** Minimum value/length */
  min?: number
  /** Maximum value/length */
  max?: number
}

/**
 * Resource definition derived from schema
 */
export interface ResourceDefinition {
  /** Resource name */
  name: string
  /** ID field name */
  idField: string
  /** All fields */
  fields: InferredField[]
  /** Fields to show in list view */
  listFields: InferredField[]
  /** Fields to show in forms */
  formFields: InferredField[]
  /** Searchable fields */
  searchFields: string[]
  /** Sortable fields */
  sortableFields: string[]
  /** Filterable fields */
  filterableFields: string[]
}

// =============================================================================
// Field Inference
// =============================================================================

/**
 * Infer fields from a Zod schema.
 *
 * Analyzes the schema structure to determine field types, validation rules,
 * and display properties.
 *
 * @example
 * ```ts
 * const UserSchema = z.object({
 *   $id: z.string(),
 *   name: z.string().min(1),
 *   email: z.string().email(),
 *   role: z.enum(['admin', 'user']),
 *   createdAt: z.string(),
 * })
 *
 * const fields = inferFieldsFromSchema(UserSchema)
 * // [
 * //   { name: '$id', type: 'string', isId: true, hidden: true, ... },
 * //   { name: 'name', type: 'string', required: true, ... },
 * //   { name: 'email', type: 'email', required: true, ... },
 * //   { name: 'role', type: 'enum', enumValues: ['admin', 'user'], ... },
 * //   { name: 'createdAt', type: 'datetime', ... },
 * // ]
 * ```
 */
export function inferFieldsFromSchema<T extends ZodRawShape>(
  schema: ZodObject<T>
): InferredField[] {
  const shape = schema.shape
  const fields: InferredField[] = []

  for (const [name, zodType] of Object.entries(shape)) {
    const field = inferField(name, zodType as ZodTypeAny)
    fields.push(field)
  }

  return fields
}

/**
 * Infer a single field from a Zod type
 */
function inferField(name: string, zodType: ZodTypeAny): InferredField {
  const field: InferredField = {
    name,
    type: 'unknown',
    required: true,
    label: formatLabel(name),
    isId: name === '$id' || name === 'id',
    hidden: false,
  }

  // Get the inner type (unwrap optional, nullable, default, etc.)
  const { innerType, isOptional, defaultValue, description } = unwrapZodType(zodType)

  field.required = !isOptional
  field.defaultValue = defaultValue
  field.description = description

  // Hide ID and timestamp fields by default
  if (field.isId || name === 'createdAt' || name === 'updatedAt' || name === '$type') {
    field.hidden = true
  }

  // Determine the field type
  const typeName = getZodTypeName(innerType)

  switch (typeName) {
    case 'ZodString':
      field.type = inferStringType(name, innerType)
      const { min, max } = getStringConstraints(innerType)
      field.min = min
      field.max = max
      break

    case 'ZodNumber':
      field.type = 'number'
      break

    case 'ZodBoolean':
      field.type = 'boolean'
      break

    case 'ZodDate':
      field.type = 'date'
      break

    case 'ZodEnum':
    case 'ZodNativeEnum':
      field.type = 'enum'
      field.enumValues = getEnumValues(innerType)
      break

    case 'ZodArray':
      field.type = 'array'
      break

    case 'ZodObject':
      field.type = 'object'
      break

    case 'ZodLiteral':
      // Literal values are typically hidden (like $type)
      field.hidden = true
      break

    default:
      field.type = 'unknown'
  }

  // Check for reference fields (e.g., userId, ownerId)
  if (
    field.type === 'string' &&
    (name.endsWith('Id') || name.endsWith('_id'))
  ) {
    field.type = 'reference'
    field.reference = inferReferenceResource(name)
  }

  return field
}

// =============================================================================
// Resource Definition
// =============================================================================

/**
 * Create a resource definition from a Zod schema.
 *
 * Generates a complete resource definition including field categorization
 * for list views, forms, searching, and filtering.
 *
 * @example
 * ```ts
 * const userResource = createResourceFromSchema('User', UserSchema)
 *
 * // Use in admin components:
 * <ResourceProvider resource={userResource}>
 *   <DataGrid columns={userResource.listFields} />
 * </ResourceProvider>
 * ```
 */
export function createResourceFromSchema<T extends ZodRawShape>(
  name: string,
  schema: ZodObject<T>
): ResourceDefinition {
  const fields = inferFieldsFromSchema(schema)

  // Determine ID field
  const idField = fields.find((f) => f.isId)?.name ?? '$id'

  // Fields for list view (visible, non-object, non-array)
  const listFields = fields.filter(
    (f) =>
      !f.hidden &&
      f.type !== 'object' &&
      f.type !== 'array' &&
      f.name !== 'description'
  )

  // Fields for forms (non-hidden, non-id, non-readonly)
  const formFields = fields.filter(
    (f) =>
      !f.hidden &&
      !f.isId &&
      f.name !== 'createdAt' &&
      f.name !== 'updatedAt'
  )

  // Searchable fields (strings, emails, urls - text that can be searched)
  const searchFields = fields
    .filter(
      (f) =>
        ['string', 'email', 'url'].includes(f.type) &&
        !f.isId &&
        !f.hidden &&
        f.name !== 'createdAt' &&
        f.name !== 'updatedAt'
    )
    .map((f) => f.name)

  // Sortable fields (strings, numbers, dates)
  const sortableFields = fields
    .filter(
      (f) =>
        ['string', 'number', 'date', 'datetime', 'email'].includes(f.type) &&
        f.name !== 'description'
    )
    .map((f) => f.name)

  // Filterable fields (enums, booleans, references)
  const filterableFields = fields
    .filter(
      (f) =>
        ['enum', 'boolean', 'reference'].includes(f.type) ||
        (f.type === 'string' && f.name.includes('status'))
    )
    .map((f) => f.name)

  return {
    name,
    idField,
    fields,
    listFields,
    formFields,
    searchFields,
    sortableFields,
    filterableFields,
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a field name as a human-readable label
 */
function formatLabel(name: string): string {
  // Remove common prefixes
  let label = name
  if (label.startsWith('$')) {
    label = label.slice(1)
  }

  // Handle camelCase and snake_case
  label = label
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/Id$/, ' ID')
    .replace(/Url$/, ' URL')
    .replace(/\s+/g, ' ') // Collapse multiple spaces

  // Capitalize first letter and trim
  return (label.charAt(0).toUpperCase() + label.slice(1)).trim()
}

/**
 * Get the type name of a Zod type
 */
function getZodTypeName(zodType: ZodTypeAny): string {
  return (zodType as { _def?: { typeName?: string } })._def?.typeName ?? 'Unknown'
}

/**
 * Unwrap optional, nullable, default, and effect wrappers
 */
function unwrapZodType(zodType: ZodTypeAny): {
  innerType: ZodTypeAny
  isOptional: boolean
  defaultValue?: unknown
  description?: string
} {
  let innerType = zodType
  let isOptional = false
  let defaultValue: unknown
  let description: string | undefined

  // Type for accessing Zod internal _def
  type ZodDef = {
    description?: string
    innerType?: ZodTypeAny
    defaultValue?: () => unknown
    schema?: ZodTypeAny
  }

  // Get description
  description = (zodType as { _def?: ZodDef })._def?.description

  // Recursively unwrap
  let safety = 10
  while (safety-- > 0) {
    const typeName = getZodTypeName(innerType)
    const def = (innerType as { _def?: ZodDef })._def

    if (typeName === 'ZodOptional') {
      isOptional = true
      innerType = def?.innerType ?? innerType
    } else if (typeName === 'ZodNullable') {
      isOptional = true
      innerType = def?.innerType ?? innerType
    } else if (typeName === 'ZodDefault') {
      defaultValue = def?.defaultValue?.()
      innerType = def?.innerType ?? innerType
    } else if (typeName === 'ZodEffects') {
      innerType = def?.schema ?? innerType
    } else {
      break
    }
  }

  return { innerType, isOptional, defaultValue, description }
}

/**
 * Infer string subtype based on field name and constraints
 */
function inferStringType(name: string, zodType: ZodTypeAny): InferredFieldType {
  // Check for common patterns in field names
  const lowerName = name.toLowerCase()

  if (lowerName === 'email' || lowerName.endsWith('email')) {
    return 'email'
  }

  if (
    lowerName === 'url' ||
    lowerName.endsWith('url') ||
    lowerName.endsWith('link')
  ) {
    return 'url'
  }

  if (
    lowerName.endsWith('at') ||
    lowerName.includes('date') ||
    lowerName.includes('time')
  ) {
    return 'datetime'
  }

  // Check for .email() or .url() validators
  type ZodStringDef = { checks?: Array<{ kind: string }> }
  const checks = (zodType as { _def?: ZodStringDef })._def?.checks ?? []
  for (const check of checks) {
    if (check.kind === 'email') return 'email'
    if (check.kind === 'url') return 'url'
  }

  return 'string'
}

/**
 * Get string constraints (min/max length)
 */
function getStringConstraints(
  zodType: ZodTypeAny
): { min?: number; max?: number } {
  type ZodStringCheck = { kind: string; value?: number }
  type ZodStringDef = { checks?: ZodStringCheck[] }
  const checks = (zodType as { _def?: ZodStringDef })._def?.checks ?? []

  let min: number | undefined
  let max: number | undefined

  for (const check of checks) {
    if (check.kind === 'min') min = check.value
    if (check.kind === 'max') max = check.value
    if (check.kind === 'length') {
      min = check.value
      max = check.value
    }
  }

  return { min, max }
}

/**
 * Get enum values from a ZodEnum or ZodNativeEnum
 */
function getEnumValues(zodType: ZodTypeAny): string[] {
  const typeName = getZodTypeName(zodType)

  type ZodEnumDef = { values?: string[] | Record<string, unknown> }

  if (typeName === 'ZodEnum') {
    return ((zodType as { _def?: ZodEnumDef })._def?.values as string[]) ?? []
  }

  if (typeName === 'ZodNativeEnum') {
    const enumObj = (zodType as { _def?: ZodEnumDef })._def?.values as Record<string, unknown> | undefined
    if (enumObj) {
      return Object.values(enumObj).filter(
        (v): v is string => typeof v === 'string'
      )
    }
  }

  return []
}

/**
 * Infer the referenced resource from a field name
 */
function inferReferenceResource(name: string): string {
  // Remove common suffixes and convert to PascalCase
  let resource = name
    .replace(/Id$/, '')
    .replace(/_id$/, '')
    .replace(/_/g, '')

  // Capitalize first letter
  return resource.charAt(0).toUpperCase() + resource.slice(1)
}
