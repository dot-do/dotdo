/**
 * SemanticLayer Type-Safe Definitions
 *
 * Provides type-safe integration between DataContract and SemanticLayer
 * for metrics, dimensions, and query type inference.
 *
 * Features:
 * - Type-safe dimension definitions from contract fields
 * - Type-safe measure definitions with aggregation validation
 * - Join path type safety and validation
 * - Cube schema generation from contracts
 * - Query result type inference
 *
 * @see dotdo-eh0a8
 */

import type { ZodType, ZodObject, ZodRawShape, ZodTypeAny } from 'zod'
import type { ZodDataContract, JSONSchema } from '../data-contract/schema-dsl'
import type {
  CubeDefinition,
  MetricDefinition,
  DimensionDefinition,
  DimensionType,
  MetricType,
  JoinRelationship,
  SemanticQuery,
  Granularity,
} from '../semantic-layer/index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Aggregation types supported for measures
 */
export type Aggregation =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'custom'

/**
 * Configuration options for dimensions
 */
export interface DimensionConfig {
  description?: string
  sql?: string
  primaryKey?: boolean
  meta?: Record<string, unknown>
}

/**
 * Configuration options for measures
 */
export interface MeasureConfig {
  description?: string
  format?: string
  sql?: string
  meta?: Record<string, unknown>
}

/**
 * Typed dimension with contract field reference
 */
export interface TypedDimension<T = unknown, K extends keyof T = keyof T> {
  name: string
  type: DimensionType
  sql: string
  contractField: K
  description?: string
  primaryKey?: boolean
  enumValues?: string[]
  meta?: Record<string, unknown>
}

/**
 * Typed measure with contract field reference
 */
export interface TypedMeasure<T = unknown, K extends keyof T | null = keyof T | null> {
  name: string
  aggregation: Aggregation
  sql?: string
  contractField: K
  description?: string
  format?: string
  meta?: Record<string, unknown>
}

/**
 * Join definition for cube relationships
 */
export interface JoinConfig {
  target: string
  foreignKey: string
  targetKey: string
  relationship: JoinRelationship
}

/**
 * Cube registration options
 */
export interface CubeRegistrationOptions {
  joins?: JoinConfig[]
}

/**
 * Join path validation result
 */
export interface JoinPathResult {
  valid: boolean
  error?: string
  joinType?: JoinRelationship
  hops?: number
  joins?: Array<{
    from: string
    to: string
    fromKey: string
    toKey: string
    relationship: JoinRelationship
  }>
}

/**
 * Join path definition for validation
 */
export interface JoinPath {
  [key: string]: {
    foreignKey: string
    targetKey: string
  }
}

/**
 * Join path error type
 */
export interface JoinPathError {
  message: string
  path: string[]
  details?: Record<string, unknown>
}

/**
 * Typed cube definition
 */
export interface TypedCube<
  T,
  Measures extends Record<string, TypedMeasure<T>>,
  Dimensions extends Record<string, TypedDimension<T>>,
> {
  name: string
  sql: string
  contract: ZodDataContract<T>
  measures: Measures
  dimensions: Dimensions
}

/**
 * Typed query builder interface
 */
export interface TypedQueryBuilder<
  T,
  Measures extends Record<string, TypedMeasure<T>>,
  Dimensions extends Record<string, TypedDimension<T>>,
> {
  select(...measures: (keyof Measures)[]): TypedQueryBuilder<T, Measures, Dimensions>
  by(...dimensions: (keyof Dimensions)[]): TypedQueryBuilder<T, Measures, Dimensions>
  byTime(
    dimension: keyof Dimensions,
    granularity: Granularity,
    dateRange?: [string, string]
  ): TypedQueryBuilder<T, Measures, Dimensions>
  filter(
    dimension: keyof Dimensions,
    operator: string,
    value: string | string[]
  ): TypedQueryBuilder<T, Measures, Dimensions>
  build(): SemanticQuery
}

/**
 * Inferred query result type
 */
export type InferredQueryResult<
  Cube extends TypedCube<unknown, Record<string, TypedMeasure>, Record<string, TypedDimension>>,
  MeasureNames extends (keyof Cube['measures'])[],
  DimensionNames extends (keyof Cube['dimensions'])[],
> = {
  [K in MeasureNames[number]]: number
} & {
  [K in DimensionNames[number]]: Cube['dimensions'][K] extends { type: 'number' }
    ? number
    : Cube['dimensions'][K] extends { type: 'boolean' }
      ? boolean
      : string
}

/**
 * Cube definition input for typedCube factory
 */
interface TypedCubeInput<T> {
  sql: string
  measures: {
    [name: string]:
      | { aggregation: 'count' }
      | { field: keyof T & string; aggregation: Aggregation }
  }
  dimensions: {
    [name: string]: {
      field: keyof T & string
      sql?: string
      description?: string
      primaryKey?: boolean
    }
  }
}

/**
 * Cube schema generation input
 */
interface CubeSchemaInput<T> {
  measures: {
    [name: string]:
      | { aggregation: 'count' }
      | { field: keyof T & string; aggregation: Aggregation; sql?: string }
  }
  dimensions: {
    [name: string]: {
      field: keyof T & string
      sql?: string
      description?: string
      primaryKey?: boolean
    }
  }
}

/**
 * Query result type definition
 */
interface QueryResultType {
  dimensions: Record<string, string>
  measures: Record<string, string>
  timeDimensions?: Record<string, string>
}

/**
 * Type definition result with TypeScript code
 */
interface TypeDefinitionResult {
  typescript: string
  dimensions: Record<string, string>
  measures: Record<string, string>
}

// =============================================================================
// SEMANTIC TYPE GENERATOR
// =============================================================================

/**
 * Generates type-safe semantic layer definitions from DataContracts
 */
export class SemanticTypeGenerator<T = unknown> {
  private contract: ZodDataContract<T>
  private schema: JSONSchema
  private fieldTypes: Map<string, { type: string; enumValues?: string[] }> = new Map()

  constructor(contract: ZodDataContract<T>) {
    if (!contract) {
      throw new Error('Invalid contract: contract is null or undefined')
    }
    if (!contract.schema && !contract.jsonSchema) {
      throw new Error('Contract must have a schema')
    }

    this.contract = contract
    this.schema = contract.jsonSchema || contract.schema
    this.parseSchema()
  }

  /**
   * Parse the JSON schema to extract field types
   */
  private parseSchema(): void {
    const properties = this.schema.properties || {}

    for (const [field, propSchema] of Object.entries(properties)) {
      const schema = propSchema as JSONSchema
      let type = Array.isArray(schema.type) ? schema.type[0] : schema.type

      // Detect datetime format
      if (type === 'string' && schema.format === 'date-time') {
        type = 'datetime'
      }

      // Extract enum values
      const enumValues = schema.enum as string[] | undefined

      this.fieldTypes.set(field, { type: type || 'unknown', enumValues })
    }
  }

  /**
   * Infer dimension type from contract field type
   */
  inferDimensionType(field: string): DimensionType {
    const fieldInfo = this.fieldTypes.get(field)
    if (!fieldInfo) {
      throw new Error(`Field '${field}' not found in contract`)
    }

    switch (fieldInfo.type) {
      case 'string':
        return 'string'
      case 'datetime':
        return 'time'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'object':
        throw new Error(`Cannot create dimension from object type: field '${field}'`)
      default:
        return 'string'
    }
  }

  /**
   * Validate measure field and aggregation compatibility
   */
  validateMeasure(field: string | null, aggregation: Aggregation): void {
    if (field === null) {
      if (aggregation !== 'count') {
        throw new Error(`Field is required for '${aggregation}' aggregation`)
      }
      return
    }

    const fieldInfo = this.fieldTypes.get(field)
    if (!fieldInfo) {
      throw new Error(`Field '${field}' not found in contract`)
    }

    const numericAggregations: Aggregation[] = ['sum', 'avg', 'min', 'max']
    if (numericAggregations.includes(aggregation)) {
      if (fieldInfo.type !== 'number' && fieldInfo.type !== 'integer') {
        throw new Error(
          `Field '${field}' must be numeric for '${aggregation}' aggregation`
        )
      }
    }
  }

  /**
   * Create a dimension from contract field
   */
  createDimension(field: string, config?: DimensionConfig): TypedDimension<T> {
    const fieldInfo = this.fieldTypes.get(field)
    if (!fieldInfo) {
      throw new Error(`Field '${field}' not found in contract`)
    }

    const type = this.inferDimensionType(field)
    const sql = config?.sql || this.camelToSnake(field)

    return {
      name: field,
      type,
      sql,
      contractField: field as keyof T,
      description: config?.description,
      primaryKey: config?.primaryKey,
      enumValues: fieldInfo.enumValues,
      meta: config?.meta,
    }
  }

  /**
   * Create a measure from contract field
   */
  createMeasure(
    field: string | null,
    aggregation: Aggregation,
    config?: MeasureConfig
  ): TypedMeasure<T> {
    const validAggregations: Aggregation[] = [
      'count',
      'sum',
      'avg',
      'min',
      'max',
      'countDistinct',
      'custom',
    ]

    if (!validAggregations.includes(aggregation)) {
      throw new Error(`Unknown aggregation type: ${aggregation}`)
    }

    this.validateMeasure(field, aggregation)

    let sql: string | undefined
    if (field) {
      sql = config?.sql || this.camelToSnake(field)
    }

    return {
      name: field || 'count',
      aggregation,
      sql,
      contractField: field as keyof T | null,
      description: config?.description,
      format: config?.format,
      meta: config?.meta,
    }
  }

  /**
   * Get all available fields from the contract
   */
  getAvailableFields(): string[] {
    return Array.from(this.fieldTypes.keys())
  }

  /**
   * Get numeric fields from the contract
   */
  getNumericFields(): string[] {
    return Array.from(this.fieldTypes.entries())
      .filter(([, info]) => info.type === 'number' || info.type === 'integer')
      .map(([field]) => field)
  }

  /**
   * Get enum values for a field
   */
  getEnumValues(field: string): string[] | null {
    const fieldInfo = this.fieldTypes.get(field)
    return fieldInfo?.enumValues || null
  }

  /**
   * Generate a complete cube definition
   */
  generateCubeDefinition(input: {
    sql: string
    measures: string[]
    dimensions: string[]
  }): CubeDefinition {
    const measures: Record<string, MetricDefinition> = {}
    const dimensions: Record<string, DimensionDefinition> = {}

    // Parse measures (e.g., 'count', 'sum:amount')
    for (const measureSpec of input.measures) {
      if (measureSpec === 'count') {
        measures.count = { type: 'count' }
      } else if (measureSpec.includes(':')) {
        const [agg, field] = measureSpec.split(':')
        const aggregation = agg as Aggregation
        this.validateMeasure(field!, aggregation)

        const name = this.measureName(aggregation, field!)
        measures[name] = {
          type: aggregation as MetricType,
          sql: this.camelToSnake(field!),
        }
      }
    }

    // Parse dimensions
    for (const field of input.dimensions) {
      const type = this.inferDimensionType(field)
      dimensions[field] = {
        type,
        sql: this.camelToSnake(field),
      }
    }

    return {
      name: this.contract.name,
      sql: input.sql,
      measures,
      dimensions,
    }
  }

  /**
   * Generate measure name from aggregation and field
   */
  private measureName(aggregation: string, field: string): string {
    return aggregation + field.charAt(0).toUpperCase() + field.slice(1)
  }

  /**
   * Convert camelCase to snake_case
   */
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  }
}

// =============================================================================
// TYPE INFERENCE
// =============================================================================

/**
 * Infers types for query results based on cube definitions
 */
export class TypeInference {
  private cubes: Map<
    string,
    TypedCube<unknown, Record<string, TypedMeasure>, Record<string, TypedDimension>>
  > = new Map()

  /**
   * Register a cube for type inference
   */
  registerCube(
    cube: TypedCube<unknown, Record<string, TypedMeasure>, Record<string, TypedDimension>>
  ): void {
    this.cubes.set(cube.name, cube)
  }

  /**
   * Infer result types for a query
   */
  inferQueryResult(query: {
    measures?: string[]
    dimensions?: string[]
    timeDimensions?: Array<{ dimension: string; granularity?: Granularity }>
  }): QueryResultType {
    const result: QueryResultType = {
      dimensions: {},
      measures: {},
    }

    // Infer measure types
    if (query.measures) {
      for (const measureRef of query.measures) {
        const [cubeName, measureName] = measureRef.split('.')
        const cube = this.cubes.get(cubeName!)
        if (!cube) {
          throw new Error(`Cube '${cubeName}' not found`)
        }

        const measure = cube.measures[measureName!]
        if (!measure) {
          throw new Error(`Measure '${measureName}' not found in cube '${cubeName}'`)
        }

        result.measures[measureRef] = 'number'
      }
    }

    // Infer dimension types
    if (query.dimensions) {
      for (const dimRef of query.dimensions) {
        const [cubeName, dimName] = dimRef.split('.')
        const cube = this.cubes.get(cubeName!)
        if (!cube) {
          throw new Error(`Cube '${cubeName}' not found`)
        }

        const dimension = cube.dimensions[dimName!]
        if (!dimension) {
          throw new Error(`Dimension '${dimName}' not found in cube '${cubeName}'`)
        }

        result.dimensions[dimRef] = dimension.type
      }
    }

    // Infer time dimension types
    if (query.timeDimensions) {
      result.timeDimensions = {}
      for (const td of query.timeDimensions) {
        const [cubeName, dimName] = td.dimension.split('.')
        const cube = this.cubes.get(cubeName!)
        if (!cube) {
          throw new Error(`Cube '${cubeName}' not found`)
        }

        const dimension = cube.dimensions[dimName!]
        if (!dimension) {
          throw new Error(`Dimension '${dimName}' not found in cube '${cubeName}'`)
        }

        result.timeDimensions[td.dimension] = 'time'
      }
    }

    return result
  }
}

// =============================================================================
// JOIN PATH VALIDATOR
// =============================================================================

/**
 * Validates join paths between cubes with type safety
 */
export class JoinPathValidator {
  private cubes: Map<
    string,
    {
      contract: ZodDataContract<unknown>
      options?: CubeRegistrationOptions
      fieldTypes: Map<string, string>
    }
  > = new Map()

  /**
   * Register a cube with its contract and join options
   */
  registerCube(
    name: string,
    contract: ZodDataContract<unknown>,
    options?: CubeRegistrationOptions
  ): void {
    const fieldTypes = this.extractFieldTypes(contract)
    this.cubes.set(name, { contract, options, fieldTypes })
  }

  /**
   * Extract field types from contract
   */
  private extractFieldTypes(contract: ZodDataContract<unknown>): Map<string, string> {
    const types = new Map<string, string>()
    const schema = contract.jsonSchema || contract.schema

    if (schema.properties) {
      for (const [field, propSchema] of Object.entries(schema.properties)) {
        const ps = propSchema as JSONSchema
        let type = Array.isArray(ps.type) ? ps.type[0] : ps.type
        if (type === 'string' && ps.format === 'uuid') {
          type = 'uuid'
        }
        types.set(field, type || 'unknown')
      }
    }

    return types
  }

  /**
   * Validate a join path
   */
  validateJoinPath(path: string[]): JoinPathResult {
    if (path.length < 2) {
      return { valid: false, error: 'Join path must have at least 2 cubes' }
    }

    const joins: JoinPathResult['joins'] = []

    for (let i = 0; i < path.length - 1; i++) {
      const fromCube = path[i]!
      const toCube = path[i + 1]!

      const fromInfo = this.cubes.get(fromCube)
      const toInfo = this.cubes.get(toCube)

      if (!fromInfo) {
        return { valid: false, error: `Cube '${fromCube}' not registered` }
      }
      if (!toInfo) {
        return { valid: false, error: `Cube '${toCube}' not registered` }
      }

      // Find join definition
      const join = fromInfo.options?.joins?.find((j) => j.target === toCube)
      if (!join) {
        return {
          valid: false,
          error: `No join defined between '${fromCube}' and '${toCube}'`,
        }
      }

      // Validate key types match
      const fromKeyType = fromInfo.fieldTypes.get(join.foreignKey)
      const toKeyType = toInfo.fieldTypes.get(join.targetKey)

      // Normalize types for comparison (uuid === string for join purposes)
      const normalizeType = (t: string | undefined) =>
        t === 'uuid' ? 'string' : t

      if (normalizeType(fromKeyType) !== normalizeType(toKeyType)) {
        return {
          valid: false,
          error: `Type mismatch: ${fromCube}.${join.foreignKey} (${fromKeyType}) cannot join to ${toCube}.${join.targetKey} (${toKeyType})`,
        }
      }

      joins.push({
        from: fromCube,
        to: toCube,
        fromKey: join.foreignKey,
        toKey: join.targetKey,
        relationship: join.relationship,
      })
    }

    return {
      valid: true,
      joinType: joins[0]?.relationship,
      hops: joins.length,
      joins,
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a typed dimension from a contract field
 */
export function typedDimension<T, K extends keyof T & string>(
  contract: ZodDataContract<T>,
  field: K,
  config?: DimensionConfig
): TypedDimension<T, K> {
  const generator = new SemanticTypeGenerator(contract)
  const dim = generator.createDimension(field, config)

  return {
    ...dim,
    contractField: field,
  } as TypedDimension<T, K>
}

/**
 * Create a typed measure from a contract field
 */
export function typedMeasure<T, K extends keyof T & string | null>(
  contract: ZodDataContract<T>,
  field: K,
  aggregation: Aggregation,
  config?: MeasureConfig
): TypedMeasure<T, K> {
  const generator = new SemanticTypeGenerator(contract)
  const measure = generator.createMeasure(field, aggregation, config)

  return {
    ...measure,
    contractField: field,
  } as TypedMeasure<T, K>
}

/**
 * Create a typed cube from a contract
 */
export function typedCube<
  T,
  MInput extends TypedCubeInput<T>['measures'],
  DInput extends TypedCubeInput<T>['dimensions'],
>(
  contract: ZodDataContract<T>,
  input: {
    sql: string
    measures: MInput
    dimensions: DInput
  }
): TypedCube<
  T,
  { [K in keyof MInput]: TypedMeasure<T> },
  { [K in keyof DInput]: TypedDimension<T> }
> {
  const generator = new SemanticTypeGenerator(contract)

  // Build measures
  const measures = {} as { [K in keyof MInput]: TypedMeasure<T> }
  for (const [name, def] of Object.entries(input.measures)) {
    if ('field' in def) {
      (measures as Record<string, TypedMeasure<T>>)[name] = generator.createMeasure(
        def.field,
        def.aggregation
      )
    } else {
      (measures as Record<string, TypedMeasure<T>>)[name] = generator.createMeasure(
        null,
        def.aggregation
      )
    }
    ;(measures as Record<string, TypedMeasure<T>>)[name].name = name
  }

  // Build dimensions
  const dimensions = {} as { [K in keyof DInput]: TypedDimension<T> }
  for (const [name, def] of Object.entries(input.dimensions)) {
    (dimensions as Record<string, TypedDimension<T>>)[name] = generator.createDimension(
      def.field,
      {
        sql: def.sql,
        description: def.description,
        primaryKey: def.primaryKey,
      }
    )
    ;(dimensions as Record<string, TypedDimension<T>>)[name].name = name
  }

  return {
    name: contract.name,
    sql: input.sql,
    contract,
    measures,
    dimensions,
  }
}

/**
 * Create a type-safe query builder
 */
export function typedQuery<
  T,
  Measures extends Record<string, TypedMeasure<T>>,
  Dimensions extends Record<string, TypedDimension<T>>,
>(cube: TypedCube<T, Measures, Dimensions>): TypedQueryBuilder<T, Measures, Dimensions> {
  const state: {
    measures: string[]
    dimensions: string[]
    timeDimensions: Array<{
      dimension: string
      granularity: Granularity
      dateRange?: [string, string]
    }>
    filters: Array<{
      dimension: string
      operator: string
      values: string[]
    }>
  } = {
    measures: [],
    dimensions: [],
    timeDimensions: [],
    filters: [],
  }

  const builder: TypedQueryBuilder<T, Measures, Dimensions> = {
    select(...measures) {
      state.measures.push(...measures.map((m) => `${cube.name}.${String(m)}`))
      return builder
    },

    by(...dimensions) {
      state.dimensions.push(...dimensions.map((d) => `${cube.name}.${String(d)}`))
      return builder
    },

    byTime(dimension, granularity, dateRange) {
      state.timeDimensions.push({
        dimension: `${cube.name}.${String(dimension)}`,
        granularity,
        dateRange,
      })
      return builder
    },

    filter(dimension, operator, value) {
      const values = Array.isArray(value) ? value : [value]
      state.filters.push({
        dimension: `${cube.name}.${String(dimension)}`,
        operator,
        values,
      })
      return builder
    },

    build(): SemanticQuery {
      return {
        measures: state.measures.length > 0 ? state.measures : undefined,
        dimensions: state.dimensions.length > 0 ? state.dimensions : undefined,
        timeDimensions: state.timeDimensions.length > 0 ? state.timeDimensions : undefined,
        filters: state.filters.length > 0 ? state.filters : undefined,
      }
    },
  }

  return builder
}

/**
 * Generate Cube.js compatible schema from contract
 */
export function generateCubeSchema<T>(
  contract: ZodDataContract<T>,
  input: CubeSchemaInput<T>
): CubeDefinition {
  const generator = new SemanticTypeGenerator(contract)

  const measures: Record<string, MetricDefinition> = {}
  const dimensions: Record<string, DimensionDefinition> = {}

  // Generate measures
  for (const [name, def] of Object.entries(input.measures)) {
    if ('field' in def) {
      measures[name] = {
        type: def.aggregation as MetricType,
        sql: def.sql || generator['camelToSnake'](def.field),
      }
    } else {
      measures[name] = { type: 'count' }
    }
  }

  // Generate dimensions
  for (const [name, def] of Object.entries(input.dimensions)) {
    const type = generator.inferDimensionType(def.field)
    dimensions[name] = {
      type,
      sql: def.sql || generator['camelToSnake'](def.field),
      description: def.description,
      primaryKey: def.primaryKey,
    }
  }

  return {
    name: contract.name,
    sql: `SELECT * FROM ${contract.name}`,
    measures,
    dimensions,
  }
}

/**
 * Infer query result type definition
 */
export function inferQueryResult<
  T,
  Measures extends Record<string, TypedMeasure<T>>,
  Dimensions extends Record<string, TypedDimension<T>>,
>(
  cube: TypedCube<T, Measures, Dimensions>,
  query: {
    measures?: (keyof Measures)[]
    dimensions?: (keyof Dimensions)[]
  }
): TypeDefinitionResult {
  const lines: string[] = ['interface QueryResult {']
  const dimensionTypes: Record<string, string> = {}
  const measureTypes: Record<string, string> = {}

  // Add measure types
  if (query.measures) {
    for (const name of query.measures) {
      const measure = cube.measures[name]
      if (measure) {
        measureTypes[String(name)] = 'number'
        lines.push(`  ${String(name)}: number;`)
      }
    }
  }

  // Add dimension types
  if (query.dimensions) {
    for (const name of query.dimensions) {
      const dimension = cube.dimensions[name]
      if (dimension) {
        let tsType = 'string'
        if (dimension.type === 'number') {
          tsType = 'number'
        } else if (dimension.type === 'boolean') {
          tsType = 'boolean'
        }
        dimensionTypes[String(name)] = tsType
        lines.push(`  ${String(name)}: ${tsType};`)
      }
    }
  }

  lines.push('}')

  return {
    typescript: lines.join('\n'),
    dimensions: dimensionTypes,
    measures: measureTypes,
  }
}

/**
 * Validate a join path between contracts
 */
export function validateJoinPath(
  contracts: ZodDataContract<unknown>[],
  path: string[],
  joinDefinitions: JoinPath
): boolean {
  const validator = new JoinPathValidator()

  for (const contract of contracts) {
    const name = contract.name
    const joinKey = path.find((p, i) => p === name && i < path.length - 1)
    const nextCube = joinKey ? path[path.indexOf(joinKey) + 1] : undefined

    const joins: JoinConfig[] = []
    for (const [key, def] of Object.entries(joinDefinitions)) {
      const [from, to] = key.split('->')
      if (from === name && to) {
        joins.push({
          target: to,
          foreignKey: def.foreignKey,
          targetKey: def.targetKey,
          relationship: 'belongsTo',
        })
      }
    }

    validator.registerCube(name, contract, { joins })
  }

  const result = validator.validateJoinPath(path)
  return result.valid
}
