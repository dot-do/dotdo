/**
 * Cross-Column Expectations - Referential Integrity Validation for Data Contracts
 *
 * Provides validation for relationships between columns:
 * - Foreign key validation: column('user_id').toExistIn('users', 'id')
 * - Cross-column comparisons: column('end_date').toBeGreaterThan('start_date')
 * - Conditional expectations: when('status').equals('active').then('end_date').toBeNull()
 * - Composite key validation: columns(['org_id', 'user_id']).toBeUniqueComposite()
 * - Arithmetic expressions: column('total').toEqual(sum('subtotal', 'tax'))
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Comparison operators for cross-column comparisons
 */
export type ComparisonOperator =
  | 'equal'
  | 'not_equal'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'

/**
 * Arithmetic operators for computed column validation
 */
export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide'

/**
 * Arithmetic expression operand - can be column name, literal value, or nested expression
 */
export type ArithmeticOperand =
  | { type: 'column'; name: string }
  | { type: 'literal'; value: number }
  | { type: 'expression'; expr: ArithmeticExpression }

/**
 * Arithmetic expression for computed column validation
 */
export interface ArithmeticExpression {
  operator: ArithmeticOperator
  operands: ArithmeticOperand[]
}

/**
 * Condition for conditional expectations
 */
export interface Condition {
  column: string
  operator: ComparisonOperator | 'in' | 'not_in' | 'is_null' | 'is_not_null'
  value?: unknown
}

/**
 * Foreign key reference definition
 */
export interface ForeignKeyReference {
  /** Name of the reference table/dataset */
  referenceTable: string
  /** Column name in the reference table */
  referenceColumn: string
  /** Whether null values are allowed in the source column */
  allowNull?: boolean
}

/**
 * Enum reference for categorical validation
 */
export interface EnumReference {
  /** Name of the enum/reference table */
  enumName: string
  /** Column containing enum values (if from a table) */
  valueColumn?: string
}

/**
 * Cross-column expectation types
 */
export type CrossColumnExpectationType =
  | 'foreign_key'
  | 'cross_column_comparison'
  | 'conditional'
  | 'composite_unique'
  | 'computed_value'
  | 'enum_reference'

/**
 * Single cross-column expectation
 */
export interface CrossColumnExpectation {
  type: CrossColumnExpectationType
  /** Source column(s) being validated */
  columns: string[]
  /** Foreign key reference (for foreign_key type) */
  foreignKey?: ForeignKeyReference
  /** Comparison details (for cross_column_comparison type) */
  comparison?: {
    operator: ComparisonOperator
    targetColumn: string
  }
  /** Condition for conditional expectations */
  condition?: Condition
  /** Then clause for conditional expectations */
  thenExpectation?: Omit<CrossColumnExpectation, 'condition'>
  /** Arithmetic expression (for computed_value type) */
  expression?: ArithmeticExpression
  /** Enum reference (for enum_reference type) */
  enumRef?: EnumReference
  /** Tolerance for numeric comparisons */
  tolerance?: number
  /** Custom error message */
  message?: string
}

/**
 * Cross-column expectation failure
 */
export interface CrossColumnExpectationFailure {
  type: CrossColumnExpectationType
  columns: string[]
  message: string
  rowIndex?: number
  actualValues?: Record<string, unknown>
  expectedValue?: unknown
}

/**
 * Cross-column validation result
 */
export interface CrossColumnValidationResult {
  passed: boolean
  failures: CrossColumnExpectationFailure[]
  expectationsChecked: number
  timing: {
    totalMs: number
    lookupBuildMs?: number
  }
}

/**
 * Reference data for foreign key lookups
 */
export type ReferenceData = Record<string, Record<string, unknown>[]>

/**
 * Lookup index for efficient foreign key validation
 */
export type LookupIndex = Map<string, Set<unknown>>

// ============================================================================
// ARITHMETIC EXPRESSION HELPERS
// ============================================================================

/**
 * Create a column reference operand
 */
export function col(name: string): ArithmeticOperand {
  return { type: 'column', name }
}

/**
 * Create a literal value operand
 */
export function lit(value: number): ArithmeticOperand {
  return { type: 'literal', value }
}

/**
 * Create a sum expression (add multiple operands)
 */
export function sum(...operands: (string | number | ArithmeticOperand)[]): ArithmeticExpression {
  return {
    operator: 'add',
    operands: operands.map(normalizeOperand),
  }
}

/**
 * Create a difference expression
 */
export function diff(minuend: string | number | ArithmeticOperand, subtrahend: string | number | ArithmeticOperand): ArithmeticExpression {
  return {
    operator: 'subtract',
    operands: [normalizeOperand(minuend), normalizeOperand(subtrahend)],
  }
}

/**
 * Create a product expression
 */
export function product(...operands: (string | number | ArithmeticOperand)[]): ArithmeticExpression {
  return {
    operator: 'multiply',
    operands: operands.map(normalizeOperand),
  }
}

/**
 * Create a quotient expression
 */
export function quotient(dividend: string | number | ArithmeticOperand, divisor: string | number | ArithmeticOperand): ArithmeticExpression {
  return {
    operator: 'divide',
    operands: [normalizeOperand(dividend), normalizeOperand(divisor)],
  }
}

/**
 * Normalize operand to ArithmeticOperand
 */
function normalizeOperand(operand: string | number | ArithmeticOperand): ArithmeticOperand {
  if (typeof operand === 'string') {
    return { type: 'column', name: operand }
  }
  if (typeof operand === 'number') {
    return { type: 'literal', value: operand }
  }
  return operand
}

// ============================================================================
// CROSS-COLUMN EXPECTATION BUILDER
// ============================================================================

/**
 * Fluent builder for cross-column expectations
 */
export class CrossColumnExpectationBuilder {
  private columns: string[]
  private expectation: Partial<CrossColumnExpectation> = {}
  private customMessage?: string

  constructor(columns: string | string[]) {
    this.columns = Array.isArray(columns) ? columns : [columns]
  }

  // ============================================================================
  // FOREIGN KEY VALIDATION
  // ============================================================================

  /**
   * Expect the column value to exist in a reference table
   * @param referenceTable Name of the reference table/dataset
   * @param referenceColumn Column name in the reference table (defaults to same as source)
   */
  toExistIn(referenceTable: string, referenceColumn?: string): this {
    this.expectation = {
      type: 'foreign_key',
      columns: this.columns,
      foreignKey: {
        referenceTable,
        referenceColumn: referenceColumn ?? this.columns[0]!,
        allowNull: false,
      },
    }
    return this
  }

  /**
   * Allow null values in foreign key validation
   */
  allowingNull(): this {
    if (this.expectation.foreignKey) {
      this.expectation.foreignKey.allowNull = true
    }
    return this
  }

  /**
   * Expect the column value to reference a valid enum value
   * @param enumName Name of the enum or reference table containing valid values
   * @param valueColumn Column containing the enum values (if from a table)
   */
  toReferenceEnum(enumName: string, valueColumn?: string): this {
    this.expectation = {
      type: 'enum_reference',
      columns: this.columns,
      enumRef: {
        enumName,
        valueColumn,
      },
    }
    return this
  }

  // ============================================================================
  // CROSS-COLUMN COMPARISONS
  // ============================================================================

  /**
   * Expect the column to equal another column
   */
  toEqualColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'equal',
        targetColumn,
      },
    }
    return this
  }

  /**
   * Expect the column to not equal another column
   */
  toNotEqualColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'not_equal',
        targetColumn,
      },
    }
    return this
  }

  /**
   * Expect the column to be greater than another column
   */
  toBeGreaterThanColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'greater_than',
        targetColumn,
      },
    }
    return this
  }

  /**
   * Expect the column to be greater than or equal to another column
   */
  toBeGreaterThanOrEqualColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'greater_than_or_equal',
        targetColumn,
      },
    }
    return this
  }

  /**
   * Expect the column to be less than another column
   */
  toBeLessThanColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'less_than',
        targetColumn,
      },
    }
    return this
  }

  /**
   * Expect the column to be less than or equal to another column
   */
  toBeLessThanOrEqualColumn(targetColumn: string): this {
    this.expectation = {
      type: 'cross_column_comparison',
      columns: this.columns,
      comparison: {
        operator: 'less_than_or_equal',
        targetColumn,
      },
    }
    return this
  }

  // ============================================================================
  // COMPUTED VALUE VALIDATION
  // ============================================================================

  /**
   * Expect the column to equal a computed expression
   * @param expression Arithmetic expression to compute
   * @param tolerance Optional tolerance for floating point comparisons
   */
  toEqualExpression(expression: ArithmeticExpression, tolerance?: number): this {
    this.expectation = {
      type: 'computed_value',
      columns: this.columns,
      expression,
      tolerance,
    }
    return this
  }

  /**
   * Expect the column to equal the sum of other columns
   */
  toEqualSumOf(...columnNames: string[]): this {
    return this.toEqualExpression(sum(...columnNames))
  }

  /**
   * Expect the column to equal the difference of two columns
   */
  toEqualDifferenceOf(minuendColumn: string, subtrahendColumn: string): this {
    return this.toEqualExpression(diff(minuendColumn, subtrahendColumn))
  }

  /**
   * Expect the column to equal the product of other columns
   */
  toEqualProductOf(...columnNames: string[]): this {
    return this.toEqualExpression(product(...columnNames))
  }

  /**
   * Expect the column to equal the quotient of two columns
   */
  toEqualQuotientOf(dividendColumn: string, divisorColumn: string): this {
    return this.toEqualExpression(quotient(dividendColumn, divisorColumn))
  }

  /**
   * Set tolerance for numeric comparisons
   */
  withTolerance(tolerance: number): this {
    this.expectation.tolerance = tolerance
    return this
  }

  // ============================================================================
  // COMPOSITE KEY VALIDATION
  // ============================================================================

  /**
   * Expect the combination of columns to be unique across all rows
   */
  toBeUniqueComposite(): this {
    this.expectation = {
      type: 'composite_unique',
      columns: this.columns,
    }
    return this
  }

  // ============================================================================
  // CUSTOM MESSAGE
  // ============================================================================

  /**
   * Set a custom error message for this expectation
   */
  withMessage(message: string): this {
    this.customMessage = message
    return this
  }

  // ============================================================================
  // BUILD
  // ============================================================================

  /**
   * Build the final CrossColumnExpectation object
   */
  build(): CrossColumnExpectation {
    return {
      ...this.expectation,
      columns: this.columns,
      message: this.customMessage,
    } as CrossColumnExpectation
  }
}

// ============================================================================
// CONDITIONAL EXPECTATION BUILDER
// ============================================================================

/**
 * Builder for conditional expectations (when...then)
 */
export class ConditionalExpectationBuilder {
  private condition: Condition
  private thenColumns: string[] = []
  private thenExpectation: Partial<Omit<CrossColumnExpectation, 'condition'>> = {}
  private customMessage?: string

  constructor(column: string) {
    this.condition = {
      column,
      operator: 'equal',
    }
  }

  // ============================================================================
  // CONDITION OPERATORS
  // ============================================================================

  /**
   * Set condition: column equals value
   */
  equals(value: unknown): this {
    this.condition.operator = 'equal'
    this.condition.value = value
    return this
  }

  /**
   * Set condition: column not equals value
   */
  notEquals(value: unknown): this {
    this.condition.operator = 'not_equal'
    this.condition.value = value
    return this
  }

  /**
   * Set condition: column is in set of values
   */
  isIn(values: unknown[]): this {
    this.condition.operator = 'in'
    this.condition.value = values
    return this
  }

  /**
   * Set condition: column is not in set of values
   */
  isNotIn(values: unknown[]): this {
    this.condition.operator = 'not_in'
    this.condition.value = values
    return this
  }

  /**
   * Set condition: column is null
   */
  isNull(): this {
    this.condition.operator = 'is_null'
    return this
  }

  /**
   * Set condition: column is not null
   */
  isNotNull(): this {
    this.condition.operator = 'is_not_null'
    return this
  }

  /**
   * Set condition: column is greater than value
   */
  greaterThan(value: number): this {
    this.condition.operator = 'greater_than'
    this.condition.value = value
    return this
  }

  /**
   * Set condition: column is less than value
   */
  lessThan(value: number): this {
    this.condition.operator = 'less_than'
    this.condition.value = value
    return this
  }

  // ============================================================================
  // THEN CLAUSE
  // ============================================================================

  /**
   * Specify the column(s) to validate when condition is met
   */
  then(columns: string | string[]): ThenClauseBuilder {
    this.thenColumns = Array.isArray(columns) ? columns : [columns]
    return new ThenClauseBuilder(this)
  }

  /** @internal */
  _setThenExpectation(expectation: Partial<Omit<CrossColumnExpectation, 'condition'>>): void {
    this.thenExpectation = expectation
  }

  /** @internal */
  _getThenColumns(): string[] {
    return this.thenColumns
  }

  /**
   * Set a custom error message
   */
  withMessage(message: string): this {
    this.customMessage = message
    return this
  }

  /**
   * Build the final conditional expectation
   */
  build(): CrossColumnExpectation {
    return {
      type: 'conditional',
      columns: this.thenColumns,
      condition: this.condition,
      thenExpectation: this.thenExpectation as Omit<CrossColumnExpectation, 'condition'>,
      message: this.customMessage,
    }
  }
}

/**
 * Builder for the "then" clause of conditional expectations
 */
export class ThenClauseBuilder {
  private parent: ConditionalExpectationBuilder

  constructor(parent: ConditionalExpectationBuilder) {
    this.parent = parent
  }

  /**
   * Expect the column to be null
   */
  toBeNull(): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'equal',
        targetColumn: '__null__',
      },
    })
    return this.parent
  }

  /**
   * Expect the column to not be null
   */
  toNotBeNull(): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'not_equal',
        targetColumn: '__null__',
      },
    })
    return this.parent
  }

  /**
   * Expect the column to equal a specific value
   */
  toEqual(value: unknown): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'equal',
        targetColumn: `__literal__${JSON.stringify(value)}`,
      },
    })
    return this.parent
  }

  /**
   * Expect the column to equal another column
   */
  toEqualColumn(targetColumn: string): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'equal',
        targetColumn,
      },
    })
    return this.parent
  }

  /**
   * Expect the column to be greater than another column
   */
  toBeGreaterThanColumn(targetColumn: string): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'greater_than',
        targetColumn,
      },
    })
    return this.parent
  }

  /**
   * Expect the column to be less than another column
   */
  toBeLessThanColumn(targetColumn: string): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'cross_column_comparison',
      columns: this.parent._getThenColumns(),
      comparison: {
        operator: 'less_than',
        targetColumn,
      },
    })
    return this.parent
  }

  /**
   * Expect the column to exist in a reference table
   */
  toExistIn(referenceTable: string, referenceColumn?: string): ConditionalExpectationBuilder {
    this.parent._setThenExpectation({
      type: 'foreign_key',
      columns: this.parent._getThenColumns(),
      foreignKey: {
        referenceTable,
        referenceColumn: referenceColumn ?? this.parent._getThenColumns()[0]!,
        allowNull: false,
      },
    })
    return this.parent
  }
}

// ============================================================================
// ENTRY POINT FUNCTIONS
// ============================================================================

/**
 * Create a cross-column expectation builder for a single column
 *
 * @example
 * ```typescript
 * const expectation = column('user_id').toExistIn('users', 'id').build()
 * ```
 */
export function column(name: string): CrossColumnExpectationBuilder {
  return new CrossColumnExpectationBuilder(name)
}

/**
 * Create a cross-column expectation builder for multiple columns
 *
 * @example
 * ```typescript
 * const expectation = columns(['org_id', 'user_id']).toBeUniqueComposite().build()
 * ```
 */
export function columns(names: string[]): CrossColumnExpectationBuilder {
  return new CrossColumnExpectationBuilder(names)
}

/**
 * Create a conditional expectation builder
 *
 * @example
 * ```typescript
 * const expectation = when('status').equals('active').then('end_date').toBeNull().build()
 * ```
 */
export function when(column: string): ConditionalExpectationBuilder {
  return new ConditionalExpectationBuilder(column)
}

// ============================================================================
// VALIDATION ENGINE
// ============================================================================

/**
 * Build lookup indexes for efficient foreign key validation
 */
function buildLookupIndexes(referenceData: ReferenceData): LookupIndex {
  const index: LookupIndex = new Map()

  for (const [tableName, rows] of Object.entries(referenceData)) {
    for (const row of rows) {
      for (const [columnName, value] of Object.entries(row)) {
        const key = `${tableName}.${columnName}`
        if (!index.has(key)) {
          index.set(key, new Set())
        }
        if (value !== null && value !== undefined) {
          index.get(key)!.add(value)
        }
      }
    }
  }

  return index
}

/**
 * Get nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/\.|\[|\]/).filter((p) => p !== '')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Evaluate an arithmetic expression against a row
 */
function evaluateExpression(expr: ArithmeticExpression, row: Record<string, unknown>): number | null {
  const evaluateOperand = (operand: ArithmeticOperand): number | null => {
    switch (operand.type) {
      case 'column': {
        const value = getNestedValue(row, operand.name)
        if (typeof value !== 'number') return null
        return value
      }
      case 'literal':
        return operand.value
      case 'expression':
        return evaluateExpression(operand.expr, row)
    }
  }

  const values = expr.operands.map(evaluateOperand)
  if (values.some((v) => v === null)) return null

  switch (expr.operator) {
    case 'add':
      return (values as number[]).reduce((a, b) => a + b, 0)
    case 'subtract':
      return (values[0] as number) - (values[1] as number)
    case 'multiply':
      return (values as number[]).reduce((a, b) => a * b, 1)
    case 'divide':
      if (values[1] === 0) return null
      return (values[0] as number) / (values[1] as number)
  }
}

/**
 * Check if a condition is satisfied for a row
 */
function checkCondition(condition: Condition, row: Record<string, unknown>): boolean {
  const value = getNestedValue(row, condition.column)

  switch (condition.operator) {
    case 'equal':
      return value === condition.value
    case 'not_equal':
      return value !== condition.value
    case 'greater_than':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value
    case 'greater_than_or_equal':
      return typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value
    case 'less_than':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value
    case 'less_than_or_equal':
      return typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value)
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(value)
    case 'is_null':
      return value === null || value === undefined
    case 'is_not_null':
      return value !== null && value !== undefined
  }
}

/**
 * Compare two values using a comparison operator
 */
function compareValues(a: unknown, b: unknown, operator: ComparisonOperator): boolean {
  // Handle null comparisons
  if (b === null || b === undefined) {
    // Special case: comparing to null
    return false
  }

  switch (operator) {
    case 'equal':
      return a === b
    case 'not_equal':
      return a !== b
    case 'greater_than':
      if (typeof a === 'number' && typeof b === 'number') return a > b
      if (typeof a === 'string' && typeof b === 'string') return a > b
      if (a instanceof Date && b instanceof Date) return a.getTime() > b.getTime()
      // Handle date strings
      if (typeof a === 'string' && typeof b === 'string') {
        const dateA = new Date(a)
        const dateB = new Date(b)
        if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
          return dateA.getTime() > dateB.getTime()
        }
      }
      return false
    case 'greater_than_or_equal':
      if (typeof a === 'number' && typeof b === 'number') return a >= b
      if (typeof a === 'string' && typeof b === 'string') return a >= b
      if (a instanceof Date && b instanceof Date) return a.getTime() >= b.getTime()
      if (typeof a === 'string' && typeof b === 'string') {
        const dateA = new Date(a)
        const dateB = new Date(b)
        if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
          return dateA.getTime() >= dateB.getTime()
        }
      }
      return false
    case 'less_than':
      if (typeof a === 'number' && typeof b === 'number') return a < b
      if (typeof a === 'string' && typeof b === 'string') return a < b
      if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime()
      if (typeof a === 'string' && typeof b === 'string') {
        const dateA = new Date(a)
        const dateB = new Date(b)
        if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
          return dateA.getTime() < dateB.getTime()
        }
      }
      return false
    case 'less_than_or_equal':
      if (typeof a === 'number' && typeof b === 'number') return a <= b
      if (typeof a === 'string' && typeof b === 'string') return a <= b
      if (a instanceof Date && b instanceof Date) return a.getTime() <= b.getTime()
      if (typeof a === 'string' && typeof b === 'string') {
        const dateA = new Date(a)
        const dateB = new Date(b)
        if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
          return dateA.getTime() <= dateB.getTime()
        }
      }
      return false
  }
}

/**
 * Validate a single expectation against a row
 */
function validateExpectationForRow(
  expectation: CrossColumnExpectation,
  row: Record<string, unknown>,
  rowIndex: number,
  lookupIndex: LookupIndex,
  referenceData: ReferenceData,
  allData: Record<string, unknown>[]
): CrossColumnExpectationFailure | null {
  switch (expectation.type) {
    case 'foreign_key': {
      const fk = expectation.foreignKey!
      const sourceValue = getNestedValue(row, expectation.columns[0]!)

      // Allow null if configured
      if ((sourceValue === null || sourceValue === undefined) && fk.allowNull) {
        return null
      }

      if (sourceValue === null || sourceValue === undefined) {
        return {
          type: 'foreign_key',
          columns: expectation.columns,
          message: expectation.message ?? `Column '${expectation.columns[0]}' is null but foreign key does not allow null`,
          rowIndex,
          actualValues: { [expectation.columns[0]!]: sourceValue },
        }
      }

      // Check lookup index
      const lookupKey = `${fk.referenceTable}.${fk.referenceColumn}`
      const validValues = lookupIndex.get(lookupKey)

      if (!validValues || !validValues.has(sourceValue)) {
        return {
          type: 'foreign_key',
          columns: expectation.columns,
          message:
            expectation.message ??
            `Column '${expectation.columns[0]}' value '${sourceValue}' does not exist in ${fk.referenceTable}.${fk.referenceColumn}`,
          rowIndex,
          actualValues: { [expectation.columns[0]!]: sourceValue },
        }
      }
      return null
    }

    case 'enum_reference': {
      const enumRef = expectation.enumRef!
      const sourceValue = getNestedValue(row, expectation.columns[0]!)

      // Allow null values for enum references
      if (sourceValue === null || sourceValue === undefined) {
        return null
      }

      // Check if enum values are in reference data
      const lookupKey = enumRef.valueColumn
        ? `${enumRef.enumName}.${enumRef.valueColumn}`
        : `${enumRef.enumName}.value`
      const validValues = lookupIndex.get(lookupKey)

      if (!validValues || !validValues.has(sourceValue)) {
        return {
          type: 'enum_reference',
          columns: expectation.columns,
          message: expectation.message ?? `Column '${expectation.columns[0]}' value '${sourceValue}' is not a valid enum value in ${enumRef.enumName}`,
          rowIndex,
          actualValues: { [expectation.columns[0]!]: sourceValue },
        }
      }
      return null
    }

    case 'cross_column_comparison': {
      const comp = expectation.comparison!
      const sourceValue = getNestedValue(row, expectation.columns[0]!)

      // Handle special target values for null checks BEFORE skipping nulls
      if (comp.targetColumn === '__null__') {
        // toBeNull(): operator is 'equal', expect value to be null
        if (comp.operator === 'equal') {
          if (sourceValue !== null && sourceValue !== undefined) {
            return {
              type: 'cross_column_comparison',
              columns: expectation.columns,
              message: expectation.message ?? `Column '${expectation.columns[0]}' should be null but is '${sourceValue}'`,
              rowIndex,
              actualValues: { [expectation.columns[0]!]: sourceValue },
              expectedValue: null,
            }
          }
          return null
        }
        // toNotBeNull(): operator is 'not_equal', expect value to NOT be null
        if (comp.operator === 'not_equal') {
          if (sourceValue === null || sourceValue === undefined) {
            return {
              type: 'cross_column_comparison',
              columns: expectation.columns,
              message: expectation.message ?? `Column '${expectation.columns[0]}' should not be null`,
              rowIndex,
              actualValues: { [expectation.columns[0]!]: sourceValue },
              expectedValue: 'not null',
            }
          }
          return null
        }
      }

      // Skip null source values for other comparisons
      if (sourceValue === null || sourceValue === undefined) {
        return null
      }

      if (comp.targetColumn.startsWith('__literal__')) {
        const literalValue = JSON.parse(comp.targetColumn.slice(11))
        if (!compareValues(sourceValue, literalValue, comp.operator)) {
          return {
            type: 'cross_column_comparison',
            columns: expectation.columns,
            message:
              expectation.message ??
              `Column '${expectation.columns[0]}' value '${sourceValue}' does not satisfy ${comp.operator} '${literalValue}'`,
            rowIndex,
            actualValues: { [expectation.columns[0]!]: sourceValue },
            expectedValue: literalValue,
          }
        }
        return null
      }

      const targetValue = getNestedValue(row, comp.targetColumn)

      // Skip if target is null (can't compare to null)
      if (targetValue === null || targetValue === undefined) {
        return null
      }

      if (!compareValues(sourceValue, targetValue, comp.operator)) {
        return {
          type: 'cross_column_comparison',
          columns: expectation.columns,
          message:
            expectation.message ??
            `Column '${expectation.columns[0]}' value '${sourceValue}' is not ${comp.operator.replace(/_/g, ' ')} '${comp.targetColumn}' value '${targetValue}'`,
          rowIndex,
          actualValues: {
            [expectation.columns[0]!]: sourceValue,
            [comp.targetColumn]: targetValue,
          },
        }
      }
      return null
    }

    case 'computed_value': {
      const sourceValue = getNestedValue(row, expectation.columns[0]!)
      if (typeof sourceValue !== 'number') {
        return null // Skip non-numeric values
      }

      const expectedValue = evaluateExpression(expectation.expression!, row)
      if (expectedValue === null) {
        return null // Skip if expression can't be evaluated
      }

      const tolerance = expectation.tolerance ?? 0.0001 // Default small tolerance for floating point
      if (Math.abs(sourceValue - expectedValue) > tolerance) {
        return {
          type: 'computed_value',
          columns: expectation.columns,
          message:
            expectation.message ??
            `Column '${expectation.columns[0]}' value ${sourceValue} does not equal computed value ${expectedValue}`,
          rowIndex,
          actualValues: { [expectation.columns[0]!]: sourceValue },
          expectedValue,
        }
      }
      return null
    }

    case 'conditional': {
      // Check if condition is met
      if (!checkCondition(expectation.condition!, row)) {
        return null // Condition not met, skip validation
      }

      // Validate the then expectation
      if (expectation.thenExpectation) {
        return validateExpectationForRow(
          { ...expectation.thenExpectation, columns: expectation.columns } as CrossColumnExpectation,
          row,
          rowIndex,
          lookupIndex,
          referenceData,
          allData
        )
      }
      return null
    }

    case 'composite_unique':
      // Handled at dataset level, not per-row
      return null
  }
}

/**
 * Validate composite uniqueness for an expectation
 */
function validateCompositeUnique(
  expectation: CrossColumnExpectation,
  data: Record<string, unknown>[]
): CrossColumnExpectationFailure[] {
  const failures: CrossColumnExpectationFailure[] = []
  const seen = new Map<string, number>()

  for (let i = 0; i < data.length; i++) {
    const row = data[i]!
    const keyParts: unknown[] = []

    for (const col of expectation.columns) {
      const value = getNestedValue(row, col)
      keyParts.push(value)
    }

    // Skip rows where any key column is null
    if (keyParts.some((v) => v === null || v === undefined)) {
      continue
    }

    const key = JSON.stringify(keyParts)

    if (seen.has(key)) {
      const firstIndex = seen.get(key)!
      failures.push({
        type: 'composite_unique',
        columns: expectation.columns,
        message:
          expectation.message ??
          `Duplicate composite key found: columns [${expectation.columns.join(', ')}] values [${keyParts.join(', ')}] at rows ${firstIndex} and ${i}`,
        rowIndex: i,
        actualValues: Object.fromEntries(expectation.columns.map((col, idx) => [col, keyParts[idx]])),
      })
    } else {
      seen.set(key, i)
    }
  }

  return failures
}

/**
 * Validate cross-column expectations against data
 *
 * @param expectations Array of cross-column expectations to validate
 * @param data Array of records to validate
 * @param referenceData Optional reference data for foreign key validation
 * @returns Validation result with failures and timing information
 *
 * @example
 * ```typescript
 * const expectations = [
 *   column('user_id').toExistIn('users', 'id').build(),
 *   column('end_date').toBeGreaterThanColumn('start_date').build(),
 *   columns(['org_id', 'user_id']).toBeUniqueComposite().build(),
 * ]
 *
 * const result = validateCrossColumnExpectations(expectations, data, { users: usersData })
 * ```
 */
export function validateCrossColumnExpectations(
  expectations: CrossColumnExpectation[],
  data: Record<string, unknown>[],
  referenceData: ReferenceData = {}
): CrossColumnValidationResult {
  const startTime = performance.now()
  const failures: CrossColumnExpectationFailure[] = []

  // Build lookup indexes for foreign key validation
  const lookupBuildStart = performance.now()
  const lookupIndex = buildLookupIndexes(referenceData)
  const lookupBuildMs = performance.now() - lookupBuildStart

  // Separate composite unique expectations from row-level expectations
  const compositeExpectations = expectations.filter((e) => e.type === 'composite_unique')
  const rowExpectations = expectations.filter((e) => e.type !== 'composite_unique')

  // Validate composite uniqueness (dataset level)
  for (const expectation of compositeExpectations) {
    failures.push(...validateCompositeUnique(expectation, data))
  }

  // Validate row-level expectations
  for (let i = 0; i < data.length; i++) {
    const row = data[i]!

    for (const expectation of rowExpectations) {
      const failure = validateExpectationForRow(expectation, row, i, lookupIndex, referenceData, data)
      if (failure) {
        failures.push(failure)
      }
    }
  }

  const totalMs = performance.now() - startTime

  return {
    passed: failures.length === 0,
    failures,
    expectationsChecked: expectations.length,
    timing: {
      totalMs,
      lookupBuildMs,
    },
  }
}
