/**
 * Bloblang AST Node Types
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export type BinaryOperator =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '>' | '<=' | '>='
  | '&&' | '||'
  | 'in'

export type UnaryOperator = '-' | '!'

export type LiteralKind = 'string' | 'number' | 'boolean' | 'null'

export interface BaseNode {
  type: string
  line: number
  column: number
}

export interface LiteralNode extends BaseNode {
  type: 'Literal'
  kind: LiteralKind
  value: string | number | boolean | null
}

export interface IdentifierNode extends BaseNode {
  type: 'Identifier'
  name: string
}

export interface RootNode extends BaseNode {
  type: 'Root'
}

export interface ThisNode extends BaseNode {
  type: 'This'
}

export interface MetaNode extends BaseNode {
  type: 'Meta'
}

export interface DeletedNode extends BaseNode {
  type: 'Deleted'
}

export interface NothingNode extends BaseNode {
  type: 'Nothing'
}

export interface BinaryOpNode extends BaseNode {
  type: 'BinaryOp'
  operator: BinaryOperator
  left: ASTNode
  right: ASTNode
}

export interface UnaryOpNode extends BaseNode {
  type: 'UnaryOp'
  operator: UnaryOperator
  operand: ASTNode
}

export interface MemberAccessNode extends BaseNode {
  type: 'MemberAccess'
  object: ASTNode
  property: string | ASTNode
  accessType: 'dot' | 'bracket' | 'optional'
}

export interface CallNode extends BaseNode {
  type: 'Call'
  function: ASTNode
  arguments: ASTNode[]
}

export interface ArrayNode extends BaseNode {
  type: 'Array'
  elements: ASTNode[]
}

export interface ObjectNode extends BaseNode {
  type: 'Object'
  fields: Array<{ key: string; value: ASTNode }>
}

export interface IfNode extends BaseNode {
  type: 'If'
  condition: ASTNode
  consequent: ASTNode
  alternate?: ASTNode
}

export interface MatchNode extends BaseNode {
  type: 'Match'
  input: ASTNode
  cases: Array<{ pattern: ASTNode; body: ASTNode }>
  default?: ASTNode
}

export interface LetNode extends BaseNode {
  type: 'Let'
  name: string
  value: ASTNode
  body: ASTNode
}

export interface PipeNode extends BaseNode {
  type: 'Pipe'
  left: ASTNode
  right: ASTNode
}

export interface ArrowNode extends BaseNode {
  type: 'Arrow'
  parameter: string
  body: ASTNode
}

export interface MapNode extends BaseNode {
  type: 'Map'
  target: ASTNode
  mapper: ASTNode
}

export interface AssignNode extends BaseNode {
  type: 'Assign'
  field: string
  value: ASTNode
}

export interface SequenceNode extends BaseNode {
  type: 'Sequence'
  statements: ASTNode[]
}

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
  | PipeNode
  | ArrowNode
  | MapNode
  | AssignNode
  | SequenceNode
