/**
 * ClickHouse SQL Parser - AST Node Types
 *
 * This module defines the AST (Abstract Syntax Tree) node types for ClickHouse SQL.
 * Supports SELECT, CREATE TABLE, INSERT, and expression parsing.
 */

// ============================================================================
// Statement Nodes
// ============================================================================

export interface SelectQueryNode {
  type: 'SelectQuery'
  columns: ExpressionNode[]
  from?: TableIdentifierNode
  where?: ExpressionNode
  orderBy?: OrderByElementNode[]
  limit?: LiteralNode
  distinct?: boolean
}

export interface CreateTableNode {
  type: 'CreateTable'
  table: TableIdentifierNode
  columns: ColumnDefNode[]
  engine?: EngineNode
  ifNotExists?: boolean
}

export interface InsertNode {
  type: 'Insert'
  table: TableIdentifierNode
  columns?: string[]
  values: ExpressionNode[][]
}

// ============================================================================
// Table and Column Definitions
// ============================================================================

export interface TableIdentifierNode {
  type: 'TableIdentifier'
  database?: string
  table: string
}

export interface ColumnDefNode {
  type: 'ColumnDef'
  name: string
  dataType: string
}

export interface EngineNode {
  type: 'Engine'
  name: string
  args?: ExpressionNode[]
}

// ============================================================================
// Expression Nodes
// ============================================================================

export interface IdentifierNode {
  type: 'Identifier'
  name: string
  quoted?: boolean
}

export interface LiteralNode {
  type: 'Literal'
  value: string | number | boolean | null
  dataType: 'string' | 'number' | 'boolean' | 'null'
}

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: ExpressionNode[]
}

export interface BinaryOpNode {
  type: 'BinaryOp'
  op: string
  left: ExpressionNode
  right: ExpressionNode
}

export interface JSONPathNode {
  type: 'JSONPath'
  object: ExpressionNode
  path: string
  extractText: boolean // true for ->>, false for ->
}

export interface JSONCastNode {
  type: 'JSONCast'
  expression: ExpressionNode
  targetType: string
}

export interface ArrayLiteralNode {
  type: 'ArrayLiteral'
  elements: ExpressionNode[]
}

export interface StarNode {
  type: 'Star'
}

export interface AliasNode {
  type: 'Alias'
  expression: ExpressionNode
  alias: string
}

export interface OrderByElementNode {
  type: 'OrderByElement'
  expression: ExpressionNode
  direction: 'ASC' | 'DESC'
}

// ============================================================================
// Union Types
// ============================================================================

export type StatementNode = SelectQueryNode | CreateTableNode | InsertNode

export type ExpressionNode =
  | IdentifierNode
  | LiteralNode
  | FunctionCallNode
  | BinaryOpNode
  | JSONPathNode
  | JSONCastNode
  | ArrayLiteralNode
  | StarNode
  | AliasNode

export type ASTNode =
  | StatementNode
  | ExpressionNode
  | ColumnDefNode
  | EngineNode
  | TableIdentifierNode
  | OrderByElementNode
