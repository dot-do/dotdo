/**
 * SOQL Abstract Syntax Tree (AST) Types
 *
 * Defines the node types for representing parsed SOQL queries.
 *
 * @module @dotdo/salesforce/soql/ast
 */

/**
 * Base AST node with location information
 */
export interface BaseNode {
  type: string
  line: number
  column: number
}

/**
 * Root query node
 */
export interface SelectNode extends BaseNode {
  type: 'Select'
  fields: FieldNode[]
  from: FromNode
  where?: WhereNode
  orderBy?: OrderByNode[]
  limit?: number
  offset?: number
  groupBy?: FieldNode[]
  having?: WhereNode
}

/**
 * Field selection (can be simple field, relationship field, subquery, or aggregate)
 */
export type FieldNode =
  | SimpleFieldNode
  | RelationshipFieldNode
  | SubqueryNode
  | AggregateFieldNode
  | TypeOfNode

/**
 * Simple field reference: Name, Id, etc.
 */
export interface SimpleFieldNode extends BaseNode {
  type: 'SimpleField'
  name: string
  alias?: string
}

/**
 * Relationship field: Account.Name, Contact.Account.Industry
 */
export interface RelationshipFieldNode extends BaseNode {
  type: 'RelationshipField'
  path: string[]  // ['Account', 'Name'] for Account.Name
  alias?: string
}

/**
 * Subquery for child relationships
 * SELECT Name, (SELECT Name FROM Contacts) FROM Account
 */
export interface SubqueryNode extends BaseNode {
  type: 'Subquery'
  select: SelectNode
  relationshipName: string
}

/**
 * Aggregate function: COUNT(Id), SUM(Amount), etc.
 */
export interface AggregateFieldNode extends BaseNode {
  type: 'AggregateField'
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT'
  field?: string  // The field being aggregated (optional for COUNT())
  alias?: string
}

/**
 * TYPEOF for polymorphic relationship queries
 */
export interface TypeOfNode extends BaseNode {
  type: 'TypeOf'
  field: string
  whenClauses: TypeOfWhenClause[]
  elseFields?: string[]
}

export interface TypeOfWhenClause {
  type: string  // The SObject type
  fields: string[]
}

/**
 * FROM clause
 */
export interface FromNode extends BaseNode {
  type: 'From'
  sobject: string
  alias?: string
}

/**
 * WHERE clause expression
 */
export type WhereNode =
  | ComparisonNode
  | LogicalNode
  | InNode
  | LikeNode
  | IncludesExcludesNode
  | NotNode

/**
 * Comparison: field = value, field != value, etc.
 */
export interface ComparisonNode extends BaseNode {
  type: 'Comparison'
  field: string
  operator: '=' | '!=' | '<' | '>' | '<=' | '>='
  value: ValueNode
}

/**
 * Logical combination: AND, OR
 */
export interface LogicalNode extends BaseNode {
  type: 'Logical'
  operator: 'AND' | 'OR'
  left: WhereNode
  right: WhereNode
}

/**
 * IN clause: field IN (value1, value2, ...)
 */
export interface InNode extends BaseNode {
  type: 'In'
  field: string
  values: ValueNode[]
  negated: boolean  // NOT IN
}

/**
 * LIKE clause: field LIKE 'pattern%'
 */
export interface LikeNode extends BaseNode {
  type: 'Like'
  field: string
  pattern: string
  negated: boolean  // NOT LIKE
}

/**
 * INCLUDES/EXCLUDES for multipicklist fields
 */
export interface IncludesExcludesNode extends BaseNode {
  type: 'IncludesExcludes'
  field: string
  operator: 'INCLUDES' | 'EXCLUDES'
  values: string[]
}

/**
 * NOT expression
 */
export interface NotNode extends BaseNode {
  type: 'Not'
  expression: WhereNode
}

/**
 * Value types that can appear in comparisons
 */
export type ValueNode =
  | StringValueNode
  | NumberValueNode
  | BooleanValueNode
  | NullValueNode
  | DateValueNode
  | DateTimeValueNode
  | DateLiteralNode
  | BindVariableNode
  | FieldRefNode

export interface StringValueNode extends BaseNode {
  type: 'StringValue'
  value: string
}

export interface NumberValueNode extends BaseNode {
  type: 'NumberValue'
  value: number
}

export interface BooleanValueNode extends BaseNode {
  type: 'BooleanValue'
  value: boolean
}

export interface NullValueNode extends BaseNode {
  type: 'NullValue'
}

export interface DateValueNode extends BaseNode {
  type: 'DateValue'
  value: string  // ISO date string
}

export interface DateTimeValueNode extends BaseNode {
  type: 'DateTimeValue'
  value: string  // ISO datetime string
}

/**
 * Date literals like TODAY, LAST_N_DAYS:7
 */
export interface DateLiteralNode extends BaseNode {
  type: 'DateLiteral'
  literal: string
  n?: number  // For LAST_N_DAYS:n, NEXT_N_DAYS:n, etc.
}

/**
 * Bind variable: :variableName
 */
export interface BindVariableNode extends BaseNode {
  type: 'BindVariable'
  name: string
}

/**
 * Field reference in value position (for comparing two fields)
 */
export interface FieldRefNode extends BaseNode {
  type: 'FieldRef'
  field: string
}

/**
 * ORDER BY clause
 */
export interface OrderByNode extends BaseNode {
  type: 'OrderBy'
  field: string
  direction: 'ASC' | 'DESC'
  nulls?: 'FIRST' | 'LAST'
}

/**
 * All possible AST node types
 */
export type ASTNode =
  | SelectNode
  | FieldNode
  | FromNode
  | WhereNode
  | OrderByNode
  | ValueNode
