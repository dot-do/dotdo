/**
 * Schema Import/Export - LookML and Cube.js Schema Conversion
 *
 * Provides functionality to:
 * - Parse LookML files and convert to SemanticLayer schema
 * - Parse Cube.js schema files and convert
 * - Export SemanticLayer schema to LookML
 * - Export to Cube.js format
 * - Validation of imported schemas
 *
 * @see dotdo-mulms
 */

import type {
  MetricType,
  DimensionType,
  JoinRelationship,
  Granularity,
} from './index'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Error thrown when parsing LookML fails
 */
export class LookMLParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(message)
    this.name = 'LookMLParseError'
  }
}

/**
 * Error thrown when parsing Cube.js fails
 */
export class CubeJSParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(message)
    this.name = 'CubeJSParseError'
  }
}

/**
 * Error thrown when schema validation fails
 */
export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

// =============================================================================
// TYPE DEFINITIONS - LookML
// =============================================================================

export interface LookMLDimension {
  name: string
  type: string
  sql?: string
  primaryKey?: boolean
  description?: string
  hidden?: boolean
  label?: string
  requiredAccessGrants?: string[]
}

export interface LookMLDimensionGroup {
  name: string
  type: string
  timeframes?: string[]
  sql?: string
  description?: string
}

export interface LookMLMeasure {
  name: string
  type: string
  sql?: string
  description?: string
  filters?: Array<{ field: string; value: string }>
  drillFields?: string[]
  requiredAccessGrants?: string[]
}

export interface LookMLSet {
  name: string
  fields: string[]
}

export interface LookMLParameter {
  name: string
  type: string
  allowedValues?: string[]
  defaultValue?: string
}

export interface LookMLDerivedTable {
  sql?: string
  persistStrategy?: string
  indexes?: string[]
}

export interface LookMLJoin {
  name: string
  type?: string
  relationship?: string
  sqlOn?: string
  from?: string
}

export interface LookMLView {
  name: string
  sqlTableName?: string
  derivedTable?: LookMLDerivedTable
  dimensions: LookMLDimension[]
  dimensionGroups: LookMLDimensionGroup[]
  measures: LookMLMeasure[]
  sets: LookMLSet[]
  parameters: LookMLParameter[]
}

export interface LookMLExplore {
  name: string
  from?: string
  joins: LookMLJoin[]
  description?: string
}

export interface LookMLAccessGrant {
  name: string
  userAttribute: string
  allowedValues: string[]
}

export interface LookMLModel {
  views: LookMLView[]
  explores: LookMLExplore[]
  connection?: string
  includes: string[]
  accessGrants: LookMLAccessGrant[]

  toSemanticLayer(): ImportedSchema
}

// =============================================================================
// TYPE DEFINITIONS - Cube.js
// =============================================================================

export interface CubeJSMeasure {
  type: string
  sql?: string
  description?: string
  drillMembers?: string[]
  filters?: Array<{ sql: string }>
  format?: string
}

export interface CubeJSDimension {
  type: string
  sql: string
  primaryKey?: boolean
  description?: string
  shown?: boolean
}

export interface CubeJSJoin {
  relationship: string
  sql: string
}

export interface CubeJSSegment {
  sql: string
}

export interface CubeJSPreAggregation {
  measures?: string[]
  dimensions?: string[]
  timeDimension?: string
  granularity?: string
  refreshKey?: { every?: string; sql?: string }
}

export interface CubeJSContextMember {
  sql: string
}

export interface CubeJSCube {
  name: string
  sql: string
  measures: Record<string, CubeJSMeasure>
  dimensions: Record<string, CubeJSDimension>
  joins?: Record<string, CubeJSJoin>
  segments?: Record<string, CubeJSSegment>
  preAggregations?: Record<string, CubeJSPreAggregation>
  refreshKey?: { every?: string; sql?: string }
  extends?: string
  dataSource?: string
  contextMembers?: Record<string, CubeJSContextMember>
}

export interface CubeJSSchema {
  cubes: CubeJSCube[]

  toSemanticLayer(): ImportedSchema
}

// =============================================================================
// TYPE DEFINITIONS - Imported Schema (SemanticLayer Compatible)
// =============================================================================

export interface ImportedMeasure {
  type: MetricType
  sql?: string
  description?: string
  format?: string
  drillMembers?: string[]
  filters?: Array<{ sql: string }>
}

export interface ImportedDimension {
  type: DimensionType
  sql: string
  primaryKey?: boolean
  description?: string
}

export interface ImportedJoin {
  name: string
  relationship: JoinRelationship
  sql: string
}

export interface ImportedSegment {
  sql: string
}

export interface ImportedPreAggregation {
  name: string
  measures: string[]
  dimensions: string[]
  timeDimension?: string
  granularity?: Granularity
  refreshKey?: { every?: string; sql?: string }
}

export interface ImportedCube {
  name: string
  sql: string
  measures: Record<string, ImportedMeasure>
  dimensions: Record<string, ImportedDimension>
  joins?: ImportedJoin[]
  segments?: Record<string, ImportedSegment>
  preAggregations?: ImportedPreAggregation[]
  refreshKey?: { every?: string; sql?: string }
  dataSource?: string
}

export interface ImportedSchema {
  cubes: ImportedCube[]
}

export interface ValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
}

// =============================================================================
// LOOKML PARSER - Regex-based approach for better handling of SQL blocks
// =============================================================================

/**
 * Parse LookML content using regex patterns
 */
export function parseLookML(content: string): LookMLModel {
  const views: LookMLView[] = []
  const explores: LookMLExplore[] = []
  const accessGrants: LookMLAccessGrant[] = []
  let connection: string | undefined
  const includes: string[] = []

  // Remove comments
  const cleanContent = content.replace(/#[^\n]*/g, '')

  // Parse connection
  const connectionMatch = cleanContent.match(/connection\s*:\s*"([^"]+)"/)
  if (connectionMatch) {
    connection = connectionMatch[1]
  }

  // Parse includes
  const includeRegex = /include\s*:\s*"([^"]+)"/g
  let includeMatch
  while ((includeMatch = includeRegex.exec(cleanContent)) !== null) {
    includes.push(includeMatch[1])
  }

  // Parse access_grants
  const accessGrantRegex = /access_grant\s*:\s*(\w+)\s*\{([^}]+)\}/g
  let agMatch
  while ((agMatch = accessGrantRegex.exec(cleanContent)) !== null) {
    const name = agMatch[1]
    const body = agMatch[2]

    const userAttrMatch = body.match(/user_attribute\s*:\s*(\w+)/)
    const allowedMatch = body.match(/allowed_values\s*:\s*\[([^\]]+)\]/)

    accessGrants.push({
      name,
      userAttribute: userAttrMatch ? userAttrMatch[1] : '',
      allowedValues: allowedMatch
        ? allowedMatch[1].split(',').map((s) => s.trim().replace(/"/g, ''))
        : [],
    })
  }

  // Parse views - need to handle nested braces
  const viewBlocks = extractBlocks(cleanContent, 'view')
  for (const viewBlock of viewBlocks) {
    const view = parseViewBlock(viewBlock.name, viewBlock.body)
    views.push(view)
  }

  // Parse explores
  const exploreBlocks = extractBlocks(cleanContent, 'explore')
  for (const exploreBlock of exploreBlocks) {
    const explore = parseExploreBlock(exploreBlock.name, exploreBlock.body)
    explores.push(explore)
  }

  return {
    views,
    explores,
    connection,
    includes,
    accessGrants,
    toSemanticLayer: () => convertLookMLToSemanticLayer(views, explores),
  }
}

interface BlockMatch {
  name: string
  body: string
}

function extractBlocks(content: string, blockType: string): BlockMatch[] {
  const blocks: BlockMatch[] = []
  const regex = new RegExp(`${blockType}\\s*:\\s*(\\w+)\\s*\\{`, 'g')
  let match

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const startIdx = match.index + match[0].length

    // Find matching closing brace
    let depth = 1
    let endIdx = startIdx

    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === '{') depth++
      if (content[endIdx] === '}') depth--
      endIdx++
    }

    const body = content.substring(startIdx, endIdx - 1)
    blocks.push({ name, body })
  }

  return blocks
}

function parseViewBlock(name: string, body: string): LookMLView {
  const view: LookMLView = {
    name,
    dimensions: [],
    dimensionGroups: [],
    measures: [],
    sets: [],
    parameters: [],
  }

  // Parse sql_table_name
  const sqlTableMatch = body.match(/sql_table_name\s*:\s*([^;]+);;/)
  if (sqlTableMatch) {
    view.sqlTableName = sqlTableMatch[1].trim()
  }

  // Parse derived_table (special case - no name after colon)
  const derivedTableMatch = body.match(/derived_table\s*:\s*\{/)
  if (derivedTableMatch) {
    const startIdx = derivedTableMatch.index! + derivedTableMatch[0].length
    let depth = 1
    let endIdx = startIdx

    while (depth > 0 && endIdx < body.length) {
      if (body[endIdx] === '{') depth++
      if (body[endIdx] === '}') depth--
      endIdx++
    }

    const dtBody = body.substring(startIdx, endIdx - 1)
    const sqlMatch = dtBody.match(/sql\s*:\s*([\s\S]+?);;/)
    view.derivedTable = {
      sql: sqlMatch ? sqlMatch[1].trim() : undefined,
    }
  }

  // Parse dimensions
  const dimBlocks = extractBlocks(body, 'dimension')
  for (const dimBlock of dimBlocks) {
    view.dimensions.push(parseDimensionBlock(dimBlock.name, dimBlock.body))
  }

  // Parse dimension_groups
  const dimGroupBlocks = extractBlocks(body, 'dimension_group')
  for (const dgBlock of dimGroupBlocks) {
    view.dimensionGroups.push(parseDimensionGroupBlock(dgBlock.name, dgBlock.body))
  }

  // Parse measures
  const measureBlocks = extractBlocks(body, 'measure')
  for (const measureBlock of measureBlocks) {
    view.measures.push(parseMeasureBlock(measureBlock.name, measureBlock.body))
  }

  // Parse sets
  const setBlocks = extractBlocks(body, 'set')
  for (const setBlock of setBlocks) {
    view.sets.push(parseSetBlock(setBlock.name, setBlock.body))
  }

  // Parse parameters
  const paramBlocks = extractBlocks(body, 'parameter')
  for (const paramBlock of paramBlocks) {
    view.parameters.push(parseParameterBlock(paramBlock.name, paramBlock.body))
  }

  return view
}

function parseDimensionBlock(name: string, body: string): LookMLDimension {
  const dim: LookMLDimension = { name, type: 'string' }

  const typeMatch = body.match(/type\s*:\s*(\w+)/)
  if (typeMatch) dim.type = typeMatch[1]

  const sqlMatch = body.match(/sql\s*:\s*([^;]+);;/)
  if (sqlMatch) dim.sql = sqlMatch[1].trim()

  const pkMatch = body.match(/primary_key\s*:\s*(yes|no)/)
  if (pkMatch) dim.primaryKey = pkMatch[1] === 'yes'

  const descMatch = body.match(/description\s*:\s*"([^"]*)"/)
  if (descMatch) dim.description = descMatch[1]

  const hiddenMatch = body.match(/hidden\s*:\s*(yes|no)/)
  if (hiddenMatch) dim.hidden = hiddenMatch[1] === 'yes'

  const labelMatch = body.match(/label\s*:\s*"([^"]*)"/)
  if (labelMatch) dim.label = labelMatch[1]

  const ragMatch = body.match(/required_access_grants\s*:\s*\[([^\]]+)\]/)
  if (ragMatch) {
    dim.requiredAccessGrants = ragMatch[1].split(',').map((s) => s.trim())
  }

  return dim
}

function parseDimensionGroupBlock(name: string, body: string): LookMLDimensionGroup {
  const group: LookMLDimensionGroup = { name, type: 'time' }

  const typeMatch = body.match(/type\s*:\s*(\w+)/)
  if (typeMatch) group.type = typeMatch[1]

  const sqlMatch = body.match(/sql\s*:\s*([^;]+);;/)
  if (sqlMatch) group.sql = sqlMatch[1].trim()

  const timeframesMatch = body.match(/timeframes\s*:\s*\[([^\]]+)\]/)
  if (timeframesMatch) {
    group.timeframes = timeframesMatch[1].split(',').map((s) => s.trim())
  }

  const descMatch = body.match(/description\s*:\s*"([^"]*)"/)
  if (descMatch) group.description = descMatch[1]

  return group
}

function parseMeasureBlock(name: string, body: string): LookMLMeasure {
  const measure: LookMLMeasure = { name, type: 'count' }

  const typeMatch = body.match(/type\s*:\s*(\w+)/)
  if (typeMatch) measure.type = typeMatch[1]

  const sqlMatch = body.match(/sql\s*:\s*([^;]+);;/)
  if (sqlMatch) measure.sql = sqlMatch[1].trim()

  const descMatch = body.match(/description\s*:\s*"([^"]*)"/)
  if (descMatch) measure.description = descMatch[1]

  // Parse filters: [field: "value"] format
  const filtersMatch = body.match(/filters\s*:\s*\[([^\]]+)\]/)
  if (filtersMatch) {
    const filterStr = filtersMatch[1]
    const filterPairs = filterStr.match(/(\w+)\s*:\s*"([^"]+)"/g)
    if (filterPairs) {
      measure.filters = filterPairs.map((pair) => {
        const m = pair.match(/(\w+)\s*:\s*"([^"]+)"/)
        return { field: m![1], value: m![2] }
      })
    }
  }

  const drillMatch = body.match(/drill_fields\s*:\s*\[([^\]]+)\]/)
  if (drillMatch) {
    measure.drillFields = drillMatch[1].split(',').map((s) => s.trim())
  }

  const ragMatch = body.match(/required_access_grants\s*:\s*\[([^\]]+)\]/)
  if (ragMatch) {
    measure.requiredAccessGrants = ragMatch[1].split(',').map((s) => s.trim())
  }

  return measure
}

function parseSetBlock(name: string, body: string): LookMLSet {
  const set: LookMLSet = { name, fields: [] }

  const fieldsMatch = body.match(/fields\s*:\s*\[([^\]]+)\]/)
  if (fieldsMatch) {
    set.fields = fieldsMatch[1].split(',').map((s) => s.trim())
  }

  return set
}

function parseParameterBlock(name: string, body: string): LookMLParameter {
  const param: LookMLParameter = { name, type: 'string' }

  const typeMatch = body.match(/type\s*:\s*(\w+)/)
  if (typeMatch) param.type = typeMatch[1]

  const allowedMatch = body.match(/allowed_values\s*:\s*\[([^\]]+)\]/)
  if (allowedMatch) {
    param.allowedValues = allowedMatch[1].split(',').map((s) => s.trim())
  }

  const defaultMatch = body.match(/default_value\s*:\s*"([^"]*)"/)
  if (defaultMatch) param.defaultValue = defaultMatch[1]

  return param
}

function parseExploreBlock(name: string, body: string): LookMLExplore {
  const explore: LookMLExplore = { name, joins: [] }

  const fromMatch = body.match(/from\s*:\s*(\w+)/)
  if (fromMatch) explore.from = fromMatch[1]

  const descMatch = body.match(/description\s*:\s*"([^"]*)"/)
  if (descMatch) explore.description = descMatch[1]

  // Parse joins
  const joinBlocks = extractBlocks(body, 'join')
  for (const joinBlock of joinBlocks) {
    explore.joins.push(parseJoinBlock(joinBlock.name, joinBlock.body))
  }

  return explore
}

function parseJoinBlock(name: string, body: string): LookMLJoin {
  const join: LookMLJoin = { name }

  const typeMatch = body.match(/type\s*:\s*(\w+)/)
  if (typeMatch) join.type = typeMatch[1]

  const relMatch = body.match(/relationship\s*:\s*(\w+)/)
  if (relMatch) join.relationship = relMatch[1]

  const sqlOnMatch = body.match(/sql_on\s*:\s*([^;]+);;/)
  if (sqlOnMatch) join.sqlOn = sqlOnMatch[1].trim()

  const fromMatch = body.match(/from\s*:\s*(\w+)/)
  if (fromMatch) join.from = fromMatch[1]

  return join
}

function convertLookMLToSemanticLayer(
  views: LookMLView[],
  explores: LookMLExplore[]
): ImportedSchema {
  const cubes: ImportedCube[] = []

  for (const view of views) {
    const cube: ImportedCube = {
      name: view.name,
      sql: getSqlForView(view),
      measures: {},
      dimensions: {},
    }

    // Convert dimensions
    for (const dim of view.dimensions) {
      cube.dimensions[dim.name] = {
        type: mapLookMLDimensionType(dim.type),
        sql: cleanSql(dim.sql || dim.name),
        primaryKey: dim.primaryKey,
        description: dim.description,
      }
    }

    // Convert dimension groups (time dimensions)
    for (const group of view.dimensionGroups) {
      cube.dimensions[group.name] = {
        type: 'time',
        sql: cleanSql(group.sql || group.name),
        description: group.description,
      }
    }

    // Convert measures
    for (const measure of view.measures) {
      cube.measures[measure.name] = {
        type: mapLookMLMeasureType(measure.type),
        sql: measure.sql ? cleanSql(measure.sql) : undefined,
        description: measure.description,
        drillMembers: measure.drillFields,
      }
    }

    // Find joins from explores
    const explore = explores.find((e) => e.name === view.name)
    if (explore && explore.joins.length > 0) {
      cube.joins = explore.joins.map((j) => ({
        name: j.name,
        relationship: mapLookMLRelationship(j.relationship),
        sql: cleanSql(j.sqlOn || ''),
      }))
    }

    cubes.push(cube)
  }

  return { cubes }
}

function getSqlForView(view: LookMLView): string {
  if (view.derivedTable?.sql) {
    return view.derivedTable.sql
  }
  if (view.sqlTableName) {
    return `SELECT * FROM ${view.sqlTableName}`
  }
  return `SELECT * FROM ${view.name}`
}

function cleanSql(sql: string): string {
  // Remove ${TABLE}. prefix
  return sql.replace(/\$\{TABLE\}\./g, '')
}

function mapLookMLDimensionType(type: string): DimensionType {
  switch (type.toLowerCase()) {
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'yesno':
      return 'boolean'
    case 'time':
    case 'date':
    case 'datetime':
      return 'time'
    case 'location':
      return 'geo'
    default:
      return 'string'
  }
}

function mapLookMLMeasureType(type: string): MetricType {
  switch (type.toLowerCase()) {
    case 'count':
      return 'count'
    case 'sum':
      return 'sum'
    case 'average':
    case 'avg':
      return 'avg'
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'count_distinct':
      return 'countDistinct'
    default:
      return 'custom'
  }
}

function mapLookMLRelationship(relationship?: string): JoinRelationship {
  switch (relationship?.toLowerCase()) {
    case 'many_to_one':
      return 'belongsTo'
    case 'one_to_many':
      return 'hasMany'
    case 'one_to_one':
      return 'hasOne'
    case 'many_to_many':
      return 'manyToMany'
    default:
      return 'belongsTo'
  }
}

// =============================================================================
// LOOKML EXPORTER
// =============================================================================

/**
 * Export SemanticLayer schema to LookML format
 */
export function exportToLookML(schema: ImportedSchema): string {
  const lines: string[] = []

  for (const cube of schema.cubes) {
    lines.push(`view: ${cube.name} {`)

    // Add SQL table name or derived table
    if (cube.sql.toLowerCase().startsWith('select * from ')) {
      const tableName = cube.sql.substring(14).trim()
      lines.push(`  sql_table_name: ${tableName} ;;`)
    } else {
      lines.push(`  derived_table: {`)
      lines.push(`    sql:`)
      lines.push(`      ${cube.sql} ;;`)
      lines.push(`  }`)
    }

    lines.push('')

    // Export dimensions
    for (const [name, dim] of Object.entries(cube.dimensions)) {
      if (dim.type === 'time') {
        lines.push(`  dimension_group: ${name} {`)
        lines.push(`    type: time`)
        lines.push(`    timeframes: [date, week, month, quarter, year]`)
        lines.push(`    sql: \${TABLE}.${dim.sql} ;;`)
        if (dim.description) {
          lines.push(`    description: "${dim.description}"`)
        }
        lines.push(`  }`)
      } else {
        lines.push(`  dimension: ${name} {`)
        lines.push(`    type: ${mapSemanticToDimensionType(dim.type)}`)
        lines.push(`    sql: \${TABLE}.${dim.sql} ;;`)
        if (dim.primaryKey) {
          lines.push(`    primary_key: yes`)
        }
        if (dim.description) {
          lines.push(`    description: "${dim.description}"`)
        }
        lines.push(`  }`)
      }
      lines.push('')
    }

    // Export measures
    for (const [name, measure] of Object.entries(cube.measures)) {
      lines.push(`  measure: ${name} {`)
      lines.push(`    type: ${mapSemanticToMeasureType(measure.type)}`)
      if (measure.sql) {
        lines.push(`    sql: \${TABLE}.${measure.sql} ;;`)
      }
      if (measure.description) {
        lines.push(`    description: "${measure.description}"`)
      }
      lines.push(`  }`)
      lines.push('')
    }

    // Export segments as yesno dimensions
    if (cube.segments) {
      for (const [name, segment] of Object.entries(cube.segments)) {
        lines.push(`  dimension: is_${name} {`)
        lines.push(`    type: yesno`)
        lines.push(`    sql: ${segment.sql} ;;`)
        lines.push(`  }`)
        lines.push('')
      }
    }

    lines.push('}')
    lines.push('')

    // Export joins as explore
    if (cube.joins && cube.joins.length > 0) {
      lines.push(`explore: ${cube.name} {`)
      for (const join of cube.joins) {
        lines.push(`  join: ${join.name} {`)
        lines.push(`    relationship: ${mapSemanticToRelationship(join.relationship)}`)
        lines.push(`    sql_on: ${join.sql} ;;`)
        lines.push(`  }`)
      }
      lines.push('}')
      lines.push('')
    }
  }

  return lines.join('\n')
}

function mapSemanticToDimensionType(type: DimensionType): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'boolean':
      return 'yesno'
    case 'time':
      return 'time'
    case 'geo':
      return 'location'
    default:
      return 'string'
  }
}

function mapSemanticToMeasureType(type: MetricType): string {
  switch (type) {
    case 'count':
      return 'count'
    case 'sum':
      return 'sum'
    case 'avg':
      return 'average'
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'countDistinct':
      return 'count_distinct'
    default:
      return 'number'
  }
}

function mapSemanticToRelationship(relationship: JoinRelationship): string {
  switch (relationship) {
    case 'belongsTo':
      return 'many_to_one'
    case 'hasMany':
      return 'one_to_many'
    case 'hasOne':
      return 'one_to_one'
    case 'manyToMany':
      return 'many_to_many'
    default:
      return 'many_to_one'
  }
}

// =============================================================================
// CUBE.JS PARSER
// =============================================================================

/**
 * Parse Cube.js schema content
 */
export function parseCubeJS(content: string): CubeJSSchema {
  try {
    const cubes: CubeJSCube[] = []

    // Extract cube definitions - handle multiline with nested braces
    const cubeStarts = findAllCubeStarts(content)

    for (const start of cubeStarts) {
      const name = start.name
      const bodyStart = start.bodyStart

      // Find matching closing brace
      let depth = 1
      let pos = bodyStart
      while (depth > 0 && pos < content.length) {
        const char = content[pos]
        if (char === '{') depth++
        if (char === '}') depth--
        pos++
      }

      const bodyStr = content.substring(bodyStart, pos - 1)

      try {
        const cube = parseCubeBody(name, bodyStr)
        cubes.push(cube)
      } catch (error) {
        throw new CubeJSParseError(
          `Failed to parse cube '${name}': ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    if (cubes.length === 0) {
      throw new CubeJSParseError('No valid cube definitions found')
    }

    return {
      cubes,
      toSemanticLayer: () => convertCubeJSToSemanticLayer(cubes),
    }
  } catch (error) {
    if (error instanceof CubeJSParseError) {
      throw error
    }
    throw new CubeJSParseError(
      `Failed to parse Cube.js schema: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function findAllCubeStarts(content: string): Array<{ name: string; bodyStart: number }> {
  const results: Array<{ name: string; bodyStart: number }> = []
  const regex = /cube\s*\(\s*['"](\w+)['"]\s*,\s*\{/g
  let match

  while ((match = regex.exec(content)) !== null) {
    results.push({
      name: match[1],
      bodyStart: match.index + match[0].length,
    })
  }

  return results
}

function parseCubeBody(name: string, bodyStr: string): CubeJSCube {
  const cube: CubeJSCube = {
    name,
    sql: '',
    measures: {},
    dimensions: {},
  }

  // Extract SQL - handle both template literals and arrow functions
  const sqlTemplateMatch = bodyStr.match(/sql\s*:\s*`([^`]*)`/)
  const sqlArrowMatch = bodyStr.match(/sql\s*:\s*\(\)\s*=>\s*`([^`]*)`/)
  const sqlStringMatch = bodyStr.match(/sql\s*:\s*['"]([^'"]+)['"]/)

  // Extract sqlTable - shorthand for sql: SELECT * FROM table
  const sqlTableTemplateMatch = bodyStr.match(/sqlTable\s*:\s*`([^`]*)`/)
  const sqlTableStringMatch = bodyStr.match(/sqlTable\s*:\s*['"]([^'"]+)['"]/)

  if (sqlArrowMatch) {
    cube.sql = sqlArrowMatch[1]
  } else if (sqlTemplateMatch) {
    cube.sql = sqlTemplateMatch[1]
  } else if (sqlStringMatch) {
    cube.sql = sqlStringMatch[1]
  } else if (sqlTableTemplateMatch) {
    cube.sql = `SELECT * FROM ${sqlTableTemplateMatch[1]}`
  } else if (sqlTableStringMatch) {
    cube.sql = `SELECT * FROM ${sqlTableStringMatch[1]}`
  }

  // Extract measures block
  const measuresBlock = extractObjectBlock(bodyStr, 'measures')
  if (measuresBlock) {
    cube.measures = parseCubeMeasures(measuresBlock)
  }

  // Extract dimensions block
  const dimensionsBlock = extractObjectBlock(bodyStr, 'dimensions')
  if (dimensionsBlock) {
    cube.dimensions = parseCubeDimensions(dimensionsBlock)
  }

  // Extract joins block
  const joinsBlock = extractObjectBlock(bodyStr, 'joins')
  if (joinsBlock) {
    cube.joins = parseCubeJoins(joinsBlock)
  }

  // Extract segments block
  const segmentsBlock = extractObjectBlock(bodyStr, 'segments')
  if (segmentsBlock) {
    cube.segments = parseCubeSegments(segmentsBlock)
  }

  // Extract preAggregations block
  const preAggBlock = extractObjectBlock(bodyStr, 'preAggregations')
  if (preAggBlock) {
    cube.preAggregations = parseCubePreAggregations(preAggBlock)
  }

  // Extract refreshKey - use extractObjectBlock to handle nested content with backticks
  const refreshKeyBlock = extractObjectBlock(bodyStr, 'refreshKey')
  if (refreshKeyBlock) {
    cube.refreshKey = {}
    const everyMatch = refreshKeyBlock.match(/every\s*:\s*['"]([^'"]+)['"]/)
    if (everyMatch) cube.refreshKey.every = everyMatch[1]
    const sqlMatch = refreshKeyBlock.match(/sql\s*:\s*`([^`]*)`)
    if (sqlMatch) cube.refreshKey.sql = sqlMatch[1]
  }

  // Extract extends
  const extendsMatch = bodyStr.match(/extends\s*:\s*(\w+)/)
  if (extendsMatch) {
    cube.extends = extendsMatch[1]
  }

  // Extract dataSource
  const dataSourceMatch = bodyStr.match(/dataSource\s*:\s*['"]([^'"]+)['"]/)
  if (dataSourceMatch) {
    cube.dataSource = dataSourceMatch[1]
  }

  // Extract contextMembers
  const contextBlock = extractObjectBlock(bodyStr, 'contextMembers')
  if (contextBlock) {
    cube.contextMembers = parseCubeContextMembers(contextBlock)
  }

  return cube
}

function extractObjectBlock(content: string, key: string): string | null {
  const regex = new RegExp(`${key}\\s*:\\s*\\{`)
  const match = regex.exec(content)
  if (!match) return null

  const startIdx = match.index + match[0].length
  let depth = 1
  let pos = startIdx

  while (depth > 0 && pos < content.length) {
    const char = content[pos]
    if (char === '{') depth++
    if (char === '}') depth--
    pos++
  }

  return content.substring(startIdx, pos - 1)
}

function extractArrayOfObjects(content: string, key: string): string[] {
  const regex = new RegExp(`${key}\\s*:\\s*\\[`)
  const match = regex.exec(content)
  if (!match) return []

  const startIdx = match.index + match[0].length
  let depth = 1
  let pos = startIdx

  // Find the matching closing bracket
  while (depth > 0 && pos < content.length) {
    const char = content[pos]
    if (char === '[') depth++
    if (char === ']') depth--
    pos++
  }

  const arrayContent = content.substring(startIdx, pos - 1)

  // Now extract individual objects from within the array
  const objects: string[] = []
  const objRegex = /\{/g
  let objMatch

  while ((objMatch = objRegex.exec(arrayContent)) !== null) {
    const objStart = objMatch.index + 1
    let objDepth = 1
    let objPos = objStart

    while (objDepth > 0 && objPos < arrayContent.length) {
      const char = arrayContent[objPos]
      if (char === '{') objDepth++
      if (char === '}') objDepth--
      objPos++
    }

    objects.push(arrayContent.substring(objStart, objPos - 1))
  }

  return objects
}

function parseCubeMeasures(block: string): Record<string, CubeJSMeasure> {
  const measures: Record<string, CubeJSMeasure> = {}

  // Find each measure definition
  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const measure: CubeJSMeasure = { type: 'count' }

    const typeMatch = memberBody.match(/type\s*:\s*['"]?(\w+)['"]?/)
    if (typeMatch) measure.type = typeMatch[1]

    const sqlMatch = memberBody.match(/sql\s*:\s*(?:`([^`]*)`|['"]([^'"]*)['"])/)
    if (sqlMatch) measure.sql = sqlMatch[1] || sqlMatch[2]

    const descMatch = memberBody.match(/description\s*:\s*['"]([^'"]*)['"]/i)
    if (descMatch) measure.description = descMatch[1]

    const formatMatch = memberBody.match(/format\s*:\s*['"](\w+)['"]/)
    if (formatMatch) measure.format = formatMatch[1]

    const drillMatch = memberBody.match(/drillMembers\s*:\s*\[([^\]]*)\]/)
    if (drillMatch) {
      measure.drillMembers = drillMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }

    // Parse filters array
    const filtersBlock = extractArrayOfObjects(memberBody, 'filters')
    if (filtersBlock.length > 0) {
      measure.filters = filtersBlock.map((filterBody) => {
        const filterSqlMatch = filterBody.match(/sql\s*:\s*`([^`]*)`/)
        return { sql: filterSqlMatch ? filterSqlMatch[1] : '' }
      })
    }

    measures[name] = measure
  }

  return measures
}

function parseCubeDimensions(block: string): Record<string, CubeJSDimension> {
  const dimensions: Record<string, CubeJSDimension> = {}

  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const dim: CubeJSDimension = { type: 'string', sql: name }

    const typeMatch = memberBody.match(/type\s*:\s*['"]?(\w+)['"]?/)
    if (typeMatch) dim.type = typeMatch[1]

    const sqlMatch = memberBody.match(/sql\s*:\s*(?:`([^`]*)`|['"]([^'"]*)['"])/)
    if (sqlMatch) dim.sql = sqlMatch[1] || sqlMatch[2] || name

    const pkMatch = memberBody.match(/primaryKey\s*:\s*(true|false)/)
    if (pkMatch) dim.primaryKey = pkMatch[1] === 'true'

    const descMatch = memberBody.match(/description\s*:\s*['"]([^'"]*)['"]/i)
    if (descMatch) dim.description = descMatch[1]

    dimensions[name] = dim
  }

  return dimensions
}

function parseCubeJoins(block: string): Record<string, CubeJSJoin> {
  const joins: Record<string, CubeJSJoin> = {}

  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const join: CubeJSJoin = { relationship: 'belongsTo', sql: '' }

    const relMatch = memberBody.match(/relationship\s*:\s*['"](\w+)['"]/)
    if (relMatch) join.relationship = relMatch[1]

    const sqlMatch = memberBody.match(/sql\s*:\s*`([^`]*)`/)
    if (sqlMatch) join.sql = sqlMatch[1]

    joins[name] = join
  }

  return joins
}

function parseCubeSegments(block: string): Record<string, CubeJSSegment> {
  const segments: Record<string, CubeJSSegment> = {}

  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const segment: CubeJSSegment = { sql: '' }

    const sqlMatch = memberBody.match(/sql\s*:\s*`([^`]*)`/)
    if (sqlMatch) segment.sql = sqlMatch[1]

    segments[name] = segment
  }

  return segments
}

function parseCubePreAggregations(block: string): Record<string, CubeJSPreAggregation> {
  const preAggs: Record<string, CubeJSPreAggregation> = {}

  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const pa: CubeJSPreAggregation = {}

    const measuresMatch = memberBody.match(/measures\s*:\s*\[([^\]]*)\]/)
    if (measuresMatch) {
      pa.measures = measuresMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }

    const dimsMatch = memberBody.match(/dimensions\s*:\s*\[([^\]]*)\]/)
    if (dimsMatch) {
      pa.dimensions = dimsMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }

    const timeDimMatch = memberBody.match(/timeDimension\s*:\s*(\w+)/)
    if (timeDimMatch) pa.timeDimension = timeDimMatch[1]

    const granMatch = memberBody.match(/granularity\s*:\s*['"]?(\w+)['"]?/)
    if (granMatch) pa.granularity = granMatch[1]

    // Parse refreshKey
    const refreshKeyBlock = extractObjectBlock(memberBody, 'refreshKey')
    if (refreshKeyBlock) {
      pa.refreshKey = {}
      const everyMatch = refreshKeyBlock.match(/every\s*:\s*['"]([^'"]+)['"]/)
      if (everyMatch) pa.refreshKey.every = everyMatch[1]
      const sqlMatch = refreshKeyBlock.match(/sql\s*:\s*`([^`]*)`/)
      if (sqlMatch) pa.refreshKey.sql = sqlMatch[1]
    }

    preAggs[name] = pa
  }

  return preAggs
}

function parseCubeContextMembers(block: string): Record<string, CubeJSContextMember> {
  const context: Record<string, CubeJSContextMember> = {}

  const memberBlocks = extractMemberBlocks(block)

  for (const [name, memberBody] of memberBlocks) {
    const cm: CubeJSContextMember = { sql: '' }

    const sqlMatch = memberBody.match(/sql\s*:\s*(?:`([^`]*)`|['"]([^'"]*)['"])/)
    if (sqlMatch) cm.sql = sqlMatch[1] || sqlMatch[2] || ''

    context[name] = cm
  }

  return context
}

function extractMemberBlocks(content: string): Array<[string, string]> {
  const blocks: Array<[string, string]> = []

  // Match member definitions: memberName: { ... }
  const regex = /(\w+)\s*:\s*\{/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const startIdx = match.index + match[0].length

    // Find matching closing brace
    let depth = 1
    let pos = startIdx

    while (depth > 0 && pos < content.length) {
      const char = content[pos]
      if (char === '{') depth++
      if (char === '}') depth--
      pos++
    }

    const body = content.substring(startIdx, pos - 1)
    blocks.push([name, body])
  }

  return blocks
}

function convertCubeJSToSemanticLayer(cubes: CubeJSCube[]): ImportedSchema {
  return {
    cubes: cubes.map((cube) => ({
      name: cube.name,
      sql: cube.sql,
      measures: Object.fromEntries(
        Object.entries(cube.measures).map(([name, m]) => [
          name,
          {
            type: mapCubeJSMeasureType(m.type),
            sql: m.sql,
            description: m.description,
            drillMembers: m.drillMembers,
          },
        ])
      ),
      dimensions: Object.fromEntries(
        Object.entries(cube.dimensions).map(([name, d]) => [
          name,
          {
            type: mapCubeJSDimensionType(d.type),
            sql: d.sql,
            primaryKey: d.primaryKey,
            description: d.description,
          },
        ])
      ),
      joins: cube.joins
        ? Object.entries(cube.joins).map(([name, j]) => ({
            name,
            relationship: j.relationship as JoinRelationship,
            sql: j.sql,
          }))
        : undefined,
      segments: cube.segments
        ? Object.fromEntries(
            Object.entries(cube.segments).map(([name, s]) => [name, { sql: s.sql }])
          )
        : undefined,
      preAggregations: cube.preAggregations
        ? Object.entries(cube.preAggregations).map(([name, pa]) => ({
            name,
            measures: pa.measures || [],
            dimensions: pa.dimensions || [],
            timeDimension: pa.timeDimension,
            granularity: pa.granularity as Granularity | undefined,
            refreshKey: pa.refreshKey,
          }))
        : undefined,
      refreshKey: cube.refreshKey,
      dataSource: cube.dataSource,
    })),
  }
}

function mapCubeJSMeasureType(type: string): MetricType {
  switch (type) {
    case 'count':
      return 'count'
    case 'sum':
      return 'sum'
    case 'avg':
      return 'avg'
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'countDistinct':
    case 'count_distinct':
      return 'countDistinct'
    default:
      return 'custom'
  }
}

function mapCubeJSDimensionType(type: string): DimensionType {
  switch (type) {
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'boolean':
      return 'boolean'
    case 'time':
      return 'time'
    case 'geo':
      return 'geo'
    default:
      return 'string'
  }
}

// =============================================================================
// CUBE.JS EXPORTER
// =============================================================================

/**
 * Export SemanticLayer schema to Cube.js format
 */
export function exportToCubeJS(schema: ImportedSchema): string {
  const lines: string[] = []

  for (const cube of schema.cubes) {
    lines.push(`cube('${cube.name}', {`)
    lines.push(`  sql: \`${cube.sql}\`,`)
    lines.push('')

    // Export measures
    if (Object.keys(cube.measures).length > 0) {
      lines.push('  measures: {')
      const measureEntries = Object.entries(cube.measures)
      measureEntries.forEach(([name, measure], index) => {
        lines.push(`    ${name}: {`)
        lines.push(`      type: '${measure.type}',`)
        if (measure.sql) {
          lines.push(`      sql: '${measure.sql}',`)
        }
        if (measure.description) {
          lines.push(`      description: '${measure.description}',`)
        }
        if (measure.drillMembers && measure.drillMembers.length > 0) {
          lines.push(`      drillMembers: [${measure.drillMembers.join(', ')}],`)
        }
        lines.push(`    }${index < measureEntries.length - 1 ? ',' : ''}`)
      })
      lines.push('  },')
      lines.push('')
    }

    // Export dimensions
    if (Object.keys(cube.dimensions).length > 0) {
      lines.push('  dimensions: {')
      const dimEntries = Object.entries(cube.dimensions)
      dimEntries.forEach(([name, dim], index) => {
        lines.push(`    ${name}: {`)
        lines.push(`      type: '${dim.type}',`)
        lines.push(`      sql: '${dim.sql}',`)
        if (dim.primaryKey) {
          lines.push(`      primaryKey: true,`)
        }
        if (dim.description) {
          lines.push(`      description: '${dim.description}',`)
        }
        lines.push(`    }${index < dimEntries.length - 1 ? ',' : ''}`)
      })
      lines.push('  },')
      lines.push('')
    }

    // Export joins
    if (cube.joins && cube.joins.length > 0) {
      lines.push('  joins: {')
      cube.joins.forEach((join, index) => {
        lines.push(`    ${join.name}: {`)
        lines.push(`      relationship: '${join.relationship}',`)
        lines.push(`      sql: \`${join.sql}\`,`)
        lines.push(`    }${index < cube.joins!.length - 1 ? ',' : ''}`)
      })
      lines.push('  },')
      lines.push('')
    }

    // Export segments
    if (cube.segments && Object.keys(cube.segments).length > 0) {
      lines.push('  segments: {')
      const segEntries = Object.entries(cube.segments)
      segEntries.forEach(([name, segment], index) => {
        lines.push(`    ${name}: {`)
        lines.push(`      sql: \`${segment.sql}\`,`)
        lines.push(`    }${index < segEntries.length - 1 ? ',' : ''}`)
      })
      lines.push('  },')
      lines.push('')
    }

    // Export preAggregations
    if (cube.preAggregations && cube.preAggregations.length > 0) {
      lines.push('  preAggregations: {')
      cube.preAggregations.forEach((pa, index) => {
        lines.push(`    ${pa.name}: {`)
        if (pa.measures.length > 0) {
          lines.push(`      measures: [${pa.measures.join(', ')}],`)
        }
        if (pa.dimensions.length > 0) {
          lines.push(`      dimensions: [${pa.dimensions.join(', ')}],`)
        }
        if (pa.timeDimension) {
          lines.push(`      timeDimension: ${pa.timeDimension},`)
        }
        if (pa.granularity) {
          lines.push(`      granularity: '${pa.granularity}',`)
        }
        lines.push(`    }${index < cube.preAggregations!.length - 1 ? ',' : ''}`)
      })
      lines.push('  },')
      lines.push('')
    }

    lines.push('});')
    lines.push('')
  }

  return lines.join('\n')
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

const VALID_MEASURE_TYPES: MetricType[] = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'countDistinct',
  'custom',
]

const VALID_DIMENSION_TYPES: DimensionType[] = [
  'string',
  'number',
  'time',
  'boolean',
  'geo',
]

const VALID_RELATIONSHIPS: JoinRelationship[] = [
  'belongsTo',
  'hasMany',
  'hasOne',
  'manyToMany',
]

/**
 * Validate an imported schema
 */
export function validateImportedSchema(schema: ImportedSchema): ValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  // Check for empty schema
  if (!schema.cubes || schema.cubes.length === 0) {
    throw new SchemaValidationError('Schema must have at least one cube')
  }

  const cubeNames = new Set<string>()

  for (const cube of schema.cubes) {
    // Validate cube name
    if (!cube.name || cube.name.trim() === '') {
      throw new SchemaValidationError('Cube name is required')
    }

    if (cubeNames.has(cube.name)) {
      throw new SchemaValidationError(`Duplicate cube name: ${cube.name}`)
    }
    cubeNames.add(cube.name)

    // Validate SQL
    if (!cube.sql || cube.sql.trim() === '') {
      throw new SchemaValidationError(`Cube '${cube.name}' must have SQL`)
    }

    // Validate measures
    for (const [name, measure] of Object.entries(cube.measures)) {
      if (!VALID_MEASURE_TYPES.includes(measure.type)) {
        throw new SchemaValidationError(
          `Invalid measure type '${measure.type}' for measure '${name}' in cube '${cube.name}'`
        )
      }

      // Sum, avg, min, max, countDistinct require sql
      if (
        ['sum', 'avg', 'min', 'max', 'countDistinct'].includes(measure.type) &&
        !measure.sql
      ) {
        warnings.push(
          `Measure '${name}' in cube '${cube.name}' has type '${measure.type}' but no SQL`
        )
      }
    }

    // Validate dimensions
    for (const [name, dim] of Object.entries(cube.dimensions)) {
      if (!VALID_DIMENSION_TYPES.includes(dim.type)) {
        throw new SchemaValidationError(
          `Invalid dimension type '${dim.type}' for dimension '${name}' in cube '${cube.name}'`
        )
      }
    }

    // Validate joins
    if (cube.joins) {
      for (const join of cube.joins) {
        if (!cubeNames.has(join.name) && !schema.cubes.some((c) => c.name === join.name)) {
          warnings.push(`Join references non-existent cube: ${join.name}`)
        }

        if (!VALID_RELATIONSHIPS.includes(join.relationship)) {
          throw new SchemaValidationError(
            `Invalid join relationship '${join.relationship}' for join '${join.name}'`
          )
        }
      }
    }

    // Validate pre-aggregations
    if (cube.preAggregations) {
      for (const pa of cube.preAggregations) {
        // Check that referenced measures exist
        for (const measureName of pa.measures) {
          if (!cube.measures[measureName]) {
            throw new SchemaValidationError(
              `Pre-aggregation '${pa.name}' references non-existent measure '${measureName}'`
            )
          }
        }

        // Check that referenced dimensions exist
        for (const dimName of pa.dimensions) {
          if (!cube.dimensions[dimName]) {
            throw new SchemaValidationError(
              `Pre-aggregation '${pa.name}' references non-existent dimension '${dimName}'`
            )
          }
        }

        // Check time dimension
        if (pa.timeDimension && !cube.dimensions[pa.timeDimension]) {
          throw new SchemaValidationError(
            `Pre-aggregation '${pa.name}' references non-existent time dimension '${pa.timeDimension}'`
          )
        }
      }
    }
  }

  // Check for circular join references
  const circularCheck = detectCircularJoins(schema)
  if (circularCheck) {
    warnings.push(circularCheck)
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  }
}

function detectCircularJoins(schema: ImportedSchema): string | null {
  const cubeMap = new Map<string, ImportedCube>()
  for (const cube of schema.cubes) {
    cubeMap.set(cube.name, cube)
  }

  function dfs(cubeName: string, visited: Set<string>, path: string[]): string | null {
    if (visited.has(cubeName)) {
      return `Circular join reference detected: ${path.join(' -> ')} -> ${cubeName}`
    }

    const cube = cubeMap.get(cubeName)
    if (!cube || !cube.joins) {
      return null
    }

    visited.add(cubeName)
    path.push(cubeName)

    for (const join of cube.joins) {
      const result = dfs(join.name, visited, [...path])
      if (result) {
        return result
      }
    }

    visited.delete(cubeName)
    return null
  }

  for (const cube of schema.cubes) {
    const result = dfs(cube.name, new Set(), [])
    if (result) {
      return result
    }
  }

  return null
}
