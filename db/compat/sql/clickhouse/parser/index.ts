/**
 * ClickHouse SQL Parser
 *
 * TypeScript implementation following ClickHouse's parser patterns.
 * Designed for WASM/Workers environments without native dependencies.
 *
 * @example
 * ```typescript
 * import { parse, formatAST, validateThingsQuery } from './parser'
 *
 * const ast = parse("SELECT data->>'$.user.email' FROM things WHERE type = 'customer'")
 * console.log(formatAST(ast))
 *
 * const validation = validateThingsQuery(ast)
 * if (!validation.valid) {
 *   console.error(validation.errors)
 * }
 * ```
 */

// AST Types
export type {
  ASTNode,
  StatementNode,
  ExpressionNode,
  SelectQueryNode,
  CreateTableNode,
  InsertNode,
  TableIdentifierNode,
  ColumnDefNode,
  EngineNode,
  IdentifierNode,
  LiteralNode,
  FunctionCallNode,
  BinaryOpNode,
  JSONPathNode,
  JSONCastNode,
  ArrayLiteralNode,
  StarNode,
  AliasNode,
  OrderByElementNode,
} from './ast'

// Lexer
export { Lexer, TokenType, tokenize, type Token } from './lexer'

// Parser
export { Parser, parse } from './parser'

// Visitors and utilities
export {
  walkAST,
  formatAST,
  validateThingsQuery,
  findFunctionCalls,
  findJSONPaths,
  hasVectorFunctions,
  hasFullTextSearch,
  type ASTVisitor,
  type VisitorCallback,
  type ValidationResult,
} from './visitors'
