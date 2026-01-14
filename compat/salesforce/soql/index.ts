/**
 * SOQL - Salesforce Object Query Language
 *
 * Parser and executor for SOQL queries.
 *
 * @module @dotdo/salesforce/soql
 */

// Lexer
export { Lexer, LexerError, TokenType, tokenize } from './lexer'
export type { Token } from './lexer'

// AST types
export type {
  BaseNode,
  SelectNode,
  FieldNode,
  SimpleFieldNode,
  RelationshipFieldNode,
  SubqueryNode,
  AggregateFieldNode,
  TypeOfNode,
  TypeOfWhenClause,
  FromNode,
  WhereNode,
  ComparisonNode,
  LogicalNode,
  InNode,
  LikeNode,
  IncludesExcludesNode,
  NotNode,
  ValueNode,
  StringValueNode,
  NumberValueNode,
  BooleanValueNode,
  NullValueNode,
  DateValueNode,
  DateTimeValueNode,
  DateLiteralNode,
  BindVariableNode,
  FieldRefNode,
  OrderByNode,
  ASTNode,
} from './ast'

// Parser
export { Parser, ParserError, parse } from './parser'

// Executor
export {
  Executor,
  InMemoryDataSource,
  executeQuery,
} from './executor'
export type {
  SObjectRecord,
  ExecutorResult,
  BindVariables,
  DataSource,
} from './executor'
