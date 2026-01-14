/**
 * AST Visitor Pattern
 *
 * Provides a visitor interface for traversing Python ASTs.
 */

import type {
  ASTNode,
  ModuleNode,
  ImportNode,
  ImportFromNode,
  FunctionDefNode,
  ClassDefNode,
  AssignNode,
  AugAssignNode,
  AnnAssignNode,
  IfNode,
  ForNode,
  WhileNode,
  WithNode,
  MatchNode,
  MatchCaseNode,
  TryNode,
  ExceptHandlerNode,
  RaiseNode,
  ReturnNode,
  DeleteNode,
  PassNode,
  BreakNode,
  ContinueNode,
  GlobalNode,
  NonlocalNode,
  AssertNode,
  ExprStmtNode,
  TypeAliasNode,
  BoolOpNode,
  NamedExprNode,
  BinOpNode,
  UnaryOpNode,
  LambdaNode,
  IfExpNode,
  DictNode,
  SetNode,
  ListNode,
  TupleNode,
  ListCompNode,
  SetCompNode,
  DictCompNode,
  GeneratorExpNode,
  ComprehensionNode,
  AwaitNode,
  YieldNode,
  YieldFromNode,
  CompareNode,
  CallNode,
  FormattedValueNode,
  JoinedStrNode,
  ConstantNode,
  AttributeNode,
  SubscriptNode,
  StarredNode,
  NameNode,
  SliceNode,
  ArgumentsNode,
  ArgNode,
  KeywordNode,
  WithItemNode,
  PatternNode,
} from './types.js'

/**
 * Base visitor class with default implementations that traverse all children.
 * Override specific visit_* methods to customize behavior.
 */
export abstract class ASTVisitor<T = void> {
  /**
   * Visit any AST node (dispatcher)
   */
  visit(node: ASTNode): T {
    const methodName = `visit_${node.type}` as keyof this
    const method = this[methodName] as ((node: ASTNode) => T) | undefined

    if (method && typeof method === 'function') {
      return method.call(this, node)
    }

    return this.generic_visit(node)
  }

  /**
   * Default visit behavior - traverse all child nodes
   */
  generic_visit(node: ASTNode): T {
    for (const key of Object.keys(node)) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (this.isNode(item)) {
            this.visit(item)
          }
        }
      } else if (this.isNode(value)) {
        this.visit(value)
      }
    }
    return undefined as T
  }

  /**
   * Type guard for AST nodes
   */
  protected isNode(value: unknown): value is ASTNode {
    return typeof value === 'object' && value !== null && 'type' in value
  }

  // Module
  visit_Module(node: ModuleNode): T {
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  // Statements
  visit_Import(node: ImportNode): T {
    return this.generic_visit(node)
  }

  visit_ImportFrom(node: ImportFromNode): T {
    return this.generic_visit(node)
  }

  visit_FunctionDef(node: FunctionDefNode): T {
    for (const decorator of node.decorator_list) {
      this.visit(decorator)
    }
    this.visit(node.args)
    if (node.returns) {
      this.visit(node.returns)
    }
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_AsyncFunctionDef(node: FunctionDefNode): T {
    return this.visit_FunctionDef(node)
  }

  visit_ClassDef(node: ClassDefNode): T {
    for (const decorator of node.decorator_list) {
      this.visit(decorator)
    }
    for (const base of node.bases) {
      this.visit(base)
    }
    for (const keyword of node.keywords) {
      this.visit(keyword)
    }
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_Return(node: ReturnNode): T {
    if (node.value) {
      this.visit(node.value)
    }
    return undefined as T
  }

  visit_Delete(node: DeleteNode): T {
    for (const target of node.targets) {
      this.visit(target)
    }
    return undefined as T
  }

  visit_Assign(node: AssignNode): T {
    for (const target of node.targets) {
      this.visit(target)
    }
    this.visit(node.value)
    return undefined as T
  }

  visit_AugAssign(node: AugAssignNode): T {
    this.visit(node.target)
    this.visit(node.value)
    return undefined as T
  }

  visit_AnnAssign(node: AnnAssignNode): T {
    this.visit(node.target)
    this.visit(node.annotation)
    if (node.value) {
      this.visit(node.value)
    }
    return undefined as T
  }

  visit_For(node: ForNode): T {
    this.visit(node.target)
    this.visit(node.iter)
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    for (const stmt of node.orelse) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_AsyncFor(node: ForNode): T {
    return this.visit_For(node)
  }

  visit_While(node: WhileNode): T {
    this.visit(node.test)
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    for (const stmt of node.orelse) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_If(node: IfNode): T {
    this.visit(node.test)
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    for (const stmt of node.orelse) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_With(node: WithNode): T {
    for (const item of node.items) {
      this.visit(item)
    }
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_AsyncWith(node: WithNode): T {
    return this.visit_With(node)
  }

  visit_Match(node: MatchNode): T {
    this.visit(node.subject)
    for (const case_ of node.cases) {
      this.visit(case_)
    }
    return undefined as T
  }

  visit_Raise(node: RaiseNode): T {
    if (node.exc) {
      this.visit(node.exc)
    }
    if (node.cause) {
      this.visit(node.cause)
    }
    return undefined as T
  }

  visit_Try(node: TryNode): T {
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    for (const handler of node.handlers) {
      this.visit(handler)
    }
    for (const stmt of node.orelse) {
      this.visit(stmt)
    }
    for (const stmt of node.finalbody) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_Assert(node: AssertNode): T {
    this.visit(node.test)
    if (node.msg) {
      this.visit(node.msg)
    }
    return undefined as T
  }

  visit_Global(_node: GlobalNode): T {
    return undefined as T
  }

  visit_Nonlocal(_node: NonlocalNode): T {
    return undefined as T
  }

  visit_Expr(node: ExprStmtNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_Pass(_node: PassNode): T {
    return undefined as T
  }

  visit_Break(_node: BreakNode): T {
    return undefined as T
  }

  visit_Continue(_node: ContinueNode): T {
    return undefined as T
  }

  visit_TypeAlias(node: TypeAliasNode): T {
    this.visit(node.name)
    this.visit(node.value)
    return undefined as T
  }

  // Expressions
  visit_BoolOp(node: BoolOpNode): T {
    for (const value of node.values) {
      this.visit(value)
    }
    return undefined as T
  }

  visit_NamedExpr(node: NamedExprNode): T {
    this.visit(node.target)
    this.visit(node.value)
    return undefined as T
  }

  visit_BinOp(node: BinOpNode): T {
    this.visit(node.left)
    this.visit(node.right)
    return undefined as T
  }

  visit_UnaryOp(node: UnaryOpNode): T {
    this.visit(node.operand)
    return undefined as T
  }

  visit_Lambda(node: LambdaNode): T {
    this.visit(node.args)
    this.visit(node.body)
    return undefined as T
  }

  visit_IfExp(node: IfExpNode): T {
    this.visit(node.test)
    this.visit(node.body)
    this.visit(node.orelse)
    return undefined as T
  }

  visit_Dict(node: DictNode): T {
    for (const key of node.keys) {
      if (key) this.visit(key)
    }
    for (const value of node.values) {
      this.visit(value)
    }
    return undefined as T
  }

  visit_Set(node: SetNode): T {
    for (const elt of node.elts) {
      this.visit(elt)
    }
    return undefined as T
  }

  visit_ListComp(node: ListCompNode): T {
    this.visit(node.elt)
    for (const gen of node.generators) {
      this.visit(gen)
    }
    return undefined as T
  }

  visit_SetComp(node: SetCompNode): T {
    this.visit(node.elt)
    for (const gen of node.generators) {
      this.visit(gen)
    }
    return undefined as T
  }

  visit_DictComp(node: DictCompNode): T {
    this.visit(node.key)
    this.visit(node.value)
    for (const gen of node.generators) {
      this.visit(gen)
    }
    return undefined as T
  }

  visit_GeneratorExp(node: GeneratorExpNode): T {
    this.visit(node.elt)
    for (const gen of node.generators) {
      this.visit(gen)
    }
    return undefined as T
  }

  visit_Await(node: AwaitNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_Yield(node: YieldNode): T {
    if (node.value) {
      this.visit(node.value)
    }
    return undefined as T
  }

  visit_YieldFrom(node: YieldFromNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_Compare(node: CompareNode): T {
    this.visit(node.left)
    for (const comp of node.comparators) {
      this.visit(comp)
    }
    return undefined as T
  }

  visit_Call(node: CallNode): T {
    this.visit(node.func)
    for (const arg of node.args) {
      this.visit(arg)
    }
    for (const keyword of node.keywords) {
      this.visit(keyword)
    }
    return undefined as T
  }

  visit_FormattedValue(node: FormattedValueNode): T {
    this.visit(node.value)
    if (node.format_spec) {
      this.visit(node.format_spec)
    }
    return undefined as T
  }

  visit_JoinedStr(node: JoinedStrNode): T {
    for (const value of node.values) {
      this.visit(value)
    }
    return undefined as T
  }

  visit_Constant(_node: ConstantNode): T {
    return undefined as T
  }

  visit_Attribute(node: AttributeNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_Subscript(node: SubscriptNode): T {
    this.visit(node.value)
    this.visit(node.slice)
    return undefined as T
  }

  visit_Starred(node: StarredNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_Name(_node: NameNode): T {
    return undefined as T
  }

  visit_List(node: ListNode): T {
    for (const elt of node.elts) {
      this.visit(elt)
    }
    return undefined as T
  }

  visit_Tuple(node: TupleNode): T {
    for (const elt of node.elts) {
      this.visit(elt)
    }
    return undefined as T
  }

  visit_Slice(node: SliceNode): T {
    if (node.lower) this.visit(node.lower)
    if (node.upper) this.visit(node.upper)
    if (node.step) this.visit(node.step)
    return undefined as T
  }

  // Helper nodes
  visit_arguments(node: ArgumentsNode): T {
    for (const arg of node.args) {
      this.visit(arg)
    }
    for (const arg of node.kwonlyargs) {
      this.visit(arg)
    }
    if (node.vararg) this.visit(node.vararg)
    if (node.kwarg) this.visit(node.kwarg)
    for (const def of node.defaults) {
      this.visit(def)
    }
    for (const def of node.kw_defaults) {
      if (def) this.visit(def)
    }
    return undefined as T
  }

  visit_arg(node: ArgNode): T {
    if (node.annotation) {
      this.visit(node.annotation)
    }
    return undefined as T
  }

  visit_keyword(node: KeywordNode): T {
    this.visit(node.value)
    return undefined as T
  }

  visit_withitem(node: WithItemNode): T {
    this.visit(node.context_expr)
    if (node.optional_vars) {
      this.visit(node.optional_vars)
    }
    return undefined as T
  }

  visit_match_case(node: MatchCaseNode): T {
    this.visit(node.pattern)
    if (node.guard) {
      this.visit(node.guard)
    }
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_ExceptHandler(node: ExceptHandlerNode): T {
    if (node.type_) {
      this.visit(node.type_)
    }
    for (const stmt of node.body) {
      this.visit(stmt)
    }
    return undefined as T
  }

  visit_comprehension(node: ComprehensionNode): T {
    this.visit(node.target)
    this.visit(node.iter)
    for (const if_ of node.ifs) {
      this.visit(if_)
    }
    return undefined as T
  }

  // Pattern nodes
  visit_MatchValue(node: PatternNode): T {
    return this.generic_visit(node)
  }

  visit_MatchSingleton(_node: PatternNode): T {
    return undefined as T
  }

  visit_MatchSequence(node: PatternNode): T {
    return this.generic_visit(node)
  }

  visit_MatchMapping(node: PatternNode): T {
    return this.generic_visit(node)
  }

  visit_MatchClass(node: PatternNode): T {
    return this.generic_visit(node)
  }

  visit_MatchStar(_node: PatternNode): T {
    return undefined as T
  }

  visit_MatchAs(node: PatternNode): T {
    return this.generic_visit(node)
  }

  visit_MatchOr(node: PatternNode): T {
    return this.generic_visit(node)
  }
}

/**
 * Transformer class that can modify the AST.
 * Visit methods can return a new node to replace the visited node.
 */
export abstract class ASTTransformer extends ASTVisitor<ASTNode | null> {
  /**
   * Visit a node and potentially replace it
   */
  visit(node: ASTNode): ASTNode {
    const methodName = `visit_${node.type}` as keyof this
    const method = this[methodName] as ((node: ASTNode) => ASTNode | null) | undefined

    if (method && typeof method === 'function') {
      const result = method.call(this, node)
      return result ?? node
    }

    return this.generic_visit(node) ?? node
  }

  /**
   * Default transform behavior - traverse and potentially replace children
   */
  generic_visit(node: ASTNode): ASTNode {
    const newNode = { ...node } as unknown as Record<string, unknown>

    for (const key of Object.keys(node)) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        const newArray: unknown[] = []
        for (const item of value) {
          if (this.isNode(item)) {
            const newItem = this.visit(item)
            if (newItem !== null) {
              newArray.push(newItem)
            }
          } else {
            newArray.push(item)
          }
        }
        newNode[key] = newArray
      } else if (this.isNode(value)) {
        const newValue = this.visit(value)
        newNode[key] = newValue
      }
    }

    return newNode as unknown as ASTNode
  }
}

/**
 * Walk through an AST, yielding each node
 */
export function* walk(node: ASTNode): Generator<ASTNode> {
  yield node

  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isASTNode(item)) {
          yield* walk(item)
        }
      }
    } else if (isASTNode(value)) {
      yield* walk(value)
    }
  }
}

/**
 * Type guard for AST nodes
 */
function isASTNode(value: unknown): value is ASTNode {
  return typeof value === 'object' && value !== null && 'type' in value
}

/**
 * Get all nodes of a specific type from an AST
 */
export function getNodesOfType<T extends ASTNode>(
  root: ASTNode,
  type: string | string[]
): T[] {
  const types = Array.isArray(type) ? type : [type]
  const result: T[] = []

  for (const node of walk(root)) {
    if (types.includes(node.type)) {
      result.push(node as T)
    }
  }

  return result
}

/**
 * Find the first node matching a predicate
 */
export function findNode(
  root: ASTNode,
  predicate: (node: ASTNode) => boolean
): ASTNode | undefined {
  for (const node of walk(root)) {
    if (predicate(node)) {
      return node
    }
  }
  return undefined
}

/**
 * Find all nodes matching a predicate
 */
export function findNodes(
  root: ASTNode,
  predicate: (node: ASTNode) => boolean
): ASTNode[] {
  const result: ASTNode[] = []
  for (const node of walk(root)) {
    if (predicate(node)) {
      result.push(node)
    }
  }
  return result
}
