/**
 * Query Engine - Unified Query Processing for Multiple Syntaxes
 *
 * A comprehensive query primitive supporting Document (MongoDB), SQL, and Graph
 * (Cypher) query syntaxes. Parses queries into a unified AST, applies cost-based
 * optimization, and executes against TypedColumnStore.
 *
 * ## Architecture
 * ```
 * Query String -> Parser -> Unified AST -> Compiler -> Planner -> Executor
 *     |              |           |             |           |          |
 *   MongoDB       SQL/Cypher  PredicateNode  TCSPredicate QueryPlan Result
 * ```
 *
 * ## Features
 * - **Multi-Syntax Parsing** - MongoDB, SQL WHERE, Cypher (graph)
 * - **Unified AST** - Common representation for all query languages
 * - **Cost-Based Planning** - Statistics-driven join ordering and index selection
 * - **Index Optimization** - Bloom filters, min/max pruning, B-tree scans
 * - **Memory Management** - 128MB budget awareness for Workers runtime
 * - **Predicate Pushdown** - Filters pushed to storage layer
 * - **Vector Search** - k-NN support for embeddings
 *
 * ## Components
 * | Component | Purpose |
 * |-----------|---------|
 * | MongoQueryParser | Parse MongoDB find/aggregation queries |
 * | SQLWhereParser | Parse SQL WHERE clauses and SELECT statements |
 * | PredicateCompiler | Convert AST to TypedColumnStore predicates |
 * | QueryPlanner | Cost-based query plan optimization |
 * | ExecutionEngine | Execute plans with streaming/batching |
 *
 * @example MongoDB Query
 * ```typescript
 * import { MongoQueryParser, PredicateCompiler } from 'dotdo/db/primitives/query-engine'
 *
 * const parser = new MongoQueryParser()
 * const ast = parser.parse({
 *   status: 'active',
 *   age: { $gte: 21, $lt: 65 },
 *   tags: { $in: ['premium', 'vip'] },
 * })
 *
 * const compiler = new PredicateCompiler()
 * const { predicates } = compiler.compile(ast)
 * // Optimized predicates with bloom filter hints, etc.
 * ```
 *
 * @example SQL Query
 * ```typescript
 * import { SQLWhereParser } from 'dotdo/db/primitives/query-engine'
 *
 * const parser = new SQLWhereParser()
 * const ast = parser.parse(`
 *   SELECT id, name, email
 *   FROM users
 *   WHERE status = 'active' AND created_at > '2024-01-01'
 *   ORDER BY name ASC
 *   LIMIT 100
 * `)
 * ```
 *
 * @example Full Pipeline
 * ```typescript
 * import {
 *   MongoQueryParser,
 *   PredicateCompiler,
 *   QueryPlanner,
 *   ExecutionEngine,
 * } from 'dotdo/db/primitives/query-engine'
 *
 * // Parse -> Compile -> Plan -> Execute
 * const ast = new MongoQueryParser().parse(query)
 * const compiled = new PredicateCompiler().compile(ast)
 *
 * const planner = new QueryPlanner()
 * planner.setStatistics('users', {
 *   rowCount: 1_000_000,
 *   distinctCounts: new Map([['status', 5], ['country', 200]]),
 * })
 * const plan = planner.plan(ast, 'users')
 *
 * const engine = new ExecutionEngine()
 * const result = await engine.execute(plan, { columnStore })
 * ```
 *
 * @see dotdo-zd66s
 * @module db/primitives/query-engine
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

export {
  ElasticsearchParser,
  type ElasticsearchQuery,
  type ParsedElasticsearch,
} from './parsers/elasticsearch-parser'

export {
  CypherParser,
  CYPHER_KEYWORDS,
  type ParsedCypher,
  type ParsedNode,
  type ParsedRelationship,
} from './parsers/cypher-parser'

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

// =============================================================================
// Memory Configuration
// =============================================================================

export {
  // Constants
  MEMORY_BUDGETS,
  type MemoryBudgetKey,

  // Size Estimation
  estimateRowSetSize,
  estimateHashTableSize,
  estimateSortBufferSize,

  // Decision Functions
  shouldSpillToDisk,
  shouldAbortQuery,
  shouldUseStreaming,
  shouldUseExternalSort,
  isHashJoinBuildSideTooLarge,

  // Memory Pressure
  assessMemoryPressure,
  type MemoryPressureLevel,
  type MemoryPressureState,

  // Batch Size
  calculateOptimalBatchSize,

  // Execution Hints
  generateExecutionHints,
  type ExecutionHints,
} from './memory-config'
