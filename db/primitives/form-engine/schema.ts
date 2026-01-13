/**
 * FormEngine Schema Module
 *
 * Schema definition, field creation, and schema validation utilities
 */

import type {
  FormSchema,
  FormField,
  FormStep,
  FieldType,
  FormSettings,
  ConditionalRule,
  SelectField,
  FileField,
  GroupField,
} from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'url',
  'date',
  'time',
  'datetime',
  'select',
  'multiselect',
  'checkbox',
  'radio',
  'file',
  'signature',
  'payment',
  'rating',
  'slider',
  'hidden',
  'group',
]

// ============================================================================
// SCHEMA CREATION
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `form_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Create a form schema with sensible defaults
 */
export function createFormSchema(input: Partial<FormSchema> & { title: string }): FormSchema {
  const now = new Date()

  return {
    id: input.id ?? generateId(),
    title: input.title,
    description: input.description,
    version: input.version,
    fields: input.fields,
    steps: input.steps,
    settings: input.settings,
    conditions: input.conditions,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Define a single form field with type inference
 */
export function defineField<T extends FormField>(field: T): T {
  return field
}

/**
 * Define a form step
 */
export function defineStep(step: FormStep): FormStep {
  return step
}

// ============================================================================
// FLUENT SCHEMA BUILDER
// ============================================================================

/**
 * Fluent builder for creating form schemas
 */
export class FormSchemaBuilder {
  private _id: string
  private _title = ''
  private _description?: string
  private _version?: string
  private _fields: FormField[] = []
  private _steps: FormStep[] = []
  private _settings?: FormSettings
  private _conditions: ConditionalRule[] = []
  private _metadata?: Record<string, unknown>

  constructor(id: string) {
    this._id = id
  }

  title(title: string): this {
    this._title = title
    return this
  }

  description(description: string): this {
    this._description = description
    return this
  }

  version(version: string): this {
    this._version = version
    return this
  }

  field(field: FormField): this {
    this._fields.push(field)
    return this
  }

  fields(fields: FormField[]): this {
    this._fields.push(...fields)
    return this
  }

  step(step: FormStep): this {
    this._steps.push(step)
    return this
  }

  steps(steps: FormStep[]): this {
    this._steps.push(...steps)
    return this
  }

  settings(settings: FormSettings): this {
    this._settings = settings
    return this
  }

  condition(condition: ConditionalRule): this {
    this._conditions.push(condition)
    return this
  }

  metadata(metadata: Record<string, unknown>): this {
    this._metadata = metadata
    return this
  }

  build(): FormSchema {
    return createFormSchema({
      id: this._id,
      title: this._title,
      description: this._description,
      version: this._version,
      fields: this._fields.length > 0 ? this._fields : undefined,
      steps: this._steps.length > 0 ? this._steps : undefined,
      settings: this._settings,
      conditions: this._conditions.length > 0 ? this._conditions : undefined,
      metadata: this._metadata,
    })
  }
}

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a form schema for correctness
 */
export function validateFormSchema(schema: FormSchema): SchemaValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  if (!schema.id) {
    errors.push('Schema must have an id')
  }

  if (!schema.title) {
    errors.push('Schema must have a title')
  }

  // Must have fields or steps
  const hasFields = schema.fields && schema.fields.length > 0
  const hasSteps = schema.steps && schema.steps.length > 0

  if (!hasFields && !hasSteps) {
    errors.push('Schema must have either fields or steps defined')
  }

  // Validate fields
  const allFields: FormField[] = []

  if (schema.fields) {
    allFields.push(...schema.fields)
    for (const field of schema.fields) {
      const fieldErrors = validateField(field)
      errors.push(...fieldErrors)
    }
  }

  if (schema.steps) {
    for (const step of schema.steps) {
      allFields.push(...step.fields)
      for (const field of step.fields) {
        const fieldErrors = validateField(field)
        errors.push(...fieldErrors)
      }
    }
  }

  // Check for duplicate field IDs
  const fieldIds = new Set<string>()
  const collectIds = (fields: FormField[]) => {
    for (const field of fields) {
      if (fieldIds.has(field.id)) {
        errors.push(`Duplicate field id: ${field.id}`)
      }
      fieldIds.add(field.id)

      if (field.type === 'group' && (field as GroupField).fields) {
        collectIds((field as GroupField).fields)
      }
    }
  }
  collectIds(allFields)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate a single field definition
 */
function validateField(field: FormField): string[] {
  const errors: string[] = []

  if (!field.id) {
    errors.push('Field must have an id')
  }

  if (!field.label) {
    errors.push(`Field ${field.id} must have a label`)
  }

  if (!VALID_FIELD_TYPES.includes(field.type)) {
    errors.push(`Field ${field.id} has invalid type: ${field.type}`)
  }

  // Type-specific validation
  if (field.type === 'select' || field.type === 'multiselect' || field.type === 'radio') {
    const selectField = field as SelectField
    if (!selectField.options || selectField.options.length === 0) {
      errors.push(`Field ${field.id} (${field.type}) must have options defined`)
    }
  }

  if (field.type === 'file') {
    const fileField = field as FileField
    if (!fileField.upload) {
      errors.push(`Field ${field.id} (file) must have upload config defined`)
    }
  }

  if (field.type === 'group') {
    const groupField = field as GroupField
    if (!groupField.fields || groupField.fields.length === 0) {
      errors.push(`Field ${field.id} (group) must have nested fields`)
    } else {
      for (const nestedField of groupField.fields) {
        errors.push(...validateField(nestedField))
      }
    }
  }

  return errors
}

// ============================================================================
// SCHEMA PARSING
// ============================================================================

/**
 * Parse a form schema from JSON string or object
 */
export function parseFormSchema(input: string | Record<string, unknown>): FormSchema {
  let obj: Record<string, unknown>

  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      throw new Error('Invalid JSON input')
    }
  } else {
    obj = input
  }

  // Basic validation
  if (!obj.id && !obj.title) {
    throw new Error('Schema must have at least an id or title')
  }

  const schema = createFormSchema({
    id: obj.id as string,
    title: (obj.title as string) || 'Untitled',
    description: obj.description as string,
    version: obj.version as string,
    fields: obj.fields as FormField[],
    steps: obj.steps as FormStep[],
    settings: obj.settings as FormSettings,
    conditions: obj.conditions as ConditionalRule[],
    metadata: obj.metadata as Record<string, unknown>,
  })

  const validation = validateFormSchema(schema)
  if (!validation.valid) {
    throw new Error(`Invalid schema: ${validation.errors.join(', ')}`)
  }

  return schema
}

// ============================================================================
// FIELD HELPERS
// ============================================================================

/**
 * Get all fields from a schema (including nested and step fields)
 */
export function getAllFields(schema: FormSchema): FormField[] {
  const fields: FormField[] = []

  const collectFields = (fieldList: FormField[]) => {
    for (const field of fieldList) {
      fields.push(field)
      if (field.type === 'group' && (field as GroupField).fields) {
        collectFields((field as GroupField).fields)
      }
    }
  }

  if (schema.fields) {
    collectFields(schema.fields)
  }

  if (schema.steps) {
    for (const step of schema.steps) {
      collectFields(step.fields)
    }
  }

  return fields
}

/**
 * Get a field by ID from the schema
 */
export function getFieldById(schema: FormSchema, fieldId: string): FormField | undefined {
  const allFields = getAllFields(schema)
  return allFields.find((f) => f.id === fieldId)
}

/**
 * Get fields for a specific step
 */
export function getStepFields(schema: FormSchema, stepId: string): FormField[] {
  if (!schema.steps) return []
  const step = schema.steps.find((s) => s.id === stepId)
  return step?.fields ?? []
}
