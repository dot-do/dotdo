/**
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * A lightweight, edge-compatible implementation of Benthos stream processing
 * with an in-memory backend for Cloudflare Workers.
 *
 * @example
 * ```typescript
 * import { PipelineExecutor, createMessage, MappingProcessor } from '@dotdo/benthos'
 *
 * // Create a pipeline
 * const executor = new PipelineExecutor({
 *   input: { stdin: {} },
 *   output: { stdout: {} }
 * })
 *
 * // Add processors
 * executor.addProcessor(new MappingProcessor({
 *   expression: 'root.value.uppercase()'
 * }))
 *
 * // Process messages
 * await executor.start()
 * await executor.processOnce()
 * await executor.stop()
 * ```
 */

// Core message types
export {
  BenthosMessage,
  BenthosBatch,
  MessageMetadata,
  createMessage,
  createBatch,
  isMessage,
  isBatch,
  type Message,
  type Batch,
  type MessageOptions,
} from './message'

// Configuration
export {
  type BenthosConfig,
  type InputConfig,
  type OutputConfig,
  type ProcessorConfig as ConfigProcessorConfig,
  type PipelineConfig,
  type CacheConfig,
  type RateLimitConfig,
  type BufferConfig,
  type MetricsConfig,
  type TracingConfig,
  type LoggerConfig,
  type TLSConfig,
  type KafkaInputConfig,
  type HttpServerInputConfig,
  type AWSSQSInputConfig,
  type GenerateInputConfig as ConfigGenerateInputConfig,
  type BrokerInputConfig,
  type KafkaOutputConfig,
  type HttpClientOutputConfig,
  type AWSS3OutputConfig,
  type SwitchOutputConfig,
  type BrokerOutputConfig,
  ConfigValidationError,
  validateConfig,
} from './config'

// Pipeline execution
export {
  PipelineExecutor,
  type Processor as PipelineProcessor,
  type Input as PipelineInput,
  type Output as PipelineOutput,
  type RetryPolicy,
  type Metrics,
  type Status,
} from './pipeline'

// Processors
export {
  MappingProcessor,
  FilterProcessor,
  createProcessor,
  type Processor,
  type ProcessorConfig,
  type ProcessorContext,
  type ProcessorResult,
  type MappingProcessorConfig,
  type FilterProcessorConfig,
} from './processors'

// Input/Output connectors
export {
  createGenerateInput,
  createHttpServerInput,
  createOutput,
  StdoutOutput,
  DropOutput,
  HttpClientOutput,
  BaseOutput,
  isOutput,
  type Input,
  type Output,
  type OutputMetrics,
  type StartResult,
  type AckResult,
  type CloseResult,
  type InputMessage,
  type GenerateInputConfig,
  type HttpServerInputConfig,
  type StdoutOutputConfig,
  type DropOutputConfig,
  type HttpClientOutputConfig as ConnectorHttpClientOutputConfig,
  type OutputConfig as ConnectorOutputConfig,
} from './connectors'

// Bloblang
export { parse, createParser, Parser, ParseError } from './bloblang/parser'
export { Lexer, LexerError, TokenType, type Token } from './bloblang/lexer'
export { Interpreter, evaluate, createInterpreterContext, DELETED, NOTHING, type InterpreterContext } from './bloblang/interpreter'
export type {
  ASTNode,
  LiteralNode,
  IdentifierNode,
  RootNode,
  ThisNode,
  MetaNode,
  DeletedNode,
  NothingNode,
  BinaryOpNode,
  UnaryOpNode,
  MemberAccessNode,
  CallNode,
  ArrayNode,
  ObjectNode,
  IfNode,
  MatchNode,
  LetNode,
  PipeNode,
  ArrowNode,
  AssignNode,
  SequenceNode,
  BinaryOperator,
  UnaryOperator,
  LiteralKind,
} from './bloblang/ast'

// Standard library
export { stringFunctions } from './bloblang/stdlib/string'
export * as arrayFunctions from './bloblang/stdlib/array'
export * as numberFunctions from './bloblang/stdlib/number'
export * as objectFunctions from './bloblang/stdlib/object'
export * as typeFunctions from './bloblang/stdlib/type'
