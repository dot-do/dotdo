/**
 * Query Engine
 *
 * Unified query primitive for Document/Analytics/Search/Graph workloads.
 * Parses multiple query syntaxes into unified AST, compiles to TypedColumnStore
 * predicates, and plans/executes queries with cost estimation.
 *
 * @example
 * ```typescript
 * import {
 *   MongoQueryParser,
 *   SQLWhereParser,
 *   PredicateCompiler,
 *   QueryPlanner,
 *   ExecutionEngine,
 * } from './query-engine'
 *
 * // Parse MongoDB query
 * const mongoParser = new MongoQueryParser()
 * const ast = mongoParser.parse({ age: { $gt: 21 } })
 *
 * // Compile to TypedColumnStore predicates
 * const compiler = new PredicateCompiler()
 * const compiled = compiler.compile(ast)
 *
 * // Plan execution
 * const planner = new QueryPlanner()
 * const plan = planner.plan(ast, 'users')
 *
 * // Execute
 * const engine = new ExecutionEngine()
 * const result = await engine.execute(plan, { columnStore })
 * ```
 *
 * @see dotdo-zd66s
 */

// =============================================================================
// AST Types and Helpers
// =============================================================================

export {
  // Types
  type ComparisonOp,
  type DistanceMetric,
  type AggregateFunction,
  type ArithmeticOperator,
  type LogicalOperator,
  type JoinType,
  type TraversalDirection,
  type SortDirection,
  type NullsOrder,

  // Node Types
  type PredicateNode,
  type LogicalNode,
  type ExpressionNode,
  type ColumnSpec,
  type ProjectionNode,
  type AggregationNode,
  type AliasedAggregation,
  type GroupByNode,
  type SortColumn,
  type SortNode,
  type ColumnRef,
  type JoinNode,
  type TraversalNode,
  type QueryNode,

  // Node Creators
  createPredicate,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inSet,
  notInSet,
  between,
  like,
  contains,
  startsWith,
  isNull,
  isNotNull,
  near,
  and,
  or,
  not,
  createExpression,
  createProjection,
  select,
  exclude,
  createAggregation,
  count,
  sum,
  avg,
  min,
  max,
  createGroupBy,
  createSort,
  asc,
  desc,
  createJoin,
  innerJoin,
  leftJoin,
  rightJoin,
  createTraversal,
  ref,

  // Visitor Pattern
  type ASTVisitor,
  visit,
  BaseVisitor,
  ColumnCollector,
  collectColumns,

  // Type Guards
  isPredicate,
  isLogical,
  isProjection,
  isAggregation,
  isGroupBy,
  isSort,
  isJoin,
  isTraversal,
  isColumnRef,
} from './ast'

// =============================================================================
// Predicate Compiler
// =============================================================================

export {
  PredicateCompiler,
  type TCSPredicate,
  type ColumnStatistics,
  type CompilationOptions,
  type VectorConfig,
  type CompiledPredicate,
  type CompilationBranch,
  type CompilationResult,
} from './compiler/predicate-compiler'

// =============================================================================
// Parsers
// =============================================================================

export {
  MongoQueryParser,
  type MongoQuery,
  type AggregationPipeline,
  type ParsedPipeline,
} from './parsers/mongo-parser'

export {
  SQLWhereParser,
  ParseError,
  SQL_KEYWORDS,
  type ParsedSelect,
} from './parsers/sql-parser'

// =============================================================================
// Common Utilities
// =============================================================================

export {
  // Tokenizer
  Tokenizer,
  TokenType,
  TokenizerError,
  type Token,
  type TokenizerOptions,

  // AST Builder
  ASTBuilder,

  // Value Parsing
  parseStringLiteral,
  parseNumericLiteral,
  parseBooleanLiteral,

  // Predicate Evaluation (shared by MongoDB, SQL, etc.)
  getNestedValue,
  compareValues,
  compareEquality,
  evaluatePredicate,
  evaluatePredicatesAnd,
  evaluatePredicatesOr,
  type PredicateOp,
  type EvalPredicate,
} from './parsers/common'

// =============================================================================
// Query Planner
// =============================================================================

export {
  QueryPlanner,
  type TableStatistics,
  type IndexInfo,
  type CostModel,
  type QueryPlan,
  type PlanNode,
} from './planner/query-planner'

// =============================================================================
// Execution Engine
// =============================================================================

export {
  ExecutionEngine,
  type ColumnBatch,
  type BloomFilter,
  type MinMaxStats,
  type TypedColumnStore,
  type ExecutionContext,
  type ExecutionStats,
  type ExecutionResult,
} from './executor/execution-engine'
