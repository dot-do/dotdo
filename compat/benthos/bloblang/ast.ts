/**
 * GREEN Phase Implementation: Bloblang AST Node Types
 * Issue: dotdo-1kvi4 - Milestone 2
 *
 * Abstract Syntax Tree node definitions for the Bloblang language.
 * All nodes include line and column properties for error location tracking.
 */

// Base type for all AST nodes
export interface BaseNode {
  line: number
  column: number
}

// Literal types
export type LiteralKind = 'string' | 'number' | 'boolean' | 'null'

export interface LiteralNode extends BaseNode {
  type: 'Literal'
  kind: LiteralKind
  value: string | number | boolean | null
}

// Identifier node
export interface IdentifierNode extends BaseNode {
  type: 'Identifier'
  name: string
}

// Root reference node
export interface RootNode extends BaseNode {
  type: 'Root'
}

// This reference node
export interface ThisNode extends BaseNode {
  type: 'This'
}

// Meta reference node
export interface MetaNode extends BaseNode {
  type: 'Meta'
}

// Deleted marker node (for removing fields in mappings)
export interface DeletedNode extends BaseNode {
  type: 'Deleted'
}

// Nothing marker node (for null/absent values)
export interface NothingNode extends BaseNode {
  type: 'Nothing'
}

// Binary operators
export type BinaryOperator =
  | '+' | '-' | '*' | '/' | '%'        // Arithmetic
  | '==' | '!=' | '<' | '>' | '<=' | '>='  // Comparison
  | '&&' | '||'                        // Logical
  | 'in'                               // Membership

export interface BinaryOpNode extends BaseNode {
  type: 'BinaryOp'
  operator: BinaryOperator
  left: ASTNode
  right: ASTNode
}

// Unary operators
export type UnaryOperator = '-' | '!'

export interface UnaryOpNode extends BaseNode {
  type: 'UnaryOp'
  operator: UnaryOperator
  operand: ASTNode
}

// Access types for member access
export type AccessType = 'dot' | 'bracket' | 'optional'

export interface MemberAccessNode extends BaseNode {
  type: 'MemberAccess'
  object: ASTNode
  property: string | ASTNode
  accessType: AccessType
}

// Function call node
export interface CallNode extends BaseNode {
  type: 'Call'
  function: ASTNode
  arguments: ASTNode[]
}

// Array literal node
export interface ArrayNode extends BaseNode {
  type: 'Array'
  elements: ASTNode[]
}

// Object literal node
export interface ObjectNode extends BaseNode {
  type: 'Object'
  fields: {
    key: string
    value: ASTNode
  }[]
}

// If expression node
export interface IfNode extends BaseNode {
  type: 'If'
  condition: ASTNode
  consequent: ASTNode
  alternate?: ASTNode
}

// Match expression node
export interface MatchNode extends BaseNode {
  type: 'Match'
  input: ASTNode
  cases: {
    pattern: ASTNode
    body: ASTNode
  }[]
  default?: ASTNode
}

// Let binding node
export interface LetNode extends BaseNode {
  type: 'Let'
  name: string
  value: ASTNode
  body: ASTNode
}

// Map node
export interface MapNode extends BaseNode {
  type: 'Map'
  lambda: ArrowNode
}

// Pipe node
export interface PipeNode extends BaseNode {
  type: 'Pipe'
  left: ASTNode
  right: ASTNode
}

// Arrow function node
export interface ArrowNode extends BaseNode {
  type: 'Arrow'
  parameter: string
  body: ASTNode
}

// Assignment node
export interface AssignNode extends BaseNode {
  type: 'Assign'
  field: string
  value: ASTNode
}

// Sequence node (multiple statements separated by ; or newline)
export interface SequenceNode extends BaseNode {
  type: 'Sequence'
  statements: ASTNode[]
}

// Union type of all AST nodes
export type ASTNode =
  | LiteralNode
  | IdentifierNode
  | RootNode
  | ThisNode
  | MetaNode
  | DeletedNode
  | NothingNode
  | BinaryOpNode
  | UnaryOpNode
  | MemberAccessNode
  | CallNode
  | ArrayNode
  | ObjectNode
  | IfNode
  | MatchNode
  | LetNode
  | MapNode
  | PipeNode
  | ArrowNode
  | AssignNode
  | SequenceNode

// Type guards
export function isLiteralNode(node: ASTNode): node is LiteralNode {
  return node.type === 'Literal'
}

export function isIdentifierNode(node: ASTNode): node is IdentifierNode {
  return node.type === 'Identifier'
}

export function isRootNode(node: ASTNode): node is RootNode {
  return node.type === 'Root'
}

export function isThisNode(node: ASTNode): node is ThisNode {
  return node.type === 'This'
}

export function isMetaNode(node: ASTNode): node is MetaNode {
  return node.type === 'Meta'
}

export function isDeletedNode(node: ASTNode): node is DeletedNode {
  return node.type === 'Deleted'
}

export function isNothingNode(node: ASTNode): node is NothingNode {
  return node.type === 'Nothing'
}

export function isBinaryOpNode(node: ASTNode): node is BinaryOpNode {
  return node.type === 'BinaryOp'
}

export function isUnaryOpNode(node: ASTNode): node is UnaryOpNode {
  return node.type === 'UnaryOp'
}

export function isMemberAccessNode(node: ASTNode): node is MemberAccessNode {
  return node.type === 'MemberAccess'
}

export function isCallNode(node: ASTNode): node is CallNode {
  return node.type === 'Call'
}

export function isArrayNode(node: ASTNode): node is ArrayNode {
  return node.type === 'Array'
}

export function isObjectNode(node: ASTNode): node is ObjectNode {
  return node.type === 'Object'
}

export function isIfNode(node: ASTNode): node is IfNode {
  return node.type === 'If'
}

export function isMatchNode(node: ASTNode): node is MatchNode {
  return node.type === 'Match'
}

export function isLetNode(node: ASTNode): node is LetNode {
  return node.type === 'Let'
}

export function isMapNode(node: ASTNode): node is MapNode {
  return node.type === 'Map'
}

export function isPipeNode(node: ASTNode): node is PipeNode {
  return node.type === 'Pipe'
}

export function isArrowNode(node: ASTNode): node is ArrowNode {
  return node.type === 'Arrow'
}

export function isAssignNode(node: ASTNode): node is AssignNode {
  return node.type === 'Assign'
}

export function isSequenceNode(node: ASTNode): node is SequenceNode {
  return node.type === 'Sequence'
}
