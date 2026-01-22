/**
 * Document Query Builder
 *
 * Converts MongoDB-style queries to ClickHouse SQL for document operations.
 * Supports common operators like $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin,
 * $exists, $regex, $and, $or, $not.
 *
 * @example
 * ```typescript
 * const builder = new DocumentQueryBuilder({ collection: 'users' });
 * const sql = builder.filter({ age: { $gt: 18 } }).limit(10).build();
 * // SELECT * FROM users FINAL WHERE age > 18 LIMIT 10
 * ```
 *
 * @module query-builder
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Filter value types supported in queries
 */
export type FilterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | FilterValue[]
  | { [key: string]: FilterValue };

/**
 * Operator expressions for field conditions
 */
export interface OperatorExpression {
  $eq?: FilterValue;
  $ne?: FilterValue;
  $gt?: FilterValue;
  $gte?: FilterValue;
  $lt?: FilterValue;
  $lte?: FilterValue;
  $in?: FilterValue[];
  $nin?: FilterValue[];
  $exists?: boolean;
  $regex?: string;
}

/**
 * Field condition - either a direct value or an operator expression
 */
export type FieldCondition = FilterValue | OperatorExpression;

/**
 * Filter object for queries
 */
export interface FilterObject {
  $and?: FilterObject[];
  $or?: FilterObject[];
  $not?: FilterObject;
  [field: string]: FieldCondition | FilterObject[] | FilterObject | undefined;
}

/**
 * Sort direction
 */
export type OrderDirection = 'ASC' | 'DESC' | 1 | -1;

/**
 * Options for the DocumentQueryBuilder
 */
export interface DocumentQueryBuilderOptions {
  /**
   * Collection (table) name
   */
  collection: string;

  /**
   * Database name (default: 'default')
   */
  database?: string;

  /**
   * Whether to include FINAL keyword for ReplacingMergeTree (default: true)
   */
  useFinal?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Escape a SQL identifier (table/column name)
 */
function escapeIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

/**
 * Escape a SQL string value
 */
function escapeString(value: string): string {
  return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

/**
 * Convert a filter value to SQL
 */
function valueToSql(value: FilterValue): string {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return escapeString(value);
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (value instanceof Date) {
    return `toDateTime64('${value.toISOString()}', 3)`;
  }

  if (Array.isArray(value)) {
    const items = value.map(v => valueToSql(v)).join(', ');
    return `[${items}]`;
  }

  // Object value - convert to JSON string
  return escapeString(JSON.stringify(value));
}

/**
 * Build a field path expression for nested JSON fields
 * Uses JSONExtract for type-safe access
 */
function buildFieldPath(field: string): string {
  const parts = field.split('.');

  // If it's a simple field, check if it's a known column
  if (parts.length === 1) {
    const knownColumns = ['id', '_version', 'created_at', 'updated_at', '_deleted'];
    if (knownColumns.includes(field)) {
      return escapeIdentifier(field);
    }
    // Otherwise assume it's in the data JSON column
    return `JSONExtractRaw(data, ${escapeString(field)})`;
  }

  // For nested paths, use JSONExtractRaw with path
  const pathArgs = parts.map(p => escapeString(p)).join(', ');
  return `JSONExtractRaw(data, ${pathArgs})`;
}

/**
 * Check if an object is an operator expression
 */
function isOperatorExpression(obj: unknown): obj is OperatorExpression {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const keys = Object.keys(obj);
  return keys.length > 0 && keys.every(k => k.startsWith('$'));
}

// =============================================================================
// DocumentQueryBuilder Class
// =============================================================================

/**
 * Document Query Builder
 *
 * Builds SQL queries from MongoDB-style filter objects.
 */
export class DocumentQueryBuilder {
  private options: Required<DocumentQueryBuilderOptions>;
  private conditions: string[] = [];
  private orderByClauses: string[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private selectFields: string[] = ['*'];

  constructor(options: DocumentQueryBuilderOptions) {
    this.options = {
      collection: options.collection,
      database: options.database || 'default',
      useFinal: options.useFinal !== false,
    };
  }

  /**
   * Add a filter to the query
   */
  filter(filterObj: FilterObject): this {
    const condition = this.buildFilterCondition(filterObj);
    if (condition) {
      this.conditions.push(condition);
    }
    return this;
  }

  /**
   * Add a WHERE condition for a specific ID
   */
  whereId(id: string): this {
    this.conditions.push(`id = ${escapeString(id)}`);
    return this;
  }

  /**
   * Exclude deleted documents (for soft delete pattern)
   */
  notDeleted(): this {
    this.conditions.push('_deleted = 0');
    return this;
  }

  /**
   * Set the fields to select
   */
  select(...fields: string[]): this {
    if (fields.length > 0) {
      this.selectFields = fields.map(f => {
        if (f === '*') return '*';
        return buildFieldPath(f);
      });
    }
    return this;
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(field: string, direction: OrderDirection = 'ASC'): this {
    const dir = (direction === 1 || direction === 'ASC') ? 'ASC' : 'DESC';
    this.orderByClauses.push(`${buildFieldPath(field)} ${dir}`);
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  /**
   * Skip (alias for offset)
   */
  skip(count: number): this {
    return this.offset(count);
  }

  /**
   * Build the SQL SELECT query
   */
  build(): string {
    const tableName = `${escapeIdentifier(this.options.database)}.${escapeIdentifier(this.options.collection)}`;
    const final = this.options.useFinal ? ' FINAL' : '';

    let sql = `SELECT ${this.selectFields.join(', ')} FROM ${tableName}${final}`;

    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(' AND ')}`;
    }

    if (this.orderByClauses.length > 0) {
      sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
    }

    if (this.limitValue !== null) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    if (this.offsetValue !== null) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return sql;
  }

  /**
   * Build an INSERT query for a document
   */
  buildInsert(document: Record<string, unknown>, options?: { id?: string }): string {
    const tableName = `${escapeIdentifier(this.options.database)}.${escapeIdentifier(this.options.collection)}`;

    const id = options?.id || document._id || this.generateId();
    const data = JSON.stringify(document);

    return `INSERT INTO ${tableName} (id, data) FORMAT JSONEachRow ${JSON.stringify({ id, data })}`;
  }

  /**
   * Build an INSERT query for upsert (update via ReplacingMergeTree)
   */
  buildUpsert(id: string, document: Record<string, unknown>): string {
    const tableName = `${escapeIdentifier(this.options.database)}.${escapeIdentifier(this.options.collection)}`;

    const data = JSON.stringify(document);

    return `INSERT INTO ${tableName} (id, data, _version) FORMAT JSONEachRow ${JSON.stringify({
      id,
      data,
      _version: Date.now(),
    })}`;
  }

  /**
   * Build a soft delete query (insert with _deleted = 1)
   */
  buildSoftDelete(id: string): string {
    const tableName = `${escapeIdentifier(this.options.database)}.${escapeIdentifier(this.options.collection)}`;

    return `INSERT INTO ${tableName} (id, _deleted, _version) FORMAT JSONEachRow ${JSON.stringify({
      id,
      _deleted: 1,
      _version: Date.now(),
    })}`;
  }

  /**
   * Build a count query
   */
  buildCount(): string {
    const tableName = `${escapeIdentifier(this.options.database)}.${escapeIdentifier(this.options.collection)}`;
    const final = this.options.useFinal ? ' FINAL' : '';

    let sql = `SELECT count() as count FROM ${tableName}${final}`;

    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(' AND ')}`;
    }

    return sql;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Build a SQL condition from a filter object
   */
  private buildFilterCondition(filterObj: FilterObject): string | null {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(filterObj)) {
      if (value === undefined) continue;

      // Handle logical operators
      if (key === '$and') {
        const andConditions = (value as FilterObject[])
          .map(f => this.buildFilterCondition(f))
          .filter((c): c is string => c !== null);
        if (andConditions.length > 0) {
          conditions.push(`(${andConditions.join(' AND ')})`);
        }
        continue;
      }

      if (key === '$or') {
        const orConditions = (value as FilterObject[])
          .map(f => this.buildFilterCondition(f))
          .filter((c): c is string => c !== null);
        if (orConditions.length > 0) {
          conditions.push(`(${orConditions.join(' OR ')})`);
        }
        continue;
      }

      if (key === '$not') {
        const notCondition = this.buildFilterCondition(value as FilterObject);
        if (notCondition) {
          conditions.push(`NOT (${notCondition})`);
        }
        continue;
      }

      // Handle field conditions
      const fieldPath = buildFieldPath(key);

      if (isOperatorExpression(value)) {
        const fieldCondition = this.buildOperatorCondition(fieldPath, value);
        if (fieldCondition) {
          conditions.push(fieldCondition);
        }
      } else {
        // Direct equality
        conditions.push(`${fieldPath} = ${valueToSql(value as FilterValue)}`);
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  /**
   * Build a SQL condition from an operator expression
   */
  private buildOperatorCondition(field: string, expr: OperatorExpression): string | null {
    const conditions: string[] = [];

    if (expr.$eq !== undefined) {
      conditions.push(`${field} = ${valueToSql(expr.$eq)}`);
    }

    if (expr.$ne !== undefined) {
      conditions.push(`${field} != ${valueToSql(expr.$ne)}`);
    }

    if (expr.$gt !== undefined) {
      conditions.push(`${field} > ${valueToSql(expr.$gt)}`);
    }

    if (expr.$gte !== undefined) {
      conditions.push(`${field} >= ${valueToSql(expr.$gte)}`);
    }

    if (expr.$lt !== undefined) {
      conditions.push(`${field} < ${valueToSql(expr.$lt)}`);
    }

    if (expr.$lte !== undefined) {
      conditions.push(`${field} <= ${valueToSql(expr.$lte)}`);
    }

    if (expr.$in !== undefined) {
      const values = expr.$in.map(v => valueToSql(v)).join(', ');
      conditions.push(`${field} IN (${values})`);
    }

    if (expr.$nin !== undefined) {
      const values = expr.$nin.map(v => valueToSql(v)).join(', ');
      conditions.push(`${field} NOT IN (${values})`);
    }

    if (expr.$exists !== undefined) {
      if (expr.$exists) {
        conditions.push(`${field} IS NOT NULL`);
      } else {
        conditions.push(`${field} IS NULL`);
      }
    }

    if (expr.$regex !== undefined) {
      conditions.push(`match(${field}, ${escapeString(expr.$regex)})`);
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  /**
   * Generate a unique document ID (ObjectId-style)
   */
  private generateId(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
    const random = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    return timestamp + random;
  }
}
