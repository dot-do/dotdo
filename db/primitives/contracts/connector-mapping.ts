/**
 * ConnectorFramework Schema Mapping for DataContract
 *
 * Integrates DataContract with ConnectorFramework for source-to-destination schema mapping.
 *
 * Features:
 * - Source schema to contract mapping
 * - Contract to destination schema mapping
 * - Field type conversion rules
 * - Nested object flattening
 * - Array handling strategies
 * - Auto-mapping based on schema analysis
 *
 * @module db/primitives/contracts/connector-mapping
 */

import type {
  DataContract,
  JSONSchema,
  ValidationError,
  ValidationResult,
} from '../data-contract'

// =============================================================================
// Types
// =============================================================================

/**
 * Field mapping definition
 */
export interface FieldMapping {
  /** Source field path (dot notation for nested) */
  source?: string
  /** Destination field path */
  destination: string
  /** Compute function for derived fields */
  compute?: (record: Record<string, unknown>) => unknown
}

/**
 * Mapping options for contract schema mapper
 */
export interface MappingOptions {
  /** Source data contract */
  sourceContract: DataContract
  /** Destination data contract */
  destinationContract: DataContract
  /** Field mappings */
  fieldMappings?: FieldMapping[]
  /** Validate source data against source contract */
  validateSource?: boolean
  /** Validate destination data against destination contract */
  validateDestination?: boolean
  /** Auto-convert types based on schema definitions */
  autoConvertTypes?: boolean
  /** Flatten source before mapping */
  flattenSource?: {
    enabled: boolean
    separator?: string
  }
}

/**
 * Mapping result with validation
 */
export interface MappingResult<T = Record<string, unknown>> {
  /** Whether mapping was successful */
  valid: boolean
  /** Mapped data (if valid) */
  data?: T
  /** Validation errors */
  errors: ValidationError[]
}

/**
 * Schema mapping between source and destination
 */
export interface SchemaMapping {
  source: DataContract
  destination: DataContract
  fieldMappings: FieldMapping[]
  transformations: Array<{
    field: string
    transform: (value: unknown) => unknown
  }>
}

// =============================================================================
// Type Converter
// =============================================================================

/**
 * Type conversion rule
 */
export interface TypeConversionRule {
  from: string
  to: string
  sourceFormat?: string
  destinationFormat?: string
  convert: (value: unknown) => unknown
}

/**
 * Conversion options
 */
export interface ConversionOptions {
  sourceFormat?: string
  destinationFormat?: string
  nullDefault?: unknown
  asJson?: boolean
}

/**
 * Type converter configuration
 */
export interface TypeConverterConfig {
  customRules?: TypeConversionRule[]
}

/**
 * Type converter class
 */
export class TypeConverter {
  private customRules: TypeConversionRule[]

  constructor(config: TypeConverterConfig = {}) {
    this.customRules = config.customRules || []
  }

  /**
   * Convert a value from one type to another
   */
  convert(
    value: unknown,
    fromType: string,
    toType: string,
    options: ConversionOptions = {}
  ): unknown {
    // Handle null values
    if (value === null || value === undefined) {
      return options.nullDefault !== undefined ? options.nullDefault : null
    }

    // Check custom rules first
    for (const rule of this.customRules) {
      if (
        rule.from === fromType &&
        rule.to === toType &&
        (!rule.sourceFormat || rule.sourceFormat === options.sourceFormat)
      ) {
        return rule.convert(value)
      }
    }

    // Same type - no conversion needed
    if (fromType === toType && !options.sourceFormat && !options.destinationFormat) {
      return value
    }

    // Handle format conversions for same type
    if (fromType === 'string' && toType === 'string') {
      if (options.sourceFormat === 'date-time' && options.destinationFormat === 'date') {
        const date = new Date(value as string)
        return date.toISOString().split('T')[0]
      }
      return value
    }

    // Date-time string to integer (timestamp) - check BEFORE generic string-to-integer
    if (
      fromType === 'string' &&
      toType === 'integer' &&
      options.sourceFormat === 'date-time'
    ) {
      return new Date(value as string).getTime()
    }

    // Date-time string to number (timestamp) - similar case
    if (
      fromType === 'string' &&
      toType === 'number' &&
      options.sourceFormat === 'date-time'
    ) {
      return new Date(value as string).getTime()
    }

    // String to number
    if (fromType === 'string' && toType === 'number') {
      return parseFloat(value as string)
    }

    // String to integer
    if (fromType === 'string' && toType === 'integer') {
      return Math.trunc(parseFloat(value as string))
    }

    // String to boolean
    if (fromType === 'string' && toType === 'boolean') {
      const str = (value as string).toLowerCase().trim()
      if (['true', 'yes', '1', 'y'].includes(str)) return true
      if (['false', 'no', '0', 'n', ''].includes(str)) return false
      return Boolean(value)
    }

    // Number/Integer to string
    if ((fromType === 'number' || fromType === 'integer') && toType === 'string') {
      if (options.destinationFormat === 'date-time') {
        return new Date(value as number).toISOString()
      }
      return String(value)
    }

    // Boolean to string
    if (fromType === 'boolean' && toType === 'string') {
      return String(value)
    }

    // Boolean to number
    if (fromType === 'boolean' && toType === 'number') {
      return value ? 1 : 0
    }

    // Boolean to integer
    if (fromType === 'boolean' && toType === 'integer') {
      return value ? 1 : 0
    }

    // Array to string
    if (fromType === 'array' && toType === 'string') {
      const arr = value as unknown[]
      if (options.asJson) {
        return JSON.stringify(arr)
      }
      return arr.join(',')
    }

    // String to array
    if (fromType === 'string' && toType === 'array') {
      return (value as string).split(',').map((s) => s.trim())
    }

    // Integer to date-time string
    if (
      fromType === 'integer' &&
      toType === 'string' &&
      options.destinationFormat === 'date-time'
    ) {
      return new Date(value as number).toISOString()
    }

    // Integer to number (always compatible)
    if (fromType === 'integer' && toType === 'number') {
      return value
    }

    // Number to integer
    if (fromType === 'number' && toType === 'integer') {
      return Math.trunc(value as number)
    }

    return value
  }
}

/**
 * Create a type converter
 */
export function createTypeConverter(config: TypeConverterConfig = {}): TypeConverter {
  return new TypeConverter(config)
}

// =============================================================================
// Flattening Strategy
// =============================================================================

/**
 * Array handling strategy
 */
export type ArrayHandlingStrategy = 'preserve' | 'join' | 'json' | 'index' | 'first'

/**
 * Flatten options
 */
export interface FlattenOptions {
  /** Key separator */
  separator?: string
  /** Maximum depth to flatten */
  maxDepth?: number
  /** Array handling strategy */
  arrayHandling?: ArrayHandlingStrategy
  /** Join separator for array handling */
  joinSeparator?: string
  /** Paths to include in flattening */
  includePaths?: string[]
  /** Paths to exclude from flattening */
  excludePaths?: string[]
}

/**
 * Flattening strategy class
 */
export class FlatteningStrategy {
  private separator: string
  private maxDepth: number
  private arrayHandling: ArrayHandlingStrategy
  private joinSeparator: string
  private includePaths: Set<string>
  private excludePaths: Set<string>

  constructor(options: FlattenOptions = {}) {
    this.separator = options.separator || '_'
    this.maxDepth = options.maxDepth ?? Infinity
    this.arrayHandling = options.arrayHandling || 'preserve'
    this.joinSeparator = options.joinSeparator || ','
    this.includePaths = new Set(options.includePaths || [])
    this.excludePaths = new Set(options.excludePaths || [])
  }

  /**
   * Convert a path using separator to dot notation for comparison
   */
  private toDotPath(path: string): string {
    if (this.separator === '.') return path
    return path.split(this.separator).join('.')
  }

  /**
   * Check if a path should be flattened (uses dot notation internally)
   * The path parameter is in dot notation for comparison with include/exclude paths
   */
  private shouldFlatten(dotPath: string): boolean {
    // If excludePaths contains this path prefix, don't flatten
    for (const excludePath of this.excludePaths) {
      if (dotPath === excludePath || dotPath.startsWith(excludePath + '.')) {
        return false
      }
    }

    // If includePaths is specified, only flatten those paths
    if (this.includePaths.size > 0) {
      for (const includePath of this.includePaths) {
        if (dotPath === includePath || dotPath.startsWith(includePath + '.')) {
          return true
        }
      }
      return false
    }

    return true
  }

  /**
   * Check if a path is specifically included in includePaths (for partial flattening)
   */
  private isIncludedPath(dotPath: string): boolean {
    if (this.includePaths.size === 0) return false
    for (const includePath of this.includePaths) {
      if (dotPath === includePath || dotPath.startsWith(includePath + '.')) {
        return true
      }
    }
    return false
  }

  /**
   * Handle array based on strategy
   */
  private handleArray(arr: unknown[], path: string): unknown {
    switch (this.arrayHandling) {
      case 'join':
        return arr.map((item) => String(item)).join(this.joinSeparator)
      case 'json':
        return JSON.stringify(arr)
      case 'first':
        return arr.length > 0 ? arr[0] : null
      case 'index':
      case 'preserve':
      default:
        return arr
    }
  }

  /**
   * Flatten an object
   */
  flatten(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // Process object recursively, tracking both dotPath (for include/exclude checks)
    // and separatorPath (for output keys)
    const flattenRecursive = (
      current: unknown,
      dotPath: string,
      separatorPath: string,
      depth: number
    ): void => {
      // Handle null/undefined
      if (current === null || current === undefined) {
        result[separatorPath] = current
        return
      }

      // Handle arrays
      if (Array.isArray(current)) {
        if (this.arrayHandling === 'index') {
          current.forEach((item, index) => {
            const newDotPath = dotPath ? `${dotPath}.${index}` : String(index)
            const newSepPath = separatorPath ? `${separatorPath}${this.separator}${index}` : String(index)
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
              flattenRecursive(item, newDotPath, newSepPath, depth + 1)
            } else {
              result[newSepPath] = item
            }
          })
        } else {
          result[separatorPath] = this.handleArray(current, separatorPath)
        }
        return
      }

      // Handle objects
      if (typeof current === 'object' && !(current instanceof Date)) {
        // Check depth limit
        if (depth >= this.maxDepth) {
          result[separatorPath] = current
          return
        }

        // Check if we should flatten this path
        if (dotPath && !this.shouldFlatten(dotPath)) {
          result[separatorPath] = current
          return
        }

        for (const [key, value] of Object.entries(current)) {
          const newDotPath = dotPath ? `${dotPath}.${key}` : key
          const newSepPath = separatorPath ? `${separatorPath}${this.separator}${key}` : key
          flattenRecursive(value, newDotPath, newSepPath, depth + 1)
        }
        return
      }

      // Handle primitives
      result[separatorPath] = current
    }

    // When we have includePaths, we need special handling:
    // - Paths not under includePaths should be preserved (not flattened)
    // - Paths under includePaths should be flattened
    const processTopLevel = (
      obj: Record<string, unknown>,
      dotPath: string,
      separatorPath: string,
      depth: number
    ): void => {
      for (const [key, value] of Object.entries(obj)) {
        const newDotPath = dotPath ? `${dotPath}.${key}` : key
        const newSepPath = separatorPath ? `${separatorPath}${this.separator}${key}` : key

        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
          // Check if this path or any child is included
          const isThisPathIncluded = this.includePaths.size > 0 && this.isIncludedPath(newDotPath)
          const hasIncludedChild = this.includePaths.size > 0 &&
            [...this.includePaths].some(p => p.startsWith(newDotPath + '.'))

          if (this.includePaths.size > 0 && !isThisPathIncluded && !hasIncludedChild) {
            // Not in includePaths and no children in includePaths - copy as-is
            if (separatorPath) {
              // We're nested, need to handle this in parent result
              if (!(separatorPath in result)) {
                result[separatorPath] = {}
              }
              (result[separatorPath] as Record<string, unknown>)[key] = value
            } else {
              if (!(key in result)) {
                result[key] = {}
              }
              Object.assign(result[key] as Record<string, unknown>, value)
            }
          } else if (hasIncludedChild && !isThisPathIncluded) {
            // Has included children but this path itself is not included
            // We need to preserve non-included siblings
            processTopLevel(value as Record<string, unknown>, newDotPath, newSepPath, depth + 1)
          } else if (isThisPathIncluded) {
            // This path is included - flatten it
            flattenRecursive(value, newDotPath, newSepPath, depth + 1)
          } else if (!this.shouldFlatten(newDotPath)) {
            result[newSepPath] = value
          } else if (this.maxDepth === 0 || depth >= this.maxDepth) {
            result[newSepPath] = value
          } else {
            flattenRecursive(value, newDotPath, newSepPath, depth + 1)
          }
        } else if (Array.isArray(value)) {
          if (this.arrayHandling === 'index') {
            value.forEach((item, index) => {
              const itemDotPath = `${newDotPath}.${index}`
              const itemSepPath = `${newSepPath}${this.separator}${index}`
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                flattenRecursive(item, itemDotPath, itemSepPath, depth + 1)
              } else {
                result[itemSepPath] = item
              }
            })
          } else {
            result[newSepPath] = this.handleArray(value, newSepPath)
          }
        } else {
          // Primitive value - check if we should put it in a nested object or flat
          if (this.includePaths.size > 0 && !this.isIncludedPath(newDotPath)) {
            // Not included - put in nested structure
            if (separatorPath) {
              if (!(separatorPath in result)) {
                result[separatorPath] = {}
              }
              (result[separatorPath] as Record<string, unknown>)[key] = value
            } else {
              result[key] = value
            }
          } else {
            result[newSepPath] = value
          }
        }
      }
    }

    // Handle top-level entries
    if (this.includePaths.size > 0) {
      // With includePaths, use the special processing
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
          const isKeyIncluded = this.isIncludedPath(key)
          const hasIncludedChild = [...this.includePaths].some(p => p.startsWith(key + '.'))

          if (!isKeyIncluded && !hasIncludedChild) {
            // Not in includePaths - preserve the object
            result[key] = value
          } else if (hasIncludedChild && !isKeyIncluded) {
            // Has children in includePaths, process selectively
            // Initialize this key as an object for non-flattened children
            result[key] = {}
            for (const [childKey, childValue] of Object.entries(value)) {
              const childDotPath = `${key}.${childKey}`
              const childSepPath = `${key}${this.separator}${childKey}`

              if (typeof childValue === 'object' && childValue !== null && !Array.isArray(childValue) && !(childValue instanceof Date)) {
                if (this.isIncludedPath(childDotPath)) {
                  // This child is in includePaths - flatten it
                  flattenRecursive(childValue, childDotPath, childSepPath, 2)
                } else {
                  // Not in includePaths - preserve in parent object
                  (result[key] as Record<string, unknown>)[childKey] = childValue
                }
              } else {
                // Primitive or array at child level - keep in parent
                (result[key] as Record<string, unknown>)[childKey] = childValue
              }
            }
          } else {
            // This key is included - flatten it
            flattenRecursive(value, key, key, 1)
          }
        } else if (Array.isArray(value)) {
          if (this.arrayHandling === 'index') {
            value.forEach((item, index) => {
              const itemDotPath = `${key}.${index}`
              const itemSepPath = `${key}${this.separator}${index}`
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                flattenRecursive(item, itemDotPath, itemSepPath, 1)
              } else {
                result[itemSepPath] = item
              }
            })
          } else {
            result[key] = this.handleArray(value, key)
          }
        } else {
          result[key] = value
        }
      }
    } else {
      // No includePaths - use standard processing
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
          if (!this.shouldFlatten(key)) {
            result[key] = value
          } else if (this.maxDepth === 0) {
            result[key] = value
          } else {
            flattenRecursive(value, key, key, 1)
          }
        } else if (Array.isArray(value)) {
          if (this.arrayHandling === 'index') {
            value.forEach((item, index) => {
              const itemDotPath = `${key}.${index}`
              const itemSepPath = `${key}${this.separator}${index}`
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                flattenRecursive(item, itemDotPath, itemSepPath, 1)
              } else {
                result[itemSepPath] = item
              }
            })
          } else {
            result[key] = this.handleArray(value, key)
          }
        } else {
          result[key] = value
        }
      }
    }

    return result
  }

  /**
   * Unflatten an object
   */
  unflatten(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      const parts = key.split(this.separator)

      if (parts.length === 1) {
        result[key] = value
        continue
      }

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
}

/**
 * Create a flattening strategy
 */
export function createFlatteningStrategy(options: FlattenOptions = {}): FlatteningStrategy {
  return new FlatteningStrategy(options)
}

// =============================================================================
// Contract Schema Mapper
// =============================================================================

/**
 * Contract schema mapper class
 */
export class ContractSchemaMapper {
  private sourceContract: DataContract
  private destinationContract: DataContract
  private fieldMappings: FieldMapping[]
  private validateSource: boolean
  private validateDestination: boolean
  private autoConvertTypes: boolean
  private flattenSource?: FlatteningStrategy
  private flattenSourceSeparator: string
  private typeConverter: TypeConverter

  // Reverse mapping lookup
  private reverseMapping: Map<string, string>

  constructor(options: MappingOptions) {
    this.sourceContract = options.sourceContract
    this.destinationContract = options.destinationContract
    this.fieldMappings = options.fieldMappings || []
    this.validateSource = options.validateSource ?? false
    this.validateDestination = options.validateDestination ?? false
    this.autoConvertTypes = options.autoConvertTypes ?? false
    this.typeConverter = new TypeConverter()
    this.flattenSourceSeparator = '_'

    // Build reverse mapping
    this.reverseMapping = new Map()
    for (const mapping of this.fieldMappings) {
      if (mapping.source) {
        this.reverseMapping.set(mapping.destination, mapping.source)
      }
    }

    // Setup flattening strategy if enabled
    if (options.flattenSource?.enabled) {
      this.flattenSourceSeparator = options.flattenSource.separator || '_'
      this.flattenSource = new FlatteningStrategy({
        separator: this.flattenSourceSeparator,
      })
    }
  }

  /**
   * Get nested value from object
   * First checks for exact key match (for flattened sources), then tries path traversal
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    // If source was flattened, try exact key match first
    if (this.flattenSource && path in obj) {
      return obj[path]
    }

    // Otherwise, traverse the path
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Set nested value in object
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  /**
   * Get the type of a field from a schema
   */
  private getFieldType(schema: JSONSchema, path: string): string | undefined {
    const parts = path.split('.')
    let current = schema
    for (const part of parts) {
      if (!current.properties || !current.properties[part]) {
        return undefined
      }
      current = current.properties[part]
    }
    const type = current.type
    return Array.isArray(type) ? type[0] : type
  }

  /**
   * Get the format of a field from a schema
   */
  private getFieldFormat(schema: JSONSchema, path: string): string | undefined {
    const parts = path.split('.')
    let current = schema
    for (const part of parts) {
      if (!current.properties || !current.properties[part]) {
        return undefined
      }
      current = current.properties[part]
    }
    return current.format
  }

  /**
   * Convert a flattened field path back to dot notation for schema lookup
   */
  private toSchemaPath(field: string): string {
    // If source was flattened, the field name uses the separator
    // Convert back to dot notation for schema lookup
    if (this.flattenSource && this.flattenSourceSeparator !== '.') {
      return field.split(this.flattenSourceSeparator).join('.')
    }
    return field
  }

  /**
   * Convert value based on source and destination types
   */
  private convertValue(
    value: unknown,
    sourceField: string,
    destField: string
  ): unknown {
    if (!this.autoConvertTypes) {
      return value
    }

    // Convert flattened source field to schema path for type lookup
    const sourceSchemaPath = this.toSchemaPath(sourceField)

    const sourceType = this.getFieldType(this.sourceContract.schema, sourceSchemaPath)
    const destType = this.getFieldType(this.destinationContract.schema, destField)
    const sourceFormat = this.getFieldFormat(this.sourceContract.schema, sourceSchemaPath)
    const destFormat = this.getFieldFormat(this.destinationContract.schema, destField)

    if (!sourceType || !destType) {
      return value
    }

    return this.typeConverter.convert(value, sourceType, destType, {
      sourceFormat,
      destinationFormat: destFormat,
    })
  }

  /**
   * Map source data to destination schema
   */
  mapToDestination(source: Record<string, unknown>): Record<string, unknown> {
    let input = source

    // Flatten source if enabled
    if (this.flattenSource) {
      input = this.flattenSource.flatten(source)
    }

    const result: Record<string, unknown> = {}

    // Apply field mappings
    for (const mapping of this.fieldMappings) {
      if (mapping.compute) {
        // Computed field
        const computed = mapping.compute(source)
        this.setNestedValue(result, mapping.destination, computed)
      } else if (mapping.source) {
        // Direct mapping
        const value = this.getNestedValue(input, mapping.source)
        if (value !== undefined) {
          const convertedValue = this.convertValue(value, mapping.source, mapping.destination)
          this.setNestedValue(result, mapping.destination, convertedValue)
        }
      }
    }

    // Auto-map matching field names if no explicit mappings
    if (this.fieldMappings.length === 0) {
      const destProps = this.destinationContract.schema.properties || {}
      for (const destField of Object.keys(destProps)) {
        if (destField in input) {
          result[destField] = input[destField]
        }
      }
    }

    return result
  }

  /**
   * Map destination data back to source schema
   */
  mapToSource(dest: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const mapping of this.fieldMappings) {
      if (mapping.source) {
        const value = this.getNestedValue(dest, mapping.destination)
        if (value !== undefined) {
          this.setNestedValue(result, mapping.source, value)
        }
      }
    }

    return result
  }

  /**
   * Validate data against a contract schema
   */
  private validateData(data: unknown, schema: JSONSchema): ValidationError[] {
    const errors: ValidationError[] = []

    if (typeof data !== 'object' || data === null) {
      return errors
    }

    const obj = data as Record<string, unknown>

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (obj[field] === undefined) {
          errors.push({
            path: field,
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    return errors
  }

  /**
   * Map with validation
   */
  mapToDestinationWithValidation(source: Record<string, unknown>): MappingResult {
    const errors: ValidationError[] = []

    // Validate source if enabled
    if (this.validateSource) {
      const sourceErrors = this.validateData(source, this.sourceContract.schema)
      errors.push(...sourceErrors)
    }

    if (errors.length > 0) {
      return { valid: false, errors }
    }

    // Perform mapping
    const mapped = this.mapToDestination(source)

    // Validate destination if enabled
    if (this.validateDestination) {
      const destErrors = this.validateData(mapped, this.destinationContract.schema)
      errors.push(...destErrors)
    }

    if (errors.length > 0) {
      return { valid: false, errors, data: mapped }
    }

    return { valid: true, errors: [], data: mapped }
  }
}

/**
 * Create a contract schema mapper
 */
export function createContractSchemaMapper(options: MappingOptions): ContractSchemaMapper {
  return new ContractSchemaMapper(options)
}

// =============================================================================
// Auto-Mapping
// =============================================================================

/**
 * Auto-map options
 */
export interface AutoMapOptions {
  /** Use string similarity for matching */
  useSimilarity?: boolean
  /** Similarity threshold (0-1) */
  similarityThreshold?: number
  /** Check type compatibility */
  checkTypeCompatibility?: boolean
}

/**
 * Suggested mapping from auto-map
 */
export interface SuggestedMapping {
  source: string
  destination: string
  similarity?: number
  typeCompatible?: boolean
  conversionNeeded?: boolean
}

/**
 * Auto-map result
 */
export interface AutoMapResult {
  /** Successfully auto-mapped fields */
  mappedFields: FieldMapping[]
  /** Suggested mappings based on similarity */
  suggestedMappings: SuggestedMapping[]
  /** Source fields not mapped */
  unmappedSource: string[]
  /** Destination fields not mapped */
  unmappedDestination: string[]
}

/**
 * Calculate string similarity for field name matching
 * Uses multiple heuristics to detect common naming patterns
 */
function stringSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()

  if (aLower === bLower) return 1

  // Normalize by splitting on common separators (snake_case, camelCase)
  const aNormalized = aLower.replace(/[_-]/g, '').replace(/([a-z])([A-Z])/g, '$1$2').toLowerCase()
  const bNormalized = bLower.replace(/[_-]/g, '').replace(/([a-z])([A-Z])/g, '$1$2').toLowerCase()

  // Extract meaningful parts (split by underscore, hyphen, or camelCase boundaries)
  const aParts = aLower.split(/[_-]|(?=[A-Z])/).filter(p => p.length > 0)
  const bParts = bLower.split(/[_-]|(?=[A-Z])/).filter(p => p.length > 0)

  // Check if one is a suffix/prefix of the other (common pattern: id -> user_id)
  if (bParts.length > 0 && bParts[bParts.length - 1] === aLower) {
    // a is the suffix of b (e.g., 'id' is suffix of 'user_id')
    return 0.8 // High score for suffix matches
  }
  if (aParts.length > 0 && aParts[aParts.length - 1] === bLower) {
    return 0.8
  }

  // Check if one contains the other as a word boundary
  const aWithBoundaries = `_${aLower}_`
  const bWithBoundaries = `_${bLower}_`
  if (bWithBoundaries.includes(`_${aLower}_`) || aWithBoundaries.includes(`_${bLower}_`)) {
    const shorter = Math.min(a.length, b.length)
    const longer = Math.max(a.length, b.length)
    return Math.max(0.6, shorter / longer)
  }

  // Check if one contains the other
  if (aNormalized.includes(bNormalized) || bNormalized.includes(aNormalized)) {
    const shorter = Math.min(a.length, b.length)
    const longer = Math.max(a.length, b.length)
    return Math.max(0.5, shorter / longer)
  }

  // Calculate word overlap score
  const aPartSet = new Set(aParts)
  const bPartSet = new Set(bParts)
  const intersection = [...aPartSet].filter((p) => bPartSet.has(p)).length
  if (intersection > 0) {
    const union = new Set([...aPartSet, ...bPartSet]).size
    const wordScore = intersection / union
    if (wordScore >= 0.5) return wordScore
  }

  // Fallback: character overlap (Jaccard similarity)
  const aChars = new Set(aLower.split(''))
  const bChars = new Set(bLower.split(''))
  const charIntersection = [...aChars].filter((c) => bChars.has(c)).length
  const charUnion = new Set([...aChars, ...bChars]).size

  return charIntersection / charUnion
}

/**
 * Check if types are compatible
 */
function areTypesCompatible(sourceType: string, destType: string): { compatible: boolean; conversionNeeded: boolean } {
  if (sourceType === destType) {
    return { compatible: true, conversionNeeded: false }
  }

  // Integer is compatible with number
  if (sourceType === 'integer' && destType === 'number') {
    return { compatible: true, conversionNeeded: false }
  }

  // Number can be converted to integer (with truncation)
  if (sourceType === 'number' && destType === 'integer') {
    return { compatible: true, conversionNeeded: true }
  }

  // String can often be converted to other types
  if (sourceType === 'string') {
    return { compatible: true, conversionNeeded: true }
  }

  // Other types can be converted to string
  if (destType === 'string') {
    return { compatible: true, conversionNeeded: true }
  }

  return { compatible: false, conversionNeeded: false }
}

/**
 * Auto-map schemas
 */
export function autoMapSchemas(
  sourceContract: DataContract,
  destinationContract: DataContract,
  options: AutoMapOptions = {}
): AutoMapResult {
  const sourceProps = sourceContract.schema.properties || {}
  const destProps = destinationContract.schema.properties || {}

  const mappedFields: FieldMapping[] = []
  const suggestedMappings: SuggestedMapping[] = []
  const mappedSourceFields = new Set<string>()
  const mappedDestFields = new Set<string>()

  // First pass: exact matches
  for (const sourceField of Object.keys(sourceProps)) {
    if (sourceField in destProps) {
      mappedFields.push({ source: sourceField, destination: sourceField })
      mappedSourceFields.add(sourceField)
      mappedDestFields.add(sourceField)
    }
  }

  // Second pass: similarity-based suggestions
  // Also run similarity matching if checkTypeCompatibility is set (need suggestions to check)
  if (options.useSimilarity || options.checkTypeCompatibility) {
    const threshold = options.similarityThreshold ?? 0.5

    for (const sourceField of Object.keys(sourceProps)) {
      if (mappedSourceFields.has(sourceField)) continue

      for (const destField of Object.keys(destProps)) {
        if (mappedDestFields.has(destField)) continue

        const similarity = stringSimilarity(sourceField, destField)
        if (similarity >= threshold) {
          const sourceType = sourceProps[sourceField].type
          const destType = destProps[destField].type
          const sourceTypeStr = Array.isArray(sourceType) ? sourceType[0] : sourceType
          const destTypeStr = Array.isArray(destType) ? destType[0] : destType

          let typeCompatible = true
          let conversionNeeded = false

          if (options.checkTypeCompatibility && sourceTypeStr && destTypeStr) {
            const compat = areTypesCompatible(sourceTypeStr, destTypeStr)
            typeCompatible = compat.compatible
            conversionNeeded = compat.conversionNeeded
          }

          suggestedMappings.push({
            source: sourceField,
            destination: destField,
            similarity,
            typeCompatible,
            conversionNeeded,
          })
        }
      }
    }
  }

  // Collect unmapped fields
  const unmappedSource = Object.keys(sourceProps).filter(
    (f) => !mappedSourceFields.has(f) && !suggestedMappings.some((m) => m.source === f)
  )
  const unmappedDestination = Object.keys(destProps).filter(
    (f) => !mappedDestFields.has(f) && !suggestedMappings.some((m) => m.destination === f)
  )

  return {
    mappedFields,
    suggestedMappings,
    unmappedSource,
    unmappedDestination,
  }
}

// =============================================================================
// Contract-Aware Connector
// =============================================================================

/**
 * Contract-aware connector configuration
 */
export interface ContractAwareConnectorConfig {
  sourceContract: DataContract
  destinationContract: DataContract
  fieldMappings: FieldMapping[]
  validateOnTransform?: boolean
  autoConvertTypes?: boolean
}

/**
 * Batch transform result
 */
export interface BatchTransformResult {
  successful: Array<Record<string, unknown>>
  failed: Array<{
    record: Record<string, unknown>
    errors: ValidationError[]
  }>
}

/**
 * Contract-aware connector
 */
export interface ContractAwareConnector {
  sourceContract: DataContract
  destinationContract: DataContract
  mapping: SchemaMapping
  transform: (record: Record<string, unknown>) => Promise<Record<string, unknown>>
  transformBatch: (records: Record<string, unknown>[]) => Promise<BatchTransformResult>
}

/**
 * Create a contract-aware connector
 */
export function createContractAwareConnector(
  config: ContractAwareConnectorConfig
): ContractAwareConnector {
  const mapper = new ContractSchemaMapper({
    sourceContract: config.sourceContract,
    destinationContract: config.destinationContract,
    fieldMappings: config.fieldMappings,
    validateSource: config.validateOnTransform,
    validateDestination: config.validateOnTransform,
    autoConvertTypes: config.autoConvertTypes,
  })

  const mapping: SchemaMapping = {
    source: config.sourceContract,
    destination: config.destinationContract,
    fieldMappings: config.fieldMappings,
    transformations: [],
  }

  return {
    sourceContract: config.sourceContract,
    destinationContract: config.destinationContract,
    mapping,

    async transform(record: Record<string, unknown>): Promise<Record<string, unknown>> {
      if (config.validateOnTransform) {
        const result = mapper.mapToDestinationWithValidation(record)
        if (!result.valid) {
          throw new Error(`Validation failed: ${result.errors.map((e) => e.message).join(', ')}`)
        }
        return result.data!
      }
      return mapper.mapToDestination(record)
    },

    async transformBatch(records: Record<string, unknown>[]): Promise<BatchTransformResult> {
      const successful: Array<Record<string, unknown>> = []
      const failed: Array<{ record: Record<string, unknown>; errors: ValidationError[] }> = []

      for (const record of records) {
        if (config.validateOnTransform) {
          const result = mapper.mapToDestinationWithValidation(record)
          if (result.valid) {
            successful.push(result.data!)
          } else {
            failed.push({ record, errors: result.errors })
          }
        } else {
          successful.push(mapper.mapToDestination(record))
        }
      }

      return { successful, failed }
    },
  }
}
