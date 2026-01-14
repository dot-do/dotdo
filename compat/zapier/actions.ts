/**
 * Zapier Action Implementations
 *
 * Action definitions with input/output schemas for Zapier-compatible automation.
 */

import type {
  ActionConfig,
  ActionOperation,
  Bundle,
  ZObject,
  InputField,
  InputFieldOrFunction,
  OutputField,
  DisplayConfig,
} from './types'

// ============================================================================
// ACTION CLASS
// ============================================================================

/**
 * Action definition helper
 */
export class Action {
  readonly config: ActionConfig

  constructor(config: ActionConfig) {
    this.config = config
  }

  get key(): string {
    return this.config.key
  }

  get noun(): string {
    return this.config.noun
  }

  get display(): DisplayConfig {
    return this.config.display
  }

  get operation(): ActionOperation {
    return this.config.operation
  }

  /**
   * Execute the action's perform function
   */
  async perform(z: ZObject, bundle: Bundle): Promise<unknown> {
    return this.config.operation.perform(z, bundle)
  }

  /**
   * Get sample data for the action
   */
  getSample(): Record<string, unknown> | undefined {
    return this.config.operation.sample
  }

  /**
   * Resolve input fields (handles dynamic fields)
   */
  async resolveInputFields(z: ZObject, bundle: Bundle): Promise<InputField[]> {
    const fields = this.config.operation.inputFields || []
    const resolvedFields: InputField[] = []

    for (const field of fields) {
      if (typeof field === 'function') {
        const dynamicFields = await field(z, bundle)
        resolvedFields.push(...dynamicFields)
      } else {
        resolvedFields.push(field)
      }
    }

    return resolvedFields
  }

  /**
   * Get output fields
   */
  getOutputFields(): OutputField[] {
    return this.config.operation.outputFields || []
  }

  /**
   * Validate input data against required fields
   */
  validateInput(inputData: Record<string, unknown>): {
    valid: boolean
    errors: string[]
  } {
    const errors: string[] = []
    const fields = this.config.operation.inputFields || []

    for (const field of fields) {
      if (typeof field === 'function') continue // Skip dynamic fields

      if (field.required) {
        const value = inputData[field.key]
        if (value === undefined || value === null || value === '') {
          errors.push(`Field "${field.label}" (${field.key}) is required`)
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }
}

// ============================================================================
// ACTION BUILDER
// ============================================================================

/**
 * Create an action configuration
 */
export function createAction(config: {
  key: string
  noun: string
  display: DisplayConfig
  perform: (z: ZObject, bundle: Bundle) => Promise<unknown>
  inputFields?: InputFieldOrFunction[]
  outputFields?: OutputField[]
  sample?: Record<string, unknown>
}): ActionConfig {
  return {
    key: config.key,
    noun: config.noun,
    display: config.display,
    operation: {
      perform: config.perform,
      inputFields: config.inputFields,
      outputFields: config.outputFields,
      sample: config.sample,
    },
  }
}

/**
 * Fluent builder for creating actions
 */
export class ActionBuilder {
  private config: Partial<ActionConfig> = {}
  private inputFieldsList: InputFieldOrFunction[] = []
  private outputFieldsList: OutputField[] = []

  key(key: string): this {
    this.config.key = key
    return this
  }

  noun(noun: string): this {
    this.config.noun = noun
    return this
  }

  display(display: DisplayConfig): this {
    this.config.display = display
    return this
  }

  label(label: string): this {
    if (!this.config.display) {
      this.config.display = { label, description: '' }
    } else {
      this.config.display.label = label
    }
    return this
  }

  description(description: string): this {
    if (!this.config.display) {
      this.config.display = { label: '', description }
    } else {
      this.config.display.description = description
    }
    return this
  }

  perform(fn: (z: ZObject, bundle: Bundle) => Promise<unknown>): this {
    if (!this.config.operation) {
      this.config.operation = {} as ActionOperation
    }
    this.config.operation.perform = fn
    return this
  }

  inputField(field: InputField): this {
    this.inputFieldsList.push(field)
    return this
  }

  dynamicInputFields(
    fn: (z: ZObject, bundle: Bundle) => Promise<InputField[]>
  ): this {
    this.inputFieldsList.push(fn)
    return this
  }

  inputFields(fields: InputFieldOrFunction[]): this {
    this.inputFieldsList.push(...fields)
    return this
  }

  outputField(field: OutputField): this {
    this.outputFieldsList.push(field)
    return this
  }

  outputFields(fields: OutputField[]): this {
    this.outputFieldsList.push(...fields)
    return this
  }

  sample(sample: Record<string, unknown>): this {
    if (!this.config.operation) {
      this.config.operation = {} as ActionOperation
    }
    this.config.operation.sample = sample
    return this
  }

  build(): ActionConfig {
    if (!this.config.key) {
      throw new Error('Action key is required')
    }
    if (!this.config.noun) {
      throw new Error('Action noun is required')
    }
    if (!this.config.display) {
      throw new Error('Action display is required')
    }
    if (!this.config.operation?.perform) {
      throw new Error('Action perform function is required')
    }

    // Attach input/output fields
    this.config.operation.inputFields = this.inputFieldsList
    this.config.operation.outputFields = this.outputFieldsList

    return this.config as ActionConfig
  }
}

/**
 * Start building an action
 */
export function action(): ActionBuilder {
  return new ActionBuilder()
}

// ============================================================================
// INPUT FIELD BUILDERS
// ============================================================================

/**
 * Create a string input field
 */
export function stringField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'string',
    ...options,
  }
}

/**
 * Create a required string input field
 */
export function requiredString(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return stringField(key, label, { required: true, ...options })
}

/**
 * Create a text (multiline) input field
 */
export function textField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'text',
    ...options,
  }
}

/**
 * Create a number input field
 */
export function numberField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'number',
    ...options,
  }
}

/**
 * Create an integer input field
 */
export function integerField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'integer',
    ...options,
  }
}

/**
 * Create a boolean input field
 */
export function booleanField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'boolean',
    ...options,
  }
}

/**
 * Create a datetime input field
 */
export function datetimeField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'datetime',
    ...options,
  }
}

/**
 * Create a file input field
 */
export function fileField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'file',
    ...options,
  }
}

/**
 * Create a password input field
 */
export function passwordField(
  key: string,
  label: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'password',
    ...options,
  }
}

/**
 * Create a select/dropdown field with static choices
 */
export function selectField(
  key: string,
  label: string,
  choices: string[] | Array<{ value: string; label: string }>,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'string',
    choices,
    ...options,
  }
}

/**
 * Create a dynamic dropdown field
 */
export function dynamicField(
  key: string,
  label: string,
  dynamicRef: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'string',
    dynamic: dynamicRef,
    ...options,
  }
}

/**
 * Create a search field for "search or create"
 */
export function searchField(
  key: string,
  label: string,
  searchRef: string,
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    type: 'string',
    search: searchRef,
    ...options,
  }
}

/**
 * Create a list (array) field
 */
export function listField(
  key: string,
  label: string,
  children: InputField[],
  options?: Partial<InputField>
): InputField {
  return {
    key,
    label,
    list: true,
    children,
    ...options,
  }
}

// ============================================================================
// OUTPUT FIELD BUILDERS
// ============================================================================

/**
 * Create an output field
 */
export function outputField(
  key: string,
  label?: string,
  options?: Partial<OutputField>
): OutputField {
  return {
    key,
    label,
    ...options,
  }
}

/**
 * Create an important output field
 */
export function importantField(
  key: string,
  label?: string,
  options?: Partial<OutputField>
): OutputField {
  return outputField(key, label, { important: true, ...options })
}

// ============================================================================
// ACTION UTILITIES
// ============================================================================

/**
 * Merge input data with defaults
 */
export function mergeWithDefaults(
  inputData: Record<string, unknown>,
  fields: InputField[]
): Record<string, unknown> {
  const merged = { ...inputData }

  for (const field of fields) {
    if (field.default !== undefined && merged[field.key] === undefined) {
      merged[field.key] = field.default
    }
  }

  return merged
}

/**
 * Clean input data - remove undefined/null values
 */
export function cleanInputData(
  inputData: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(inputData)) {
    if (value !== undefined && value !== null) {
      cleaned[key] = value
    }
  }

  return cleaned
}

/**
 * Transform input data based on field types
 */
export function transformInputData(
  inputData: Record<string, unknown>,
  fields: InputField[]
): Record<string, unknown> {
  const transformed = { ...inputData }

  for (const field of fields) {
    const value = transformed[field.key]
    if (value === undefined) continue

    switch (field.type) {
      case 'number':
        transformed[field.key] = Number(value)
        break
      case 'integer':
        transformed[field.key] = Math.floor(Number(value))
        break
      case 'boolean':
        if (typeof value === 'string') {
          transformed[field.key] =
            value.toLowerCase() === 'true' || value === '1'
        }
        break
      case 'datetime':
        if (typeof value === 'string') {
          transformed[field.key] = new Date(value).toISOString()
        }
        break
    }
  }

  return transformed
}

/**
 * Format output data based on output fields
 */
export function formatOutputData(
  data: Record<string, unknown>,
  fields: OutputField[]
): Record<string, unknown> {
  if (fields.length === 0) {
    return data
  }

  const formatted: Record<string, unknown> = {}
  const fieldKeys = new Set(fields.map((f) => f.key))

  // Include specified fields
  for (const field of fields) {
    if (data[field.key] !== undefined) {
      formatted[field.key] = data[field.key]
    }
  }

  // Also include any fields not in the output definition
  // (Zapier includes all fields, output fields just define display order)
  for (const [key, value] of Object.entries(data)) {
    if (!fieldKeys.has(key)) {
      formatted[key] = value
    }
  }

  return formatted
}
