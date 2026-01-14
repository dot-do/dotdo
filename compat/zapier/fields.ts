/**
 * Zapier Dynamic Fields
 *
 * Handles dynamic dropdown fields and field resolution.
 */

import type {
  InputField,
  InputFieldOrFunction,
  Bundle,
  ZObject,
  TriggerConfig,
  ActionConfig,
  SearchConfig,
} from './types'

// ============================================================================
// DYNAMIC FIELD RESOLVER
// ============================================================================

/**
 * Resolves dynamic fields for triggers, actions, and searches
 */
export class DynamicFieldResolver {
  private triggers: Record<string, TriggerConfig>
  private actions: Record<string, ActionConfig>
  private searches: Record<string, SearchConfig>

  constructor(
    triggers: Record<string, TriggerConfig> = {},
    actions: Record<string, ActionConfig> = {},
    searches: Record<string, SearchConfig> = {}
  ) {
    this.triggers = triggers
    this.actions = actions
    this.searches = searches
  }

  /**
   * Resolve all input fields, including dynamic ones
   */
  async resolveInputFields(
    fields: InputFieldOrFunction[],
    z: ZObject,
    bundle: Bundle
  ): Promise<InputField[]> {
    const resolved: InputField[] = []

    for (const field of fields) {
      if (typeof field === 'function') {
        // Dynamic field function
        const dynamicFields = await field(z, bundle)
        resolved.push(...dynamicFields)
      } else {
        // Static field - may need dynamic choices resolved
        const resolvedField = await this.resolveField(field, z, bundle)
        resolved.push(resolvedField)
      }
    }

    return resolved
  }

  /**
   * Resolve a single field's dynamic references
   */
  private async resolveField(
    field: InputField,
    z: ZObject,
    bundle: Bundle
  ): Promise<InputField> {
    const resolved = { ...field }

    // Resolve dynamic dropdown
    if (field.dynamic) {
      resolved.choices = await this.resolveDynamicChoices(
        field.dynamic,
        z,
        bundle
      )
    }

    // Resolve search reference
    if (field.search) {
      // Search reference is used for "search or create" UI
      // The actual search is executed at runtime
    }

    // Resolve children recursively
    if (field.children) {
      resolved.children = await Promise.all(
        field.children.map((child) => this.resolveField(child, z, bundle))
      )
    }

    return resolved
  }

  /**
   * Resolve dynamic dropdown choices from a trigger/action/search
   */
  async resolveDynamicChoices(
    dynamicRef: string,
    z: ZObject,
    bundle: Bundle
  ): Promise<Array<{ value: string; label: string }>> {
    // Parse dynamic reference: trigger_key.id_field.label_field
    const parts = dynamicRef.split('.')
    if (parts.length < 2) {
      throw new Error(`Invalid dynamic reference: ${dynamicRef}`)
    }

    const [sourceKey, idField, labelField] = parts
    const actualLabelField = labelField || idField

    // Find the source
    let results: unknown[] = []

    if (this.triggers[sourceKey]) {
      results = await this.triggers[sourceKey].operation.perform(z, bundle)
    } else if (this.searches[sourceKey]) {
      results = await this.searches[sourceKey].operation.perform(z, bundle)
    } else {
      throw new Error(`Dynamic source not found: ${sourceKey}`)
    }

    // Transform results to choices
    return results.map((item) => {
      const record = item as Record<string, unknown>
      return {
        value: String(record[idField] ?? ''),
        label: String(record[actualLabelField] ?? record[idField] ?? ''),
      }
    })
  }

  /**
   * Check if any fields need dynamic resolution
   */
  hasFieldsWithDynamic(fields: InputFieldOrFunction[]): boolean {
    for (const field of fields) {
      if (typeof field === 'function') {
        return true
      }
      if (field.dynamic || field.altersDynamicFields) {
        return true
      }
      if (field.children && this.hasFieldsWithDynamic(field.children)) {
        return true
      }
    }
    return false
  }

  /**
   * Get fields that should trigger refresh when changed
   */
  getAlteringFields(fields: InputFieldOrFunction[]): string[] {
    const altering: string[] = []

    for (const field of fields) {
      if (typeof field === 'function') continue

      if (field.altersDynamicFields) {
        altering.push(field.key)
      }

      if (field.children) {
        altering.push(...this.getAlteringFields(field.children))
      }
    }

    return altering
  }
}

// ============================================================================
// FIELD DEPENDENCY GRAPH
// ============================================================================

/**
 * Tracks dependencies between fields
 */
export class FieldDependencyGraph {
  private dependencies = new Map<string, Set<string>>()

  /**
   * Add a dependency: fieldKey depends on dependsOn
   */
  addDependency(fieldKey: string, dependsOn: string): void {
    if (!this.dependencies.has(fieldKey)) {
      this.dependencies.set(fieldKey, new Set())
    }
    this.dependencies.get(fieldKey)!.add(dependsOn)
  }

  /**
   * Get fields that depend on a given field
   */
  getDependents(fieldKey: string): string[] {
    const dependents: string[] = []

    for (const [key, deps] of this.dependencies) {
      if (deps.has(fieldKey)) {
        dependents.push(key)
      }
    }

    return dependents
  }

  /**
   * Get fields that a given field depends on
   */
  getDependencies(fieldKey: string): string[] {
    const deps = this.dependencies.get(fieldKey)
    return deps ? Array.from(deps) : []
  }

  /**
   * Get all fields in resolution order (topological sort)
   */
  getResolutionOrder(fields: string[]): string[] {
    const visited = new Set<string>()
    const order: string[] = []

    const visit = (key: string) => {
      if (visited.has(key)) return
      visited.add(key)

      const deps = this.dependencies.get(key)
      if (deps) {
        for (const dep of deps) {
          visit(dep)
        }
      }

      order.push(key)
    }

    for (const field of fields) {
      visit(field)
    }

    return order
  }

  /**
   * Build graph from field definitions
   */
  static fromFields(fields: InputField[]): FieldDependencyGraph {
    const graph = new FieldDependencyGraph()

    for (const field of fields) {
      if (field.dynamic) {
        // Dynamic fields depend on the source trigger/search
        const sourceParts = field.dynamic.split('.')
        if (sourceParts.length > 0) {
          graph.addDependency(field.key, `__source:${sourceParts[0]}`)
        }
      }

      // Fields with altersDynamicFields are dependencies
      if (field.altersDynamicFields) {
        // Find all fields that use dynamic
        for (const other of fields) {
          if (other.dynamic && other !== field) {
            graph.addDependency(other.key, field.key)
          }
        }
      }
    }

    return graph
  }
}

// ============================================================================
// FIELD VALIDATION
// ============================================================================

/**
 * Validate field values against definitions
 */
export function validateFieldValues(
  values: Record<string, unknown>,
  fields: InputField[]
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const value = values[field.key]

    // Check required
    if (field.required && (value === undefined || value === null || value === '')) {
      errors[field.key] = `${field.label} is required`
      continue
    }

    // Skip validation if no value and not required
    if (value === undefined || value === null) {
      continue
    }

    // Type validation
    switch (field.type) {
      case 'number':
      case 'integer':
        if (isNaN(Number(value))) {
          errors[field.key] = `${field.label} must be a number`
        } else if (field.type === 'integer' && !Number.isInteger(Number(value))) {
          errors[field.key] = `${field.label} must be an integer`
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean' && !['true', 'false', '0', '1'].includes(String(value))) {
          errors[field.key] = `${field.label} must be a boolean`
        }
        break

      case 'datetime':
        if (isNaN(Date.parse(String(value)))) {
          errors[field.key] = `${field.label} must be a valid date`
        }
        break
    }

    // Choices validation
    if (field.choices && field.choices.length > 0) {
      const validValues = field.choices.map((c) =>
        typeof c === 'string' ? c : c.value
      )
      if (!validValues.includes(String(value))) {
        errors[field.key] = `${field.label} must be one of: ${validValues.join(', ')}`
      }
    }

    // Validate children for list fields
    if (field.list && field.children && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const childValue = value[i] as Record<string, unknown>
        const childResult = validateFieldValues(childValue, field.children)
        if (!childResult.valid) {
          for (const [key, error] of Object.entries(childResult.errors)) {
            errors[`${field.key}[${i}].${key}`] = error
          }
        }
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

// ============================================================================
// FIELD TRANSFORMATION
// ============================================================================

/**
 * Transform field values to appropriate types
 */
export function transformFieldValues(
  values: Record<string, unknown>,
  fields: InputField[]
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {}

  for (const field of fields) {
    const value = values[field.key]

    if (value === undefined || value === null) {
      if (field.default !== undefined) {
        transformed[field.key] = field.default
      }
      continue
    }

    switch (field.type) {
      case 'number':
        transformed[field.key] = Number(value)
        break

      case 'integer':
        transformed[field.key] = Math.floor(Number(value))
        break

      case 'boolean':
        if (typeof value === 'boolean') {
          transformed[field.key] = value
        } else {
          transformed[field.key] = ['true', '1'].includes(String(value).toLowerCase())
        }
        break

      case 'datetime':
        transformed[field.key] = new Date(String(value)).toISOString()
        break

      case 'file':
        // File values should remain as-is (URL or hydration reference)
        transformed[field.key] = value
        break

      default:
        transformed[field.key] = value
    }

    // Handle list fields
    if (field.list && field.children && Array.isArray(value)) {
      transformed[field.key] = value.map((item) =>
        transformFieldValues(item as Record<string, unknown>, field.children!)
      )
    }
  }

  // Include values not in field definitions
  for (const [key, value] of Object.entries(values)) {
    if (!(key in transformed)) {
      transformed[key] = value
    }
  }

  return transformed
}

// ============================================================================
// SAMPLE DATA GENERATOR
// ============================================================================

/**
 * Generate sample data from field definitions
 */
export function generateSampleData(fields: InputField[]): Record<string, unknown> {
  const sample: Record<string, unknown> = {}

  for (const field of fields) {
    sample[field.key] = generateSampleValue(field)
  }

  return sample
}

/**
 * Generate a sample value for a single field
 */
function generateSampleValue(field: InputField): unknown {
  // Use default if provided
  if (field.default !== undefined) {
    return field.default
  }

  // Use first choice if available
  if (field.choices && field.choices.length > 0) {
    const firstChoice = field.choices[0]
    return typeof firstChoice === 'string' ? firstChoice : firstChoice.value
  }

  // Generate based on type
  switch (field.type) {
    case 'string':
    case 'text':
      return field.placeholder || `Sample ${field.label}`

    case 'number':
      return 123.45

    case 'integer':
      return 42

    case 'boolean':
      return true

    case 'datetime':
      return new Date().toISOString()

    case 'file':
      return 'https://example.com/sample.pdf'

    case 'password':
      return '********'

    case 'copy':
      return ''

    default:
      return `sample_${field.key}`
  }
}

// ============================================================================
// FIELD FLATTENING
// ============================================================================

/**
 * Flatten nested fields with children into dot-notation keys
 */
export function flattenFields(
  fields: InputField[],
  prefix = ''
): InputField[] {
  const flattened: InputField[] = []

  for (const field of fields) {
    const key = prefix ? `${prefix}.${field.key}` : field.key

    if (field.children && !field.list) {
      // Flatten children
      flattened.push(...flattenFields(field.children, key))
    } else {
      // Add field with updated key
      flattened.push({ ...field, key })
    }
  }

  return flattened
}

/**
 * Unflatten dot-notation data to nested objects
 */
export function unflattenData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.')
    let current = result

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current)) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  return result
}
