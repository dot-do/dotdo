/**
 * Python AST Node Type Definitions
 *
 * These types mirror Python's ast module structure.
 */

// Base AST node type
export interface ASTNode {
  type: string
  lineno?: number
  col_offset?: number
  end_lineno?: number
  end_col_offset?: number
}

// Module (top-level)
export interface ModuleNode extends ASTNode {
  type: 'Module'
  body: StatementNode[]
}

// ============== Statements ==============

export type StatementNode =
  | ImportNode
  | ImportFromNode
  | FunctionDefNode
  | AsyncFunctionDefNode
  | ClassDefNode
  | AssignNode
  | AugAssignNode
  | AnnAssignNode
  | IfNode
  | ForNode
  | AsyncForNode
  | WhileNode
  | WithNode
  | AsyncWithNode
  | MatchNode
  | TryNode
  | RaiseNode
  | ReturnNode
  | DeleteNode
  | PassNode
  | BreakNode
  | ContinueNode
  | GlobalNode
  | NonlocalNode
  | AssertNode
  | ExprStmtNode
  | TypeAliasNode

// Import statement: import x, y as z
export interface ImportNode extends ASTNode {
  type: 'Import'
  names: AliasNode[]
}

// Import from: from x import y
export interface ImportFromNode extends ASTNode {
  type: 'ImportFrom'
  module: string | null
  names: AliasNode[]
  level: number  // Number of dots for relative imports
}

export interface AliasNode extends ASTNode {
  type: 'alias'
  name: string
  asname?: string
}

// Function definition
export interface FunctionDefNode extends ASTNode {
  type: 'FunctionDef' | 'AsyncFunctionDef'
  name: string
  args: ArgumentsNode
  body: StatementNode[]
  decorator_list: ExpressionNode[]
  returns?: ExpressionNode
  type_params?: TypeParamNode[]
}

export interface AsyncFunctionDefNode extends FunctionDefNode {
  type: 'AsyncFunctionDef'
}

// Arguments for function/lambda
export interface ArgumentsNode extends ASTNode {
  type: 'arguments'
  posonlyargs: ArgNode[]
  args: ArgNode[]
  vararg?: ArgNode
  kwonlyargs: ArgNode[]
  kw_defaults: (ExpressionNode | null)[]
  kwarg?: ArgNode
  defaults: ExpressionNode[]
}

export interface ArgNode extends ASTNode {
  type: 'arg'
  arg: string
  annotation?: ExpressionNode
}

// Class definition
export interface ClassDefNode extends ASTNode {
  type: 'ClassDef'
  name: string
  bases: ExpressionNode[]
  keywords: KeywordNode[]
  body: StatementNode[]
  decorator_list: ExpressionNode[]
  type_params?: TypeParamNode[]
}

// Assignment statements
export interface AssignNode extends ASTNode {
  type: 'Assign'
  targets: ExpressionNode[]
  value: ExpressionNode
}

export interface AugAssignNode extends ASTNode {
  type: 'AugAssign'
  target: ExpressionNode
  op: OperatorType
  value: ExpressionNode
}

export interface AnnAssignNode extends ASTNode {
  type: 'AnnAssign'
  target: ExpressionNode
  annotation: ExpressionNode
  value?: ExpressionNode
  simple: number
}

// Control flow
export interface IfNode extends ASTNode {
  type: 'If'
  test: ExpressionNode
  body: StatementNode[]
  orelse: StatementNode[]
}

export interface ForNode extends ASTNode {
  type: 'For' | 'AsyncFor'
  target: ExpressionNode
  iter: ExpressionNode
  body: StatementNode[]
  orelse: StatementNode[]
}

export interface AsyncForNode extends ForNode {
  type: 'AsyncFor'
}

export interface WhileNode extends ASTNode {
  type: 'While'
  test: ExpressionNode
  body: StatementNode[]
  orelse: StatementNode[]
}

export interface WithNode extends ASTNode {
  type: 'With' | 'AsyncWith'
  items: WithItemNode[]
  body: StatementNode[]
}

export interface AsyncWithNode extends WithNode {
  type: 'AsyncWith'
}

export interface WithItemNode extends ASTNode {
  type: 'withitem'
  context_expr: ExpressionNode
  optional_vars?: ExpressionNode
}

// Match statement (Python 3.10+)
export interface MatchNode extends ASTNode {
  type: 'Match'
  subject: ExpressionNode
  cases: MatchCaseNode[]
}

export interface MatchCaseNode extends ASTNode {
  type: 'match_case'
  pattern: PatternNode
  guard?: ExpressionNode
  body: StatementNode[]
}

// Pattern types for match
export type PatternNode =
  | MatchValueNode
  | MatchSingletonNode
  | MatchSequenceNode
  | MatchMappingNode
  | MatchClassNode
  | MatchStarNode
  | MatchAsNode
  | MatchOrNode

export interface MatchValueNode extends ASTNode {
  type: 'MatchValue'
  value: ExpressionNode
}

export interface MatchSingletonNode extends ASTNode {
  type: 'MatchSingleton'
  value: null | boolean
}

export interface MatchSequenceNode extends ASTNode {
  type: 'MatchSequence'
  patterns: PatternNode[]
}

export interface MatchMappingNode extends ASTNode {
  type: 'MatchMapping'
  keys: ExpressionNode[]
  patterns: PatternNode[]
  rest?: string
}

export interface MatchClassNode extends ASTNode {
  type: 'MatchClass'
  cls: ExpressionNode
  patterns: PatternNode[]
  kwd_attrs: string[]
  kwd_patterns: PatternNode[]
}

export interface MatchStarNode extends ASTNode {
  type: 'MatchStar'
  name?: string
}

export interface MatchAsNode extends ASTNode {
  type: 'MatchAs'
  pattern?: PatternNode
  name?: string
}

export interface MatchOrNode extends ASTNode {
  type: 'MatchOr'
  patterns: PatternNode[]
}

// Exception handling
export interface TryNode extends ASTNode {
  type: 'Try'
  body: StatementNode[]
  handlers: ExceptHandlerNode[]
  orelse: StatementNode[]
  finalbody: StatementNode[]
}

export interface ExceptHandlerNode extends ASTNode {
  type: 'ExceptHandler'
  type_?: ExpressionNode
  name?: string
  body: StatementNode[]
}

export interface RaiseNode extends ASTNode {
  type: 'Raise'
  exc?: ExpressionNode
  cause?: ExpressionNode
}

// Simple statements
export interface ReturnNode extends ASTNode {
  type: 'Return'
  value?: ExpressionNode
}

export interface DeleteNode extends ASTNode {
  type: 'Delete'
  targets: ExpressionNode[]
}

export interface PassNode extends ASTNode {
  type: 'Pass'
}

export interface BreakNode extends ASTNode {
  type: 'Break'
}

export interface ContinueNode extends ASTNode {
  type: 'Continue'
}

export interface GlobalNode extends ASTNode {
  type: 'Global'
  names: string[]
}

export interface NonlocalNode extends ASTNode {
  type: 'Nonlocal'
  names: string[]
}

export interface AssertNode extends ASTNode {
  type: 'Assert'
  test: ExpressionNode
  msg?: ExpressionNode
}

export interface ExprStmtNode extends ASTNode {
  type: 'Expr'
  value: ExpressionNode
}

// Type alias (Python 3.12+)
export interface TypeAliasNode extends ASTNode {
  type: 'TypeAlias'
  name: NameNode
  type_params: TypeParamNode[]
  value: ExpressionNode
}

export type TypeParamNode = TypeVarNode | TypeVarTupleNode | ParamSpecNode

export interface TypeVarNode extends ASTNode {
  type: 'TypeVar'
  name: string
  bound?: ExpressionNode
}

export interface TypeVarTupleNode extends ASTNode {
  type: 'TypeVarTuple'
  name: string
}

export interface ParamSpecNode extends ASTNode {
  type: 'ParamSpec'
  name: string
}

// ============== Expressions ==============

export type ExpressionNode =
  | BoolOpNode
  | NamedExprNode
  | BinOpNode
  | UnaryOpNode
  | LambdaNode
  | IfExpNode
  | DictNode
  | SetNode
  | ListCompNode
  | SetCompNode
  | DictCompNode
  | GeneratorExpNode
  | AwaitNode
  | YieldNode
  | YieldFromNode
  | CompareNode
  | CallNode
  | FormattedValueNode
  | JoinedStrNode
  | ConstantNode
  | AttributeNode
  | SubscriptNode
  | StarredNode
  | NameNode
  | ListNode
  | TupleNode
  | SliceNode

// Boolean operations (and, or)
export interface BoolOpNode extends ASTNode {
  type: 'BoolOp'
  op: 'And' | 'Or'
  values: ExpressionNode[]
}

// Named expression (walrus operator)
export interface NamedExprNode extends ASTNode {
  type: 'NamedExpr'
  target: NameNode
  value: ExpressionNode
}

// Binary operations
export interface BinOpNode extends ASTNode {
  type: 'BinOp'
  left: ExpressionNode
  op: OperatorType
  right: ExpressionNode
}

// Unary operations
export interface UnaryOpNode extends ASTNode {
  type: 'UnaryOp'
  op: UnaryOperatorType
  operand: ExpressionNode
}

// Lambda
export interface LambdaNode extends ASTNode {
  type: 'Lambda'
  args: ArgumentsNode
  body: ExpressionNode
}

// Conditional expression (ternary)
export interface IfExpNode extends ASTNode {
  type: 'IfExp'
  test: ExpressionNode
  body: ExpressionNode
  orelse: ExpressionNode
}

// Dictionary
export interface DictNode extends ASTNode {
  type: 'Dict'
  keys: (ExpressionNode | null)[]  // null for **spread
  values: ExpressionNode[]
}

// Set
export interface SetNode extends ASTNode {
  type: 'Set'
  elts: ExpressionNode[]
}

// List
export interface ListNode extends ASTNode {
  type: 'List'
  elts: ExpressionNode[]
  ctx?: ContextType
}

// Tuple
export interface TupleNode extends ASTNode {
  type: 'Tuple'
  elts: ExpressionNode[]
  ctx?: ContextType
}

// Comprehensions
export interface ListCompNode extends ASTNode {
  type: 'ListComp'
  elt: ExpressionNode
  generators: ComprehensionNode[]
}

export interface SetCompNode extends ASTNode {
  type: 'SetComp'
  elt: ExpressionNode
  generators: ComprehensionNode[]
}

export interface DictCompNode extends ASTNode {
  type: 'DictComp'
  key: ExpressionNode
  value: ExpressionNode
  generators: ComprehensionNode[]
}

export interface GeneratorExpNode extends ASTNode {
  type: 'GeneratorExp'
  elt: ExpressionNode
  generators: ComprehensionNode[]
}

export interface ComprehensionNode extends ASTNode {
  type: 'comprehension'
  target: ExpressionNode
  iter: ExpressionNode
  ifs: ExpressionNode[]
  is_async: number
}

// Await/yield
export interface AwaitNode extends ASTNode {
  type: 'Await'
  value: ExpressionNode
}

export interface YieldNode extends ASTNode {
  type: 'Yield'
  value?: ExpressionNode
}

export interface YieldFromNode extends ASTNode {
  type: 'YieldFrom'
  value: ExpressionNode
}

// Comparison
export interface CompareNode extends ASTNode {
  type: 'Compare'
  left: ExpressionNode
  ops: CompareOperatorType[]
  comparators: ExpressionNode[]
}

// Function call
export interface CallNode extends ASTNode {
  type: 'Call'
  func: ExpressionNode
  args: ExpressionNode[]
  keywords: KeywordNode[]
}

export interface KeywordNode extends ASTNode {
  type: 'keyword'
  arg?: string  // null for **kwargs
  value: ExpressionNode
}

// F-strings
export interface FormattedValueNode extends ASTNode {
  type: 'FormattedValue'
  value: ExpressionNode
  conversion: number  // -1 = none, 115 = 's', 114 = 'r', 97 = 'a'
  format_spec?: JoinedStrNode
}

export interface JoinedStrNode extends ASTNode {
  type: 'JoinedStr'
  values: (ConstantNode | FormattedValueNode)[]
}

// Constants (literals)
export interface ConstantNode extends ASTNode {
  type: 'Constant'
  value: string | number | boolean | null | bigint
  kind?: string  // For string prefixes
}

// Attribute access
export interface AttributeNode extends ASTNode {
  type: 'Attribute'
  value: ExpressionNode
  attr: string
  ctx?: ContextType
}

// Subscript access
export interface SubscriptNode extends ASTNode {
  type: 'Subscript'
  value: ExpressionNode
  slice: ExpressionNode
  ctx?: ContextType
}

// Starred expression
export interface StarredNode extends ASTNode {
  type: 'Starred'
  value: ExpressionNode
  ctx?: ContextType
}

// Name (identifier)
export interface NameNode extends ASTNode {
  type: 'Name'
  id: string
  ctx?: ContextType
}

// Slice
export interface SliceNode extends ASTNode {
  type: 'Slice'
  lower?: ExpressionNode
  upper?: ExpressionNode
  step?: ExpressionNode
}

// ============== Operators ==============

export type OperatorType =
  | 'Add'
  | 'Sub'
  | 'Mult'
  | 'MatMult'
  | 'Div'
  | 'Mod'
  | 'Pow'
  | 'LShift'
  | 'RShift'
  | 'BitOr'
  | 'BitXor'
  | 'BitAnd'
  | 'FloorDiv'

export type UnaryOperatorType =
  | 'Invert'  // ~
  | 'Not'     // not
  | 'UAdd'    // +
  | 'USub'    // -

export type CompareOperatorType =
  | 'Eq'
  | 'NotEq'
  | 'Lt'
  | 'LtE'
  | 'Gt'
  | 'GtE'
  | 'Is'
  | 'IsNot'
  | 'In'
  | 'NotIn'

export type ContextType = 'Load' | 'Store' | 'Del'
