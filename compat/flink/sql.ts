/**
 * @dotdo/flink - Flink SQL and Table API Compatibility Layer
 * Issue: dotdo-8j5jd
 *
 * Provides Flink SQL compatibility for stream processing on Durable Objects.
 * Implements Table API, SQL parsing, and DataStream integration.
 *
 * Features:
 * - Table API with select, filter, join, group by, aggregate
 * - SQL query parsing (CREATE TABLE, INSERT INTO, SELECT)
 * - DDL and DML statement execution
 * - Integration with DataStream API
 * - Catalog and database management
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/table/overview/
 *
 * @example Basic SQL Query
 * ```typescript
 * import { TableEnvironment } from '@dotdo/flink'
 *
 * const tableEnv = TableEnvironment.create()
 *
 * tableEnv.executeSql(`
 *   CREATE TABLE orders (
 *     order_id STRING,
 *     amount DECIMAL(10, 2),
 *     order_time TIMESTAMP(3),
 *     WATERMARK FOR order_time AS order_time - INTERVAL '5' SECOND
 *   ) WITH (
 *     'connector' = 'datagen'
 *   )
 * `)
 *
 * const result = tableEnv.sqlQuery(`
 *   SELECT order_id, SUM(amount) as total
 *   FROM orders
 *   GROUP BY order_id
 * `)
 * ```
 *
 * @example Table API
 * ```typescript
 * const table = tableEnv.fromDataStream(dataStream)
 * const result = table
 *   .filter($('amount').isGreater(100))
 *   .groupBy($('userId'))
 *   .select($('userId'), $('amount').sum().as('total'))
 * ```
 */

import {
  DataStream,
  StreamExecutionEnvironment,
  Time,
  WatermarkStrategy,
} from './index'

// ===========================================================================
// Data Types
// ===========================================================================

/**
 * Flink SQL data types
 */
export enum DataTypes {
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  TINYINT = 'TINYINT',
  SMALLINT = 'SMALLINT',
  INT = 'INT',
  BIGINT = 'BIGINT',
  FLOAT = 'FLOAT',
  DOUBLE = 'DOUBLE',
  DECIMAL = 'DECIMAL',
  DATE = 'DATE',
  TIME = 'TIME',
  TIMESTAMP = 'TIMESTAMP',
  TIMESTAMP_LTZ = 'TIMESTAMP_LTZ',
  INTERVAL_YEAR_MONTH = 'INTERVAL YEAR TO MONTH',
  INTERVAL_DAY_TIME = 'INTERVAL DAY TO SECOND',
  ARRAY = 'ARRAY',
  MAP = 'MAP',
  MULTISET = 'MULTISET',
  ROW = 'ROW',
  RAW = 'RAW',
  NULL = 'NULL',
}

/**
 * Data type with precision/scale
 */
export class DataType {
  constructor(
    public readonly type: DataTypes | string,
    public readonly nullable: boolean = true,
    public readonly precision?: number,
    public readonly scale?: number,
    public readonly elementType?: DataType,
    public readonly keyType?: DataType,
    public readonly valueType?: DataType,
    public readonly fields?: { name: string; type: DataType }[]
  ) {}

  static STRING(): DataType {
    return new DataType(DataTypes.STRING)
  }

  static BOOLEAN(): DataType {
    return new DataType(DataTypes.BOOLEAN)
  }

  static INT(): DataType {
    return new DataType(DataTypes.INT)
  }

  static BIGINT(): DataType {
    return new DataType(DataTypes.BIGINT)
  }

  static FLOAT(): DataType {
    return new DataType(DataTypes.FLOAT)
  }

  static DOUBLE(): DataType {
    return new DataType(DataTypes.DOUBLE)
  }

  static DECIMAL(precision: number, scale: number): DataType {
    return new DataType(DataTypes.DECIMAL, true, precision, scale)
  }

  static DATE(): DataType {
    return new DataType(DataTypes.DATE)
  }

  static TIME(precision: number = 0): DataType {
    return new DataType(DataTypes.TIME, true, precision)
  }

  static TIMESTAMP(precision: number = 3): DataType {
    return new DataType(DataTypes.TIMESTAMP, true, precision)
  }

  static TIMESTAMP_LTZ(precision: number = 3): DataType {
    return new DataType(DataTypes.TIMESTAMP_LTZ, true, precision)
  }

  static ARRAY(elementType: DataType): DataType {
    return new DataType(DataTypes.ARRAY, true, undefined, undefined, elementType)
  }

  static MAP(keyType: DataType, valueType: DataType): DataType {
    return new DataType(DataTypes.MAP, true, undefined, undefined, undefined, keyType, valueType)
  }

  static ROW(fields: { name: string; type: DataType }[]): DataType {
    return new DataType(DataTypes.ROW, true, undefined, undefined, undefined, undefined, undefined, fields)
  }

  notNull(): DataType {
    return new DataType(
      this.type,
      false,
      this.precision,
      this.scale,
      this.elementType,
      this.keyType,
      this.valueType,
      this.fields
    )
  }

  nullable(): DataType {
    return new DataType(
      this.type,
      true,
      this.precision,
      this.scale,
      this.elementType,
      this.keyType,
      this.valueType,
      this.fields
    )
  }

  toString(): string {
    if (this.precision !== undefined && this.scale !== undefined) {
      return `${this.type}(${this.precision}, ${this.scale})`
    }
    if (this.precision !== undefined) {
      return `${this.type}(${this.precision})`
    }
    return this.type
  }
}

// ===========================================================================
// Schema
// ===========================================================================

/**
 * Column definition
 */
export interface ColumnDefinition {
  name: string
  type: DataType
  comment?: string
  primaryKey?: boolean
}

/**
 * Watermark definition
 */
export interface WatermarkDefinition {
  eventTimeColumn: string
  watermarkExpression: string
}

/**
 * Table schema
 */
export class Schema {
  private columns: ColumnDefinition[] = []
  private watermark?: WatermarkDefinition
  private primaryKeyColumns: string[] = []

  static newBuilder(): SchemaBuilder {
    return new SchemaBuilder()
  }

  addColumn(name: string, type: DataType, comment?: string): void {
    this.columns.push({ name, type, comment })
  }

  getColumns(): ColumnDefinition[] {
    return this.columns
  }

  getColumn(name: string): ColumnDefinition | undefined {
    return this.columns.find((c) => c.name === name)
  }

  setWatermark(eventTimeColumn: string, watermarkExpression: string): void {
    this.watermark = { eventTimeColumn, watermarkExpression }
  }

  getWatermark(): WatermarkDefinition | undefined {
    return this.watermark
  }

  setPrimaryKey(columns: string[]): void {
    this.primaryKeyColumns = columns
    for (const col of columns) {
      const column = this.columns.find((c) => c.name === col)
      if (column) {
        column.primaryKey = true
      }
    }
  }

  getPrimaryKey(): string[] {
    return this.primaryKeyColumns
  }

  getColumnCount(): number {
    return this.columns.length
  }

  toRowType(): DataType {
    return DataType.ROW(
      this.columns.map((c) => ({ name: c.name, type: c.type }))
    )
  }
}

/**
 * Schema builder
 */
export class SchemaBuilder {
  private schema = new Schema()

  column(name: string, type: DataType): SchemaBuilder {
    this.schema.addColumn(name, type)
    return this
  }

  columnByExpression(name: string, expression: string): SchemaBuilder {
    // For computed columns - store expression for later evaluation
    this.schema.addColumn(name, DataType.STRING())
    return this
  }

  watermark(eventTimeColumn: string, watermarkExpression: string): SchemaBuilder {
    this.schema.setWatermark(eventTimeColumn, watermarkExpression)
    return this
  }

  primaryKey(...columns: string[]): SchemaBuilder {
    this.schema.setPrimaryKey(columns)
    return this
  }

  primaryKeyNamed(name: string, ...columns: string[]): SchemaBuilder {
    this.schema.setPrimaryKey(columns)
    return this
  }

  build(): Schema {
    return this.schema
  }
}

// ===========================================================================
// SQL Parser
// ===========================================================================

/**
 * SQL statement types
 */
export enum StatementType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  CREATE_TABLE = 'CREATE_TABLE',
  CREATE_VIEW = 'CREATE_VIEW',
  CREATE_FUNCTION = 'CREATE_FUNCTION',
  CREATE_DATABASE = 'CREATE_DATABASE',
  CREATE_CATALOG = 'CREATE_CATALOG',
  DROP_TABLE = 'DROP_TABLE',
  DROP_VIEW = 'DROP_VIEW',
  DROP_DATABASE = 'DROP_DATABASE',
  DROP_CATALOG = 'DROP_CATALOG',
  ALTER_TABLE = 'ALTER_TABLE',
  USE_CATALOG = 'USE_CATALOG',
  USE_DATABASE = 'USE_DATABASE',
  SHOW_TABLES = 'SHOW_TABLES',
  SHOW_DATABASES = 'SHOW_DATABASES',
  SHOW_CATALOGS = 'SHOW_CATALOGS',
  DESCRIBE = 'DESCRIBE',
  EXPLAIN = 'EXPLAIN',
  SET = 'SET',
  RESET = 'RESET',
}

/**
 * Parsed SQL statement
 */
export interface ParsedStatement {
  type: StatementType
  sql: string
  tableName?: string
  schema?: Schema
  columns?: string[]
  selectExpressions?: SelectExpression[]
  whereClause?: Expression
  groupByColumns?: string[]
  havingClause?: Expression
  orderByColumns?: OrderByColumn[]
  limit?: number
  withOptions?: Map<string, string>
  insertColumns?: string[]
  selectStatement?: ParsedStatement
  databaseName?: string
  catalogName?: string
  viewDefinition?: string
  ifNotExists?: boolean
  ifExists?: boolean
}

/**
 * Select expression
 */
export interface SelectExpression {
  expression: Expression
  alias?: string
}

/**
 * Expression types
 */
export type Expression =
  | ColumnRef
  | Literal
  | FunctionCall
  | BinaryOp
  | UnaryOp
  | CaseExpression
  | SubqueryExpression
  | StarExpression

export interface ColumnRef {
  type: 'column'
  name: string
  table?: string
}

export interface Literal {
  type: 'literal'
  value: string | number | boolean | null
  dataType?: DataType
}

export interface FunctionCall {
  type: 'function'
  name: string
  args: Expression[]
  distinct?: boolean
  over?: WindowSpec
}

export interface BinaryOp {
  type: 'binary'
  operator: string
  left: Expression
  right: Expression
}

export interface UnaryOp {
  type: 'unary'
  operator: string
  operand: Expression
}

export interface CaseExpression {
  type: 'case'
  whenClauses: { condition: Expression; result: Expression }[]
  elseResult?: Expression
}

export interface SubqueryExpression {
  type: 'subquery'
  statement: ParsedStatement
}

export interface StarExpression {
  type: 'star'
  table?: string
}

/**
 * Order by column
 */
export interface OrderByColumn {
  expression: Expression
  ascending: boolean
  nullsFirst?: boolean
}

/**
 * Window specification
 */
export interface WindowSpec {
  partitionBy?: Expression[]
  orderBy?: OrderByColumn[]
  frameType?: 'ROWS' | 'RANGE'
  frameStart?: FrameBound
  frameEnd?: FrameBound
}

export interface FrameBound {
  type: 'UNBOUNDED_PRECEDING' | 'CURRENT_ROW' | 'UNBOUNDED_FOLLOWING' | 'PRECEDING' | 'FOLLOWING'
  offset?: number
}

/**
 * SQL Parser - Parses Flink SQL statements
 */
export class SqlParser {
  /**
   * Parse a SQL statement
   */
  static parse(sql: string): ParsedStatement {
    const trimmed = sql.trim()
    const upperSql = trimmed.toUpperCase()

    if (upperSql.startsWith('CREATE TABLE')) {
      return SqlParser.parseCreateTable(trimmed)
    }
    if (upperSql.startsWith('CREATE VIEW')) {
      return SqlParser.parseCreateView(trimmed)
    }
    if (upperSql.startsWith('CREATE DATABASE')) {
      return SqlParser.parseCreateDatabase(trimmed)
    }
    if (upperSql.startsWith('CREATE CATALOG')) {
      return SqlParser.parseCreateCatalog(trimmed)
    }
    if (upperSql.startsWith('DROP TABLE')) {
      return SqlParser.parseDropTable(trimmed)
    }
    if (upperSql.startsWith('DROP VIEW')) {
      return SqlParser.parseDropView(trimmed)
    }
    if (upperSql.startsWith('DROP DATABASE')) {
      return SqlParser.parseDropDatabase(trimmed)
    }
    if (upperSql.startsWith('INSERT INTO') || upperSql.startsWith('INSERT OVERWRITE')) {
      return SqlParser.parseInsert(trimmed)
    }
    if (upperSql.startsWith('SELECT')) {
      return SqlParser.parseSelect(trimmed)
    }
    if (upperSql.startsWith('USE CATALOG')) {
      return SqlParser.parseUseCatalog(trimmed)
    }
    if (upperSql.startsWith('USE')) {
      return SqlParser.parseUseDatabase(trimmed)
    }
    if (upperSql.startsWith('SHOW TABLES')) {
      return { type: StatementType.SHOW_TABLES, sql: trimmed }
    }
    if (upperSql.startsWith('SHOW DATABASES')) {
      return { type: StatementType.SHOW_DATABASES, sql: trimmed }
    }
    if (upperSql.startsWith('SHOW CATALOGS')) {
      return { type: StatementType.SHOW_CATALOGS, sql: trimmed }
    }
    if (upperSql.startsWith('DESCRIBE') || upperSql.startsWith('DESC ')) {
      return SqlParser.parseDescribe(trimmed)
    }
    if (upperSql.startsWith('EXPLAIN')) {
      return SqlParser.parseExplain(trimmed)
    }
    if (upperSql.startsWith('SET')) {
      return SqlParser.parseSet(trimmed)
    }
    if (upperSql.startsWith('RESET')) {
      return SqlParser.parseReset(trimmed)
    }

    throw new SqlParseError(`Unsupported SQL statement: ${trimmed.substring(0, 50)}...`)
  }

  /**
   * Parse CREATE TABLE statement
   */
  private static parseCreateTable(sql: string): ParsedStatement {
    const ifNotExists = sql.toUpperCase().includes('IF NOT EXISTS')

    // Extract table name
    const tableNameMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)`?/i)
    if (!tableNameMatch) {
      throw new SqlParseError('Invalid CREATE TABLE syntax: table name not found')
    }
    const tableName = tableNameMatch[1]

    // Extract column definitions between first ( and matching )
    const columnsStart = sql.indexOf('(')
    if (columnsStart === -1) {
      throw new SqlParseError('Invalid CREATE TABLE syntax: missing column definitions')
    }

    // Find the matching closing parenthesis for columns
    let depth = 1
    let columnsEnd = columnsStart + 1
    while (depth > 0 && columnsEnd < sql.length) {
      if (sql[columnsEnd] === '(') depth++
      if (sql[columnsEnd] === ')') depth--
      columnsEnd++
    }
    columnsEnd-- // Back to the actual closing paren

    const columnsPart = sql.substring(columnsStart + 1, columnsEnd).trim()

    // Parse schema from column definitions
    const schema = SqlParser.parseColumnDefinitions(columnsPart)

    // Extract WITH options
    const withOptions = new Map<string, string>()
    const withMatch = sql.match(/WITH\s*\(([^)]+)\)/i)
    if (withMatch) {
      const optionsPart = withMatch[1]
      const optionMatches = optionsPart.matchAll(/'([^']+)'\s*=\s*'([^']*)'/g)
      for (const match of optionMatches) {
        withOptions.set(match[1], match[2])
      }
    }

    return {
      type: StatementType.CREATE_TABLE,
      sql,
      tableName,
      schema,
      withOptions,
      ifNotExists,
    }
  }

  /**
   * Parse column definitions
   */
  private static parseColumnDefinitions(columnsPart: string): Schema {
    const builder = Schema.newBuilder()

    // Split by comma, but respect parentheses
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const char of columnsPart) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      parts.push(current.trim())
    }

    for (const part of parts) {
      const trimmed = part.trim()

      // Check for WATERMARK definition
      if (trimmed.toUpperCase().startsWith('WATERMARK FOR')) {
        const watermarkMatch = trimmed.match(/WATERMARK\s+FOR\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+AS\s+(.+)/i)
        if (watermarkMatch) {
          builder.watermark(watermarkMatch[1], watermarkMatch[2])
        }
        continue
      }

      // Check for PRIMARY KEY definition
      if (trimmed.toUpperCase().startsWith('PRIMARY KEY')) {
        const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
        if (pkMatch) {
          const columns = pkMatch[1].split(',').map((c) => c.trim().replace(/`/g, ''))
          builder.primaryKey(...columns)
        }
        continue
      }

      // Check for CONSTRAINT
      if (trimmed.toUpperCase().startsWith('CONSTRAINT')) {
        continue // Skip constraints for now
      }

      // Parse column: name TYPE [NOT NULL] [COMMENT 'comment']
      const colMatch = trimmed.match(/^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+([A-Za-z_][A-Za-z0-9_<>,() ]*)/i)
      if (colMatch) {
        const colName = colMatch[1]
        const typeStr = colMatch[2].trim()
        const dataType = SqlParser.parseDataType(typeStr)
        builder.column(colName, dataType)
      }
    }

    return builder.build()
  }

  /**
   * Parse data type string
   */
  private static parseDataType(typeStr: string): DataType {
    const upper = typeStr.toUpperCase().trim()

    // Handle precision/scale types like DECIMAL(10, 2)
    const precisionMatch = upper.match(/^([A-Z_]+)\s*\((\d+)(?:\s*,\s*(\d+))?\)/)
    if (precisionMatch) {
      const typeName = precisionMatch[1]
      const precision = parseInt(precisionMatch[2], 10)
      const scale = precisionMatch[3] ? parseInt(precisionMatch[3], 10) : undefined

      if (typeName === 'DECIMAL' || typeName === 'NUMERIC') {
        return new DataType(DataTypes.DECIMAL, true, precision, scale)
      }
      if (typeName === 'TIMESTAMP') {
        return new DataType(DataTypes.TIMESTAMP, true, precision)
      }
      if (typeName === 'TIME') {
        return new DataType(DataTypes.TIME, true, precision)
      }
      if (typeName === 'VARCHAR' || typeName === 'CHAR') {
        return new DataType(DataTypes.STRING, true, precision)
      }
    }

    // Handle ARRAY<type>
    if (upper.startsWith('ARRAY<')) {
      const elementTypeStr = upper.slice(6, -1)
      return DataType.ARRAY(SqlParser.parseDataType(elementTypeStr))
    }

    // Handle MAP<key, value>
    if (upper.startsWith('MAP<')) {
      const inner = upper.slice(4, -1)
      const commaIndex = SqlParser.findTopLevelComma(inner)
      if (commaIndex !== -1) {
        const keyTypeStr = inner.slice(0, commaIndex).trim()
        const valueTypeStr = inner.slice(commaIndex + 1).trim()
        return DataType.MAP(
          SqlParser.parseDataType(keyTypeStr),
          SqlParser.parseDataType(valueTypeStr)
        )
      }
    }

    // Simple types
    const simpleTypes: Record<string, DataType> = {
      'STRING': DataType.STRING(),
      'VARCHAR': DataType.STRING(),
      'CHAR': DataType.STRING(),
      'BOOLEAN': DataType.BOOLEAN(),
      'BOOL': DataType.BOOLEAN(),
      'TINYINT': new DataType(DataTypes.TINYINT),
      'SMALLINT': new DataType(DataTypes.SMALLINT),
      'INT': DataType.INT(),
      'INTEGER': DataType.INT(),
      'BIGINT': DataType.BIGINT(),
      'FLOAT': DataType.FLOAT(),
      'DOUBLE': DataType.DOUBLE(),
      'DECIMAL': DataType.DECIMAL(10, 0),
      'DATE': DataType.DATE(),
      'TIME': DataType.TIME(),
      'TIMESTAMP': DataType.TIMESTAMP(),
      'TIMESTAMP_LTZ': DataType.TIMESTAMP_LTZ(),
    }

    // Check for NOT NULL suffix
    const notNull = upper.includes('NOT NULL')
    const cleanType = upper.replace(/\s*NOT\s+NULL\s*/i, '').trim()

    const dataType = simpleTypes[cleanType]
    if (dataType) {
      return notNull ? dataType.notNull() : dataType
    }

    // Default to STRING for unknown types
    return DataType.STRING()
  }

  /**
   * Find top-level comma (not nested in <>)
   */
  private static findTopLevelComma(str: string): number {
    let depth = 0
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '<') depth++
      if (str[i] === '>') depth--
      if (str[i] === ',' && depth === 0) return i
    }
    return -1
  }

  /**
   * Parse CREATE VIEW statement
   */
  private static parseCreateView(sql: string): ParsedStatement {
    const ifNotExists = sql.toUpperCase().includes('IF NOT EXISTS')
    const viewMatch = sql.match(/CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+AS\s+(.+)/is)

    if (!viewMatch) {
      throw new SqlParseError('Invalid CREATE VIEW syntax')
    }

    return {
      type: StatementType.CREATE_VIEW,
      sql,
      tableName: viewMatch[1],
      viewDefinition: viewMatch[2].trim(),
      ifNotExists,
    }
  }

  /**
   * Parse CREATE DATABASE statement
   */
  private static parseCreateDatabase(sql: string): ParsedStatement {
    const ifNotExists = sql.toUpperCase().includes('IF NOT EXISTS')
    const dbMatch = sql.match(/CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)

    if (!dbMatch) {
      throw new SqlParseError('Invalid CREATE DATABASE syntax')
    }

    return {
      type: StatementType.CREATE_DATABASE,
      sql,
      databaseName: dbMatch[1],
      ifNotExists,
    }
  }

  /**
   * Parse CREATE CATALOG statement
   */
  private static parseCreateCatalog(sql: string): ParsedStatement {
    const ifNotExists = sql.toUpperCase().includes('IF NOT EXISTS')
    const catalogMatch = sql.match(/CREATE\s+CATALOG\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)

    if (!catalogMatch) {
      throw new SqlParseError('Invalid CREATE CATALOG syntax')
    }

    return {
      type: StatementType.CREATE_CATALOG,
      sql,
      catalogName: catalogMatch[1],
      ifNotExists,
    }
  }

  /**
   * Parse DROP TABLE statement
   */
  private static parseDropTable(sql: string): ParsedStatement {
    const ifExists = sql.toUpperCase().includes('IF EXISTS')
    const tableMatch = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)

    if (!tableMatch) {
      throw new SqlParseError('Invalid DROP TABLE syntax')
    }

    return {
      type: StatementType.DROP_TABLE,
      sql,
      tableName: tableMatch[1],
      ifExists,
    }
  }

  /**
   * Parse DROP VIEW statement
   */
  private static parseDropView(sql: string): ParsedStatement {
    const ifExists = sql.toUpperCase().includes('IF EXISTS')
    const viewMatch = sql.match(/DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)

    if (!viewMatch) {
      throw new SqlParseError('Invalid DROP VIEW syntax')
    }

    return {
      type: StatementType.DROP_VIEW,
      sql,
      tableName: viewMatch[1],
      ifExists,
    }
  }

  /**
   * Parse DROP DATABASE statement
   */
  private static parseDropDatabase(sql: string): ParsedStatement {
    const ifExists = sql.toUpperCase().includes('IF EXISTS')
    const dbMatch = sql.match(/DROP\s+DATABASE\s+(?:IF\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)

    if (!dbMatch) {
      throw new SqlParseError('Invalid DROP DATABASE syntax')
    }

    return {
      type: StatementType.DROP_DATABASE,
      sql,
      databaseName: dbMatch[1],
      ifExists,
    }
  }

  /**
   * Parse INSERT statement
   */
  private static parseInsert(sql: string): ParsedStatement {
    const isOverwrite = sql.toUpperCase().includes('INSERT OVERWRITE')
    const insertMatch = sql.match(/INSERT\s+(?:INTO|OVERWRITE)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s*(?:\(([^)]*)\))?\s*(SELECT.+)/is)

    if (!insertMatch) {
      throw new SqlParseError('Invalid INSERT syntax')
    }

    const tableName = insertMatch[1]
    const insertColumns = insertMatch[2]
      ? insertMatch[2].split(',').map((c) => c.trim().replace(/`/g, ''))
      : undefined
    const selectPart = insertMatch[3]

    return {
      type: StatementType.INSERT,
      sql,
      tableName,
      insertColumns,
      selectStatement: SqlParser.parseSelect(selectPart),
    }
  }

  /**
   * Parse SELECT statement
   */
  private static parseSelect(sql: string): ParsedStatement {
    // Basic SELECT parsing - extracts key clauses
    const selectExpressions: SelectExpression[] = []
    const columns: string[] = []

    // Extract SELECT columns
    const selectMatch = sql.match(/SELECT\s+(?:DISTINCT\s+)?(.+?)\s+FROM/is)
    if (selectMatch) {
      const selectPart = selectMatch[1]
      // Simple column extraction (handles basic cases)
      const parts = SqlParser.splitSelectColumns(selectPart)
      for (const part of parts) {
        const trimmed = part.trim()
        const aliasMatch = trimmed.match(/^(.+?)\s+(?:AS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?$/i)
        if (aliasMatch) {
          columns.push(aliasMatch[2])
          selectExpressions.push({
            expression: SqlParser.parseExpression(aliasMatch[1]),
            alias: aliasMatch[2],
          })
        } else {
          columns.push(trimmed)
          selectExpressions.push({
            expression: SqlParser.parseExpression(trimmed),
          })
        }
      }
    }

    // Extract table name
    const fromMatch = sql.match(/FROM\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)
    const tableName = fromMatch ? fromMatch[1] : undefined

    // Extract WHERE clause
    let whereClause: Expression | undefined
    const whereMatch = sql.match(/WHERE\s+(.+?)(?=\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s+HAVING|$)/is)
    if (whereMatch) {
      whereClause = SqlParser.parseExpression(whereMatch[1].trim())
    }

    // Extract GROUP BY columns
    let groupByColumns: string[] | undefined
    const groupByMatch = sql.match(/GROUP\s+BY\s+(.+?)(?=\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|$)/is)
    if (groupByMatch) {
      groupByColumns = groupByMatch[1].split(',').map((c) => c.trim().replace(/`/g, ''))
    }

    // Extract HAVING clause
    let havingClause: Expression | undefined
    const havingMatch = sql.match(/HAVING\s+(.+?)(?=\s+ORDER\s+BY|\s+LIMIT|$)/is)
    if (havingMatch) {
      havingClause = SqlParser.parseExpression(havingMatch[1].trim())
    }

    // Extract ORDER BY
    let orderByColumns: OrderByColumn[] | undefined
    const orderByMatch = sql.match(/ORDER\s+BY\s+(.+?)(?=\s+LIMIT|$)/is)
    if (orderByMatch) {
      orderByColumns = []
      const parts = orderByMatch[1].split(',')
      for (const part of parts) {
        const trimmed = part.trim()
        const ascending = !trimmed.toUpperCase().includes(' DESC')
        const colName = trimmed.replace(/\s+(ASC|DESC)$/i, '').trim()
        orderByColumns.push({
          expression: SqlParser.parseExpression(colName),
          ascending,
        })
      }
    }

    // Extract LIMIT
    let limit: number | undefined
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10)
    }

    return {
      type: StatementType.SELECT,
      sql,
      tableName,
      columns,
      selectExpressions,
      whereClause,
      groupByColumns,
      havingClause,
      orderByColumns,
      limit,
    }
  }

  /**
   * Split SELECT columns by comma, respecting parentheses
   */
  private static splitSelectColumns(selectPart: string): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const char of selectPart) {
      if (char === '(' || char === '[') depth++
      if (char === ')' || char === ']') depth--
      if (char === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      parts.push(current.trim())
    }

    return parts
  }

  /**
   * Parse an expression (simplified)
   */
  private static parseExpression(exprStr: string): Expression {
    const trimmed = exprStr.trim()

    // Star expression
    if (trimmed === '*') {
      return { type: 'star' }
    }
    if (trimmed.includes('.*')) {
      return { type: 'star', table: trimmed.replace('.*', '') }
    }

    // Literal number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { type: 'literal', value: parseFloat(trimmed) }
    }

    // String literal
    if (/^'[^']*'$/.test(trimmed)) {
      return { type: 'literal', value: trimmed.slice(1, -1) }
    }

    // Boolean literal
    if (trimmed.toUpperCase() === 'TRUE') {
      return { type: 'literal', value: true }
    }
    if (trimmed.toUpperCase() === 'FALSE') {
      return { type: 'literal', value: false }
    }

    // NULL literal
    if (trimmed.toUpperCase() === 'NULL') {
      return { type: 'literal', value: null }
    }

    // Function call
    const funcMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)?\)$/is)
    if (funcMatch) {
      const funcName = funcMatch[1].toUpperCase()
      const argsStr = funcMatch[2] || ''
      const args = argsStr ? SqlParser.splitSelectColumns(argsStr).map(a => SqlParser.parseExpression(a)) : []
      const distinct = argsStr.toUpperCase().startsWith('DISTINCT ')
      return {
        type: 'function',
        name: funcName,
        args: distinct ? args.slice(1) : args,
        distinct,
      }
    }

    // Binary operators (simplified - only handles basic cases)
    for (const op of ['>=', '<=', '<>', '!=', '=', '>', '<', 'AND', 'OR', '+', '-', '*', '/', 'LIKE', 'IN', 'IS NOT', 'IS']) {
      const opIndex = trimmed.toUpperCase().indexOf(` ${op} `)
      if (opIndex !== -1) {
        return {
          type: 'binary',
          operator: op,
          left: SqlParser.parseExpression(trimmed.slice(0, opIndex)),
          right: SqlParser.parseExpression(trimmed.slice(opIndex + op.length + 2)),
        }
      }
    }

    // Column reference (default)
    const parts = trimmed.split('.')
    if (parts.length === 2) {
      return { type: 'column', table: parts[0].replace(/`/g, ''), name: parts[1].replace(/`/g, '') }
    }
    return { type: 'column', name: trimmed.replace(/`/g, '') }
  }

  /**
   * Parse USE CATALOG statement
   */
  private static parseUseCatalog(sql: string): ParsedStatement {
    const match = sql.match(/USE\s+CATALOG\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)
    if (!match) {
      throw new SqlParseError('Invalid USE CATALOG syntax')
    }
    return {
      type: StatementType.USE_CATALOG,
      sql,
      catalogName: match[1],
    }
  }

  /**
   * Parse USE DATABASE statement
   */
  private static parseUseDatabase(sql: string): ParsedStatement {
    const match = sql.match(/USE\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)
    if (!match) {
      throw new SqlParseError('Invalid USE statement syntax')
    }
    return {
      type: StatementType.USE_DATABASE,
      sql,
      databaseName: match[1],
    }
  }

  /**
   * Parse DESCRIBE statement
   */
  private static parseDescribe(sql: string): ParsedStatement {
    const match = sql.match(/(?:DESCRIBE|DESC)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i)
    if (!match) {
      throw new SqlParseError('Invalid DESCRIBE syntax')
    }
    return {
      type: StatementType.DESCRIBE,
      sql,
      tableName: match[1],
    }
  }

  /**
   * Parse EXPLAIN statement
   */
  private static parseExplain(sql: string): ParsedStatement {
    const match = sql.match(/EXPLAIN\s+(.+)/is)
    if (!match) {
      throw new SqlParseError('Invalid EXPLAIN syntax')
    }
    return {
      type: StatementType.EXPLAIN,
      sql,
      selectStatement: SqlParser.parse(match[1].trim()),
    }
  }

  /**
   * Parse SET statement
   */
  private static parseSet(sql: string): ParsedStatement {
    return {
      type: StatementType.SET,
      sql,
    }
  }

  /**
   * Parse RESET statement
   */
  private static parseReset(sql: string): ParsedStatement {
    return {
      type: StatementType.RESET,
      sql,
    }
  }
}

/**
 * SQL parse error
 */
export class SqlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlParseError'
  }
}

// ===========================================================================
// Expression API
// ===========================================================================

/**
 * Expression builder for Table API
 */
export function $(name: string): ExpressionBuilder {
  return new ExpressionBuilder(name)
}

/**
 * Literal expression
 */
export function lit(value: any): ExpressionBuilder {
  return ExpressionBuilder.literal(value)
}

/**
 * Expression builder for fluent API
 */
export class ExpressionBuilder {
  private expr: Expression

  constructor(columnName: string) {
    this.expr = { type: 'column', name: columnName }
  }

  static literal(value: any): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = { type: 'literal', value }
    return builder
  }

  static fromExpression(expr: Expression): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = expr
    return builder
  }

  /**
   * Get the underlying expression
   */
  getExpression(): Expression {
    return this.expr
  }

  /**
   * Alias
   */
  as(alias: string): ExpressionBuilder {
    return this // Alias is handled at select level
  }

  /**
   * Comparison operators
   */
  isEqual(other: any): ExpressionBuilder {
    return this.binaryOp('=', other)
  }

  isNotEqual(other: any): ExpressionBuilder {
    return this.binaryOp('<>', other)
  }

  isGreater(other: any): ExpressionBuilder {
    return this.binaryOp('>', other)
  }

  isGreaterOrEqual(other: any): ExpressionBuilder {
    return this.binaryOp('>=', other)
  }

  isLess(other: any): ExpressionBuilder {
    return this.binaryOp('<', other)
  }

  isLessOrEqual(other: any): ExpressionBuilder {
    return this.binaryOp('<=', other)
  }

  isNull(): ExpressionBuilder {
    return this.binaryOp('IS', null)
  }

  isNotNull(): ExpressionBuilder {
    return this.binaryOp('IS NOT', null)
  }

  /**
   * Logical operators
   */
  and(other: ExpressionBuilder): ExpressionBuilder {
    return this.binaryOp('AND', other)
  }

  or(other: ExpressionBuilder): ExpressionBuilder {
    return this.binaryOp('OR', other)
  }

  not(): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = { type: 'unary', operator: 'NOT', operand: this.expr }
    return builder
  }

  /**
   * Arithmetic operators
   */
  plus(other: any): ExpressionBuilder {
    return this.binaryOp('+', other)
  }

  minus(other: any): ExpressionBuilder {
    return this.binaryOp('-', other)
  }

  times(other: any): ExpressionBuilder {
    return this.binaryOp('*', other)
  }

  dividedBy(other: any): ExpressionBuilder {
    return this.binaryOp('/', other)
  }

  mod(other: any): ExpressionBuilder {
    return this.binaryOp('%', other)
  }

  /**
   * String operators
   */
  like(pattern: string): ExpressionBuilder {
    return this.binaryOp('LIKE', pattern)
  }

  similar(pattern: string): ExpressionBuilder {
    return this.binaryOp('SIMILAR TO', pattern)
  }

  /**
   * IN operator
   */
  in(...values: any[]): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = {
      type: 'binary',
      operator: 'IN',
      left: this.expr,
      right: { type: 'literal', value: values },
    }
    return builder
  }

  between(lower: any, upper: any): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = {
      type: 'binary',
      operator: 'BETWEEN',
      left: this.expr,
      right: { type: 'literal', value: [lower, upper] },
    }
    return builder
  }

  /**
   * Aggregate functions
   */
  sum(): ExpressionBuilder {
    return this.aggregate('SUM')
  }

  avg(): ExpressionBuilder {
    return this.aggregate('AVG')
  }

  min(): ExpressionBuilder {
    return this.aggregate('MIN')
  }

  max(): ExpressionBuilder {
    return this.aggregate('MAX')
  }

  count(): ExpressionBuilder {
    return this.aggregate('COUNT')
  }

  /**
   * Utility functions
   */
  cast(dataType: DataType): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = {
      type: 'function',
      name: 'CAST',
      args: [this.expr, { type: 'literal', value: dataType.toString() }],
    }
    return builder
  }

  /**
   * Helper for binary operations
   */
  private binaryOp(operator: string, other: any): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    const rightExpr: Expression =
      other instanceof ExpressionBuilder
        ? other.expr
        : { type: 'literal', value: other }
    builder.expr = {
      type: 'binary',
      operator,
      left: this.expr,
      right: rightExpr,
    }
    return builder
  }

  /**
   * Helper for aggregate functions
   */
  private aggregate(funcName: string): ExpressionBuilder {
    const builder = new ExpressionBuilder('')
    builder.expr = {
      type: 'function',
      name: funcName,
      args: [this.expr],
    }
    return builder
  }
}

// ===========================================================================
// Table
// ===========================================================================

/**
 * Row in a table
 */
export type Row = Record<string, any>

/**
 * Table - represents a relational table
 */
export class Table {
  private data: Row[] = []
  private tableSchema: Schema

  constructor(
    private tableEnv: TableEnvironment,
    schema: Schema,
    data: Row[] = []
  ) {
    this.tableSchema = schema
    this.data = [...data]
  }

  /**
   * Get the schema
   */
  getSchema(): Schema {
    return this.tableSchema
  }

  /**
   * Select columns
   */
  select(...expressions: (ExpressionBuilder | string)[]): Table {
    const selectExprs = expressions.map((e) => {
      if (typeof e === 'string') {
        if (e === '*') {
          return { expression: { type: 'star' as const } }
        }
        return { expression: { type: 'column' as const, name: e } }
      }
      return { expression: e.getExpression() }
    })

    const newData = this.data.map((row) => {
      const newRow: Row = {}
      for (const { expression } of selectExprs) {
        if (expression.type === 'star') {
          Object.assign(newRow, row)
        } else if (expression.type === 'column') {
          newRow[expression.name] = row[expression.name]
        } else {
          // Evaluate expression
          const value = this.evaluateExpression(expression, row)
          const key = this.expressionToName(expression)
          newRow[key] = value
        }
      }
      return newRow
    })

    const newColumns = Object.keys(newData[0] || {}).map((name) => ({
      name,
      type: DataType.STRING(),
    }))
    const newSchema = new Schema()
    for (const col of newColumns) {
      newSchema.addColumn(col.name, col.type)
    }

    return new Table(this.tableEnv, newSchema, newData)
  }

  /**
   * Filter rows
   */
  filter(predicate: ExpressionBuilder): Table {
    const expr = predicate.getExpression()
    const newData = this.data.filter((row) => {
      return this.evaluateExpression(expr, row)
    })
    return new Table(this.tableEnv, this.tableSchema, newData)
  }

  /**
   * Alias for filter
   */
  where(predicate: ExpressionBuilder): Table {
    return this.filter(predicate)
  }

  /**
   * Group by columns
   */
  groupBy(...columns: (ExpressionBuilder | string)[]): GroupedTable {
    const groupCols = columns.map((c) => {
      if (typeof c === 'string') return c
      const expr = c.getExpression()
      if (expr.type === 'column') return expr.name
      throw new Error('Group by expression must be a column')
    })
    return new GroupedTable(this.tableEnv, this.tableSchema, this.data, groupCols)
  }

  /**
   * Order by
   */
  orderBy(...columns: (ExpressionBuilder | string)[]): Table {
    const newData = [...this.data].sort((a, b) => {
      for (const col of columns) {
        const colName = typeof col === 'string' ? col : (col.getExpression() as ColumnRef).name
        const aVal = a[colName]
        const bVal = b[colName]
        if (aVal < bVal) return -1
        if (aVal > bVal) return 1
      }
      return 0
    })
    return new Table(this.tableEnv, this.tableSchema, newData)
  }

  /**
   * Limit rows
   */
  limit(n: number): Table {
    return new Table(this.tableEnv, this.tableSchema, this.data.slice(0, n))
  }

  /**
   * Offset rows
   */
  offset(n: number): Table {
    return new Table(this.tableEnv, this.tableSchema, this.data.slice(n))
  }

  /**
   * Join with another table
   */
  join(other: Table, condition?: ExpressionBuilder): Table {
    return this.joinInternal(other, condition, 'INNER')
  }

  leftOuterJoin(other: Table, condition?: ExpressionBuilder): Table {
    return this.joinInternal(other, condition, 'LEFT')
  }

  rightOuterJoin(other: Table, condition?: ExpressionBuilder): Table {
    return this.joinInternal(other, condition, 'RIGHT')
  }

  fullOuterJoin(other: Table, condition?: ExpressionBuilder): Table {
    return this.joinInternal(other, condition, 'FULL')
  }

  /**
   * Union
   */
  union(other: Table): Table {
    const combined = [...this.data, ...other.data]
    // Remove duplicates
    const unique = combined.filter((row, index, self) =>
      index === self.findIndex((r) => JSON.stringify(r) === JSON.stringify(row))
    )
    return new Table(this.tableEnv, this.tableSchema, unique)
  }

  unionAll(other: Table): Table {
    return new Table(this.tableEnv, this.tableSchema, [...this.data, ...other.data])
  }

  /**
   * Intersect
   */
  intersect(other: Table): Table {
    const otherSet = new Set(other.data.map((r) => JSON.stringify(r)))
    const result = this.data.filter((row) => otherSet.has(JSON.stringify(row)))
    return new Table(this.tableEnv, this.tableSchema, result)
  }

  /**
   * Except (minus)
   */
  minus(other: Table): Table {
    const otherSet = new Set(other.data.map((r) => JSON.stringify(r)))
    const result = this.data.filter((row) => !otherSet.has(JSON.stringify(row)))
    return new Table(this.tableEnv, this.tableSchema, result)
  }

  /**
   * Distinct
   */
  distinct(): Table {
    const unique = this.data.filter((row, index, self) =>
      index === self.findIndex((r) => JSON.stringify(r) === JSON.stringify(row))
    )
    return new Table(this.tableEnv, this.tableSchema, unique)
  }

  /**
   * Execute and collect results
   */
  execute(): TableResult {
    return new TableResult(this.tableSchema, this.data)
  }

  /**
   * Convert to DataStream
   */
  toDataStream<T>(env: StreamExecutionEnvironment): DataStream<T> {
    return new DataStream<T>(env, this.data as T[])
  }

  /**
   * Alias for conversion to changelog stream
   */
  toChangelogStream<T>(env: StreamExecutionEnvironment): DataStream<T> {
    return this.toDataStream(env)
  }

  /**
   * Print schema
   */
  printSchema(): void {
    console.log('Schema:')
    for (const col of this.tableSchema.getColumns()) {
      console.log(`  ${col.name}: ${col.type.toString()}`)
    }
  }

  /**
   * Get data (internal)
   */
  getData(): Row[] {
    return this.data
  }

  /**
   * Internal join implementation
   */
  private joinInternal(other: Table, condition: ExpressionBuilder | undefined, joinType: string): Table {
    const result: Row[] = []

    for (const leftRow of this.data) {
      let matched = false
      for (const rightRow of other.data) {
        const combinedRow = { ...leftRow, ...rightRow }
        if (!condition || this.evaluateExpression(condition.getExpression(), combinedRow)) {
          result.push(combinedRow)
          matched = true
        }
      }

      // For left/full outer joins, add null right side if no match
      if (!matched && (joinType === 'LEFT' || joinType === 'FULL')) {
        const nullRight: Row = {}
        for (const col of other.tableSchema.getColumns()) {
          nullRight[col.name] = null
        }
        result.push({ ...leftRow, ...nullRight })
      }
    }

    // For right/full outer joins, add null left side for unmatched right rows
    if (joinType === 'RIGHT' || joinType === 'FULL') {
      for (const rightRow of other.data) {
        let matched = false
        for (const leftRow of this.data) {
          const combinedRow = { ...leftRow, ...rightRow }
          if (!condition || this.evaluateExpression(condition.getExpression(), combinedRow)) {
            matched = true
            break
          }
        }
        if (!matched) {
          const nullLeft: Row = {}
          for (const col of this.tableSchema.getColumns()) {
            nullLeft[col.name] = null
          }
          result.push({ ...nullLeft, ...rightRow })
        }
      }
    }

    // Merge schemas
    const mergedSchema = new Schema()
    for (const col of this.tableSchema.getColumns()) {
      mergedSchema.addColumn(col.name, col.type)
    }
    for (const col of other.tableSchema.getColumns()) {
      if (!mergedSchema.getColumn(col.name)) {
        mergedSchema.addColumn(col.name, col.type)
      }
    }

    return new Table(this.tableEnv, mergedSchema, result)
  }

  /**
   * Evaluate an expression against a row
   */
  private evaluateExpression(expr: Expression, row: Row): any {
    switch (expr.type) {
      case 'column':
        return row[expr.name]

      case 'literal':
        return expr.value

      case 'star':
        return row

      case 'binary': {
        const left = this.evaluateExpression(expr.left, row)
        const right = this.evaluateExpression(expr.right, row)

        switch (expr.operator.toUpperCase()) {
          case '=':
          case '==':
            return left === right
          case '<>':
          case '!=':
            return left !== right
          case '>':
            return left > right
          case '>=':
            return left >= right
          case '<':
            return left < right
          case '<=':
            return left <= right
          case '+':
            return left + right
          case '-':
            return left - right
          case '*':
            return left * right
          case '/':
            return left / right
          case '%':
            return left % right
          case 'AND':
            return left && right
          case 'OR':
            return left || right
          case 'LIKE':
            return new RegExp('^' + String(right).replace(/%/g, '.*').replace(/_/g, '.') + '$').test(String(left))
          case 'IN':
            return Array.isArray(right) && right.includes(left)
          case 'IS':
            return left === right
          case 'IS NOT':
            return left !== right
          default:
            return null
        }
      }

      case 'unary': {
        const operand = this.evaluateExpression(expr.operand, row)
        switch (expr.operator.toUpperCase()) {
          case 'NOT':
            return !operand
          case '-':
            return -operand
          default:
            return operand
        }
      }

      case 'function': {
        const args = expr.args.map((a) => this.evaluateExpression(a, row))
        return this.evaluateFunction(expr.name, args)
      }

      default:
        return null
    }
  }

  /**
   * Evaluate a function
   */
  private evaluateFunction(name: string, args: any[]): any {
    switch (name.toUpperCase()) {
      case 'UPPER':
        return String(args[0]).toUpperCase()
      case 'LOWER':
        return String(args[0]).toLowerCase()
      case 'LENGTH':
        return String(args[0]).length
      case 'SUBSTRING':
        return String(args[0]).substring(args[1] - 1, args[2] ? args[1] - 1 + args[2] : undefined)
      case 'CONCAT':
        return args.join('')
      case 'ABS':
        return Math.abs(args[0])
      case 'FLOOR':
        return Math.floor(args[0])
      case 'CEIL':
      case 'CEILING':
        return Math.ceil(args[0])
      case 'ROUND':
        return Math.round(args[0])
      case 'COALESCE':
        return args.find((a) => a !== null && a !== undefined) ?? null
      case 'NULLIF':
        return args[0] === args[1] ? null : args[0]
      case 'CAST':
        return args[0] // Simplified
      case 'NOW':
      case 'CURRENT_TIMESTAMP':
        return new Date()
      case 'CURRENT_DATE':
        return new Date().toISOString().split('T')[0]
      default:
        return null
    }
  }

  /**
   * Convert expression to column name
   */
  private expressionToName(expr: Expression): string {
    if (expr.type === 'column') return expr.name
    if (expr.type === 'function') return `${expr.name}(${expr.args.map((a) => this.expressionToName(a)).join(', ')})`
    if (expr.type === 'literal') return String(expr.value)
    return 'expr'
  }
}

/**
 * Grouped table for aggregations
 */
export class GroupedTable {
  constructor(
    private tableEnv: TableEnvironment,
    private schema: Schema,
    private data: Row[],
    private groupColumns: string[]
  ) {}

  /**
   * Select with aggregations
   */
  select(...expressions: (ExpressionBuilder | string)[]): Table {
    // Group the data
    const groups = new Map<string, Row[]>()
    for (const row of this.data) {
      const key = this.groupColumns.map((c) => row[c]).join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    // Aggregate each group
    const result: Row[] = []
    for (const [key, rows] of groups) {
      const newRow: Row = {}

      // Add group columns
      for (const col of this.groupColumns) {
        newRow[col] = rows[0][col]
      }

      // Evaluate expressions
      for (const expr of expressions) {
        if (typeof expr === 'string') {
          if (this.groupColumns.includes(expr)) {
            newRow[expr] = rows[0][expr]
          }
        } else {
          const e = expr.getExpression()
          const name = this.expressionToName(e)
          newRow[name] = this.evaluateAggregateExpression(e, rows)
        }
      }

      result.push(newRow)
    }

    const newColumns = Object.keys(result[0] || {}).map((name) => ({
      name,
      type: DataType.STRING(),
    }))
    const newSchema = new Schema()
    for (const col of newColumns) {
      newSchema.addColumn(col.name, col.type)
    }

    return new Table(this.tableEnv, newSchema, result)
  }

  /**
   * Evaluate aggregate expression
   */
  private evaluateAggregateExpression(expr: Expression, rows: Row[]): any {
    if (expr.type === 'column') {
      return rows[0][expr.name]
    }

    if (expr.type === 'function') {
      const values = rows.map((row) => {
        if (expr.args.length > 0 && expr.args[0].type === 'column') {
          return row[(expr.args[0] as ColumnRef).name]
        }
        return 1 // For COUNT(*)
      }).filter((v) => v !== null && v !== undefined)

      switch (expr.name.toUpperCase()) {
        case 'COUNT':
          return values.length
        case 'SUM':
          return values.reduce((a, b) => a + b, 0)
        case 'AVG':
          return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
        case 'MIN':
          return values.length > 0 ? Math.min(...values) : null
        case 'MAX':
          return values.length > 0 ? Math.max(...values) : null
        default:
          return null
      }
    }

    return null
  }

  /**
   * Convert expression to column name
   */
  private expressionToName(expr: Expression): string {
    if (expr.type === 'column') return expr.name
    if (expr.type === 'function') {
      const argsStr = expr.args.map((a) => this.expressionToName(a)).join(', ')
      return `${expr.name}(${argsStr})`
    }
    if (expr.type === 'literal') return String(expr.value)
    return 'expr'
  }
}

// ===========================================================================
// Table Result
// ===========================================================================

/**
 * Result of table execution
 */
export class TableResult {
  private iterator: Row[]
  private index = 0

  constructor(
    private schema: Schema,
    private data: Row[]
  ) {
    this.iterator = data
  }

  /**
   * Get result kind
   */
  getResultKind(): 'SUCCESS' | 'SUCCESS_WITH_CONTENT' {
    return this.data.length > 0 ? 'SUCCESS_WITH_CONTENT' : 'SUCCESS'
  }

  /**
   * Get schema
   */
  getSchema(): Schema {
    return this.schema
  }

  /**
   * Collect results
   */
  collect(): Row[] {
    return [...this.data]
  }

  /**
   * Iterator interface
   */
  next(): { value: Row | undefined; done: boolean } {
    if (this.index < this.data.length) {
      return { value: this.data[this.index++], done: false }
    }
    return { value: undefined, done: true }
  }

  /**
   * Print to console
   */
  print(): void {
    const columns = this.schema.getColumns()

    // Header
    console.log(columns.map((c) => c.name).join('\t'))
    console.log(columns.map(() => '---').join('\t'))

    // Rows
    for (const row of this.data) {
      console.log(columns.map((c) => row[c.name]).join('\t'))
    }
  }

  /**
   * Await completion (for async execution)
   */
  async await(): Promise<void> {
    // Synchronous for now
  }
}

// ===========================================================================
// Catalog
// ===========================================================================

/**
 * Database in a catalog
 */
export class Database {
  private tables = new Map<string, { schema: Schema; options: Map<string, string>; data: Row[] }>()
  private views = new Map<string, { definition: string; schema: Schema }>()

  constructor(public readonly name: string) {}

  createTable(name: string, schema: Schema, options: Map<string, string>): void {
    this.tables.set(name, { schema, options, data: [] })
  }

  dropTable(name: string): void {
    this.tables.delete(name)
  }

  getTable(name: string): { schema: Schema; options: Map<string, string>; data: Row[] } | undefined {
    return this.tables.get(name)
  }

  listTables(): string[] {
    return Array.from(this.tables.keys())
  }

  tableExists(name: string): boolean {
    return this.tables.has(name)
  }

  createView(name: string, definition: string, schema: Schema): void {
    this.views.set(name, { definition, schema })
  }

  dropView(name: string): void {
    this.views.delete(name)
  }

  getView(name: string): { definition: string; schema: Schema } | undefined {
    return this.views.get(name)
  }

  listViews(): string[] {
    return Array.from(this.views.keys())
  }

  viewExists(name: string): boolean {
    return this.views.has(name)
  }

  insertData(tableName: string, rows: Row[]): void {
    const table = this.tables.get(tableName)
    if (table) {
      table.data.push(...rows)
    }
  }

  getTableData(tableName: string): Row[] {
    return this.tables.get(tableName)?.data ?? []
  }
}

/**
 * Catalog for managing databases and tables
 */
export class Catalog {
  private databases = new Map<string, Database>()

  constructor(public readonly name: string) {
    // Create default database
    this.databases.set('default', new Database('default'))
  }

  createDatabase(name: string): void {
    if (!this.databases.has(name)) {
      this.databases.set(name, new Database(name))
    }
  }

  dropDatabase(name: string): void {
    this.databases.delete(name)
  }

  getDatabase(name: string): Database | undefined {
    return this.databases.get(name)
  }

  listDatabases(): string[] {
    return Array.from(this.databases.keys())
  }

  databaseExists(name: string): boolean {
    return this.databases.has(name)
  }
}

// ===========================================================================
// Table Environment
// ===========================================================================

/**
 * Configuration for TableEnvironment
 */
export class EnvironmentSettings {
  private streamingMode = true
  private configOptions = new Map<string, string>()

  static newInstance(): EnvironmentSettingsBuilder {
    return new EnvironmentSettingsBuilder()
  }

  isStreamingMode(): boolean {
    return this.streamingMode
  }

  setStreamingMode(mode: boolean): void {
    this.streamingMode = mode
  }

  getConfiguration(): Map<string, string> {
    return this.configOptions
  }
}

export class EnvironmentSettingsBuilder {
  private settings = new EnvironmentSettings()

  inStreamingMode(): EnvironmentSettingsBuilder {
    this.settings.setStreamingMode(true)
    return this
  }

  inBatchMode(): EnvironmentSettingsBuilder {
    this.settings.setStreamingMode(false)
    return this
  }

  withConfiguration(key: string, value: string): EnvironmentSettingsBuilder {
    this.settings.getConfiguration().set(key, value)
    return this
  }

  build(): EnvironmentSettings {
    return this.settings
  }
}

/**
 * Table Environment - main entry point for Flink SQL
 */
export class TableEnvironment {
  private catalogs = new Map<string, Catalog>()
  private currentCatalog = 'default_catalog'
  private currentDatabase = 'default'
  private temporaryTables = new Map<string, Table>()
  private configuration = new Map<string, string>()
  private streamEnv?: StreamExecutionEnvironment

  private constructor(private settings?: EnvironmentSettings) {
    // Create default catalog
    this.catalogs.set('default_catalog', new Catalog('default_catalog'))
  }

  /**
   * Create a TableEnvironment
   */
  static create(settings?: EnvironmentSettings): TableEnvironment {
    return new TableEnvironment(settings)
  }

  /**
   * Create from StreamExecutionEnvironment
   */
  static createFromStreamEnv(env: StreamExecutionEnvironment): StreamTableEnvironment {
    return StreamTableEnvironment.create(env)
  }

  /**
   * Get configuration
   */
  getConfig(): Map<string, string> {
    return this.configuration
  }

  /**
   * Register a catalog
   */
  registerCatalog(name: string, catalog: Catalog): void {
    this.catalogs.set(name, catalog)
  }

  /**
   * Get catalog
   */
  getCatalog(name: string): Catalog | undefined {
    return this.catalogs.get(name)
  }

  /**
   * List catalogs
   */
  listCatalogs(): string[] {
    return Array.from(this.catalogs.keys())
  }

  /**
   * Use catalog
   */
  useCatalog(name: string): void {
    if (!this.catalogs.has(name)) {
      throw new Error(`Catalog '${name}' does not exist`)
    }
    this.currentCatalog = name
  }

  /**
   * Get current catalog
   */
  getCurrentCatalog(): string {
    return this.currentCatalog
  }

  /**
   * Use database
   */
  useDatabase(name: string): void {
    const catalog = this.catalogs.get(this.currentCatalog)
    if (!catalog?.databaseExists(name)) {
      throw new Error(`Database '${name}' does not exist in catalog '${this.currentCatalog}'`)
    }
    this.currentDatabase = name
  }

  /**
   * Get current database
   */
  getCurrentDatabase(): string {
    return this.currentDatabase
  }

  /**
   * List databases
   */
  listDatabases(): string[] {
    return this.catalogs.get(this.currentCatalog)?.listDatabases() ?? []
  }

  /**
   * List tables
   */
  listTables(): string[] {
    const catalog = this.catalogs.get(this.currentCatalog)
    const db = catalog?.getDatabase(this.currentDatabase)
    const persistentTables = db?.listTables() ?? []
    const tempTables = Array.from(this.temporaryTables.keys())
    return [...new Set([...persistentTables, ...tempTables])]
  }

  /**
   * List views
   */
  listViews(): string[] {
    const catalog = this.catalogs.get(this.currentCatalog)
    const db = catalog?.getDatabase(this.currentDatabase)
    return db?.listViews() ?? []
  }

  /**
   * Execute a SQL statement
   */
  executeSql(sql: string): TableResult {
    const statement = SqlParser.parse(sql)
    return this.executeStatement(statement)
  }

  /**
   * Execute a parsed statement
   */
  private executeStatement(statement: ParsedStatement): TableResult {
    const catalog = this.catalogs.get(this.currentCatalog)!
    const db = catalog.getDatabase(this.currentDatabase)!

    switch (statement.type) {
      case StatementType.CREATE_TABLE: {
        if (statement.tableName && statement.schema) {
          if (db.tableExists(statement.tableName) && !statement.ifNotExists) {
            throw new Error(`Table '${statement.tableName}' already exists`)
          }
          db.createTable(statement.tableName, statement.schema, statement.withOptions ?? new Map())
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.CREATE_VIEW: {
        if (statement.tableName && statement.viewDefinition) {
          if (db.viewExists(statement.tableName) && !statement.ifNotExists) {
            throw new Error(`View '${statement.tableName}' already exists`)
          }
          db.createView(statement.tableName, statement.viewDefinition, new Schema())
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.CREATE_DATABASE: {
        if (statement.databaseName) {
          if (catalog.databaseExists(statement.databaseName) && !statement.ifNotExists) {
            throw new Error(`Database '${statement.databaseName}' already exists`)
          }
          catalog.createDatabase(statement.databaseName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.CREATE_CATALOG: {
        if (statement.catalogName) {
          if (this.catalogs.has(statement.catalogName) && !statement.ifNotExists) {
            throw new Error(`Catalog '${statement.catalogName}' already exists`)
          }
          this.catalogs.set(statement.catalogName, new Catalog(statement.catalogName))
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.DROP_TABLE: {
        if (statement.tableName) {
          if (!db.tableExists(statement.tableName) && !statement.ifExists) {
            throw new Error(`Table '${statement.tableName}' does not exist`)
          }
          db.dropTable(statement.tableName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.DROP_VIEW: {
        if (statement.tableName) {
          if (!db.viewExists(statement.tableName) && !statement.ifExists) {
            throw new Error(`View '${statement.tableName}' does not exist`)
          }
          db.dropView(statement.tableName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.DROP_DATABASE: {
        if (statement.databaseName) {
          if (!catalog.databaseExists(statement.databaseName) && !statement.ifExists) {
            throw new Error(`Database '${statement.databaseName}' does not exist`)
          }
          catalog.dropDatabase(statement.databaseName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.USE_CATALOG: {
        if (statement.catalogName) {
          this.useCatalog(statement.catalogName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.USE_DATABASE: {
        if (statement.databaseName) {
          this.useDatabase(statement.databaseName)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.SHOW_TABLES: {
        const tables = this.listTables()
        const schema = Schema.newBuilder().column('table_name', DataType.STRING()).build()
        return new TableResult(schema, tables.map((t) => ({ table_name: t })))
      }

      case StatementType.SHOW_DATABASES: {
        const databases = this.listDatabases()
        const schema = Schema.newBuilder().column('database_name', DataType.STRING()).build()
        return new TableResult(schema, databases.map((d) => ({ database_name: d })))
      }

      case StatementType.SHOW_CATALOGS: {
        const catalogs = this.listCatalogs()
        const schema = Schema.newBuilder().column('catalog_name', DataType.STRING()).build()
        return new TableResult(schema, catalogs.map((c) => ({ catalog_name: c })))
      }

      case StatementType.DESCRIBE: {
        if (statement.tableName) {
          const tableInfo = db.getTable(statement.tableName)
          if (!tableInfo) {
            throw new Error(`Table '${statement.tableName}' does not exist`)
          }
          const schema = Schema.newBuilder()
            .column('name', DataType.STRING())
            .column('type', DataType.STRING())
            .column('nullable', DataType.BOOLEAN())
            .build()
          const rows = tableInfo.schema.getColumns().map((c) => ({
            name: c.name,
            type: c.type.toString(),
            nullable: c.type.nullable,
          }))
          return new TableResult(schema, rows)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.INSERT: {
        if (statement.tableName && statement.selectStatement) {
          const selectResult = this.executeStatement(statement.selectStatement)
          const rows = selectResult.collect()
          db.insertData(statement.tableName, rows)
        }
        return new TableResult(new Schema(), [])
      }

      case StatementType.SELECT: {
        return this.executeSelect(statement)
      }

      case StatementType.EXPLAIN: {
        if (statement.selectStatement) {
          const plan = this.explainStatement(statement.selectStatement)
          const schema = Schema.newBuilder().column('plan', DataType.STRING()).build()
          return new TableResult(schema, [{ plan }])
        }
        return new TableResult(new Schema(), [])
      }

      default:
        return new TableResult(new Schema(), [])
    }
  }

  /**
   * Execute SELECT statement
   */
  private executeSelect(statement: ParsedStatement): TableResult {
    const catalog = this.catalogs.get(this.currentCatalog)!
    const db = catalog.getDatabase(this.currentDatabase)!

    // Get source table
    let data: Row[] = []
    let schema = new Schema()

    if (statement.tableName) {
      // Check temporary tables first
      if (this.temporaryTables.has(statement.tableName)) {
        const table = this.temporaryTables.get(statement.tableName)!
        data = table.getData()
        schema = table.getSchema()
      } else {
        const tableInfo = db.getTable(statement.tableName)
        if (tableInfo) {
          data = tableInfo.data
          schema = tableInfo.schema
        } else {
          // Check for view
          const viewInfo = db.getView(statement.tableName)
          if (viewInfo) {
            const viewResult = this.executeSql(viewInfo.definition)
            data = viewResult.collect()
            schema = viewResult.getSchema()
          }
        }
      }
    }

    // Apply WHERE clause
    if (statement.whereClause) {
      data = data.filter((row) => this.evaluateExpression(statement.whereClause!, row))
    }

    // Apply GROUP BY
    if (statement.groupByColumns && statement.groupByColumns.length > 0) {
      data = this.applyGroupBy(data, statement.groupByColumns, statement.selectExpressions || [])
    }

    // Apply HAVING
    if (statement.havingClause) {
      data = data.filter((row) => this.evaluateExpression(statement.havingClause!, row))
    }

    // Apply SELECT projections (if not grouped)
    if (!statement.groupByColumns && statement.selectExpressions) {
      data = this.applySelect(data, statement.selectExpressions)
    }

    // Apply ORDER BY
    if (statement.orderByColumns) {
      data = this.applyOrderBy(data, statement.orderByColumns)
    }

    // Apply LIMIT
    if (statement.limit !== undefined) {
      data = data.slice(0, statement.limit)
    }

    // Build result schema
    if (statement.columns && statement.columns.length > 0) {
      schema = new Schema()
      for (const col of statement.columns) {
        schema.addColumn(col, DataType.STRING())
      }
    }

    return new TableResult(schema, data)
  }

  /**
   * Apply SELECT projections
   */
  private applySelect(data: Row[], expressions: SelectExpression[]): Row[] {
    return data.map((row) => {
      const newRow: Row = {}
      for (const { expression, alias } of expressions) {
        if (expression.type === 'star') {
          Object.assign(newRow, row)
        } else {
          const value = this.evaluateExpression(expression, row)
          const name = alias || this.expressionToName(expression)
          newRow[name] = value
        }
      }
      return newRow
    })
  }

  /**
   * Apply GROUP BY
   */
  private applyGroupBy(data: Row[], groupColumns: string[], selectExprs: SelectExpression[]): Row[] {
    const groups = new Map<string, Row[]>()

    for (const row of data) {
      const key = groupColumns.map((c) => row[c]).join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    const result: Row[] = []
    for (const rows of groups.values()) {
      const newRow: Row = {}

      // Add group columns
      for (const col of groupColumns) {
        newRow[col] = rows[0][col]
      }

      // Evaluate aggregate expressions
      for (const { expression, alias } of selectExprs) {
        const name = alias || this.expressionToName(expression)
        if (expression.type === 'column' && groupColumns.includes(expression.name)) {
          newRow[name] = rows[0][expression.name]
        } else if (expression.type === 'function') {
          newRow[name] = this.evaluateAggregate(expression, rows)
        }
      }

      result.push(newRow)
    }

    return result
  }

  /**
   * Apply ORDER BY
   */
  private applyOrderBy(data: Row[], orderBy: OrderByColumn[]): Row[] {
    return [...data].sort((a, b) => {
      for (const { expression, ascending } of orderBy) {
        const aVal = this.evaluateExpression(expression, a)
        const bVal = this.evaluateExpression(expression, b)
        if (aVal < bVal) return ascending ? -1 : 1
        if (aVal > bVal) return ascending ? 1 : -1
      }
      return 0
    })
  }

  /**
   * Evaluate aggregate function
   */
  private evaluateAggregate(expr: FunctionCall, rows: Row[]): any {
    const values = rows
      .map((row) => {
        if (expr.args.length > 0) {
          return this.evaluateExpression(expr.args[0], row)
        }
        return 1
      })
      .filter((v) => v !== null && v !== undefined)

    switch (expr.name.toUpperCase()) {
      case 'COUNT':
        return values.length
      case 'SUM':
        return values.reduce((a, b) => a + b, 0)
      case 'AVG':
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
      case 'MIN':
        return values.length > 0 ? Math.min(...values) : null
      case 'MAX':
        return values.length > 0 ? Math.max(...values) : null
      default:
        return null
    }
  }

  /**
   * Evaluate expression
   */
  private evaluateExpression(expr: Expression, row: Row): any {
    switch (expr.type) {
      case 'column':
        return row[expr.name]
      case 'literal':
        return expr.value
      case 'star':
        return row
      case 'binary': {
        const left = this.evaluateExpression(expr.left, row)
        const right = this.evaluateExpression(expr.right, row)
        switch (expr.operator.toUpperCase()) {
          case '=':
          case '==':
            return left === right
          case '<>':
          case '!=':
            return left !== right
          case '>':
            return left > right
          case '>=':
            return left >= right
          case '<':
            return left < right
          case '<=':
            return left <= right
          case '+':
            return left + right
          case '-':
            return left - right
          case '*':
            return left * right
          case '/':
            return left / right
          case 'AND':
            return left && right
          case 'OR':
            return left || right
          default:
            return null
        }
      }
      case 'function':
        return this.evaluateAggregate(expr, [row])
      default:
        return null
    }
  }

  /**
   * Expression to name
   */
  private expressionToName(expr: Expression): string {
    if (expr.type === 'column') return expr.name
    if (expr.type === 'function') return `${expr.name}(${expr.args.map((a) => this.expressionToName(a)).join(', ')})`
    if (expr.type === 'literal') return String(expr.value)
    return 'expr'
  }

  /**
   * Generate execution plan explanation
   */
  private explainStatement(statement: ParsedStatement): string {
    const lines: string[] = ['== Physical Plan ==']

    if (statement.tableName) {
      lines.push(`Scan(table=[${statement.tableName}])`)
    }

    if (statement.whereClause) {
      lines.push(`Filter(condition=[...])`)
    }

    if (statement.groupByColumns) {
      lines.push(`Aggregate(group=[${statement.groupByColumns.join(', ')}])`)
    }

    if (statement.selectExpressions) {
      lines.push(`Project(...)`)
    }

    if (statement.orderByColumns) {
      lines.push(`Sort(...)`)
    }

    if (statement.limit) {
      lines.push(`Limit(${statement.limit})`)
    }

    return lines.join('\n')
  }

  /**
   * SQL query - returns a Table
   */
  sqlQuery(sql: string): Table {
    const result = this.executeSql(sql)
    return new Table(this, result.getSchema(), result.collect())
  }

  /**
   * Create table from DataStream
   */
  fromDataStream<T>(dataStream: DataStream<T>): Table {
    const elements = dataStream.getElements()
    const columns = elements.length > 0 ? Object.keys(elements[0] as object) : []

    const schema = new Schema()
    for (const col of columns) {
      schema.addColumn(col, DataType.STRING())
    }

    return new Table(this, schema, elements as Row[])
  }

  /**
   * Register a table
   */
  createTemporaryView(name: string, table: Table): void {
    this.temporaryTables.set(name, table)
  }

  /**
   * Register a table (alias)
   */
  registerTable(name: string, table: Table): void {
    this.createTemporaryView(name, table)
  }

  /**
   * Get a registered table
   */
  from(name: string): Table {
    if (this.temporaryTables.has(name)) {
      return this.temporaryTables.get(name)!
    }

    const catalog = this.catalogs.get(this.currentCatalog)
    const db = catalog?.getDatabase(this.currentDatabase)
    const tableInfo = db?.getTable(name)

    if (tableInfo) {
      return new Table(this, tableInfo.schema, tableInfo.data)
    }

    throw new Error(`Table '${name}' not found`)
  }

  /**
   * Drop temporary table
   */
  dropTemporaryTable(name: string): void {
    this.temporaryTables.delete(name)
  }

  /**
   * Drop temporary view
   */
  dropTemporaryView(name: string): void {
    this.temporaryTables.delete(name)
  }
}

// ===========================================================================
// Stream Table Environment
// ===========================================================================

/**
 * StreamTableEnvironment for stream-based Table API
 */
export class StreamTableEnvironment extends TableEnvironment {
  private streamEnv: StreamExecutionEnvironment

  private constructor(env: StreamExecutionEnvironment) {
    super()
    this.streamEnv = env
  }

  /**
   * Create from StreamExecutionEnvironment
   */
  static create(env: StreamExecutionEnvironment, settings?: EnvironmentSettings): StreamTableEnvironment {
    return new StreamTableEnvironment(env)
  }

  /**
   * Get underlying StreamExecutionEnvironment
   */
  getStreamExecutionEnvironment(): StreamExecutionEnvironment {
    return this.streamEnv
  }

  /**
   * Convert DataStream to Table
   */
  fromDataStream<T>(dataStream: DataStream<T>, schema?: Schema): Table {
    const elements = dataStream.getElements()
    const columns = elements.length > 0 ? Object.keys(elements[0] as object) : []

    const tableSchema = schema ?? new Schema()
    if (!schema) {
      for (const col of columns) {
        tableSchema.addColumn(col, DataType.STRING())
      }
    }

    return new Table(this, tableSchema, elements as Row[])
  }

  /**
   * Convert Table to DataStream
   */
  toDataStream<T>(table: Table): DataStream<T> {
    return table.toDataStream<T>(this.streamEnv)
  }

  /**
   * Convert Table to changelog DataStream
   */
  toChangelogStream<T>(table: Table): DataStream<T> {
    return table.toChangelogStream<T>(this.streamEnv)
  }

  /**
   * Create table from changelog DataStream
   */
  fromChangelogStream<T>(dataStream: DataStream<T>, schema?: Schema): Table {
    return this.fromDataStream(dataStream, schema)
  }
}

// ===========================================================================
// Exports
// ===========================================================================

export {
  TableEnvironment,
  StreamTableEnvironment,
  Table,
  TableResult,
  Schema,
  SchemaBuilder,
  DataType,
  DataTypes,
  SqlParser,
  SqlParseError,
  Catalog,
  Database,
  EnvironmentSettings,
  EnvironmentSettingsBuilder,
  $,
  lit,
  ExpressionBuilder,
  GroupedTable,
  Row,
}
