/**
 * Benthos Config Schema Types
 * Issue: dotdo-sg0fx (GREEN phase)
 */

// Input Types
export interface KafkaInputConfig {
  addresses: string[]
  topics: string[]
  consumer_group?: string
  client_id?: string
  start_from_oldest?: boolean
  tls?: TLSConfig
}

export interface HttpServerInputConfig {
  path?: string
  allowed_verbs?: string[]
  timeout?: string
}

export interface AWSSQSInputConfig {
  url: string
  region?: string
  max_number_of_messages?: number
  wait_time_seconds?: number
}

export interface GenerateInputConfig {
  mapping: string
  interval?: string
  count?: number
}

export interface BrokerInputConfig {
  inputs: InputConfig[]
}

export interface StdinConfig {}

export interface InputConfig {
  kafka?: KafkaInputConfig
  http_server?: HttpServerInputConfig
  aws_sqs?: AWSSQSInputConfig
  generate?: GenerateInputConfig
  broker?: BrokerInputConfig
  stdin?: StdinConfig
  [key: string]: unknown
}

// Output Types
export interface KafkaOutputConfig {
  addresses: string[]
  topic: string
  key?: string
  partitioner?: string
  compression?: string
  tls?: TLSConfig
}

export interface HttpClientOutputConfig {
  url: string
  verb?: string
  headers?: Record<string, string>
  max_in_flight?: number
  batch_as_multipart?: boolean
}

export interface AWSS3OutputConfig {
  bucket: string
  path: string
  region?: string
}

export interface SwitchCase {
  check?: string
  output: OutputConfig
}

export interface SwitchOutputConfig {
  cases: SwitchCase[]
}

export interface BrokerOutputConfig {
  pattern?: 'fan_out' | 'fan_out_sequential' | 'round_robin' | 'greedy'
  outputs: OutputConfig[]
}

export interface DropConfig {}
export interface StdoutConfig {}

export interface OutputConfig {
  kafka?: KafkaOutputConfig
  http_client?: HttpClientOutputConfig
  aws_s3?: AWSS3OutputConfig
  switch?: SwitchOutputConfig
  broker?: BrokerOutputConfig
  drop?: DropConfig
  stdout?: StdoutConfig
  [key: string]: unknown
}

// Processor Types
export interface BranchProcessorConfig {
  request_map?: string
  processors?: ProcessorConfig[]
  result_map?: string
}

export interface CacheProcessorConfig {
  resource: string
  operator: 'get' | 'set' | 'add' | 'delete'
  key: string
  value?: string
  ttl?: string
}

export interface DedupeProcessorConfig {
  cache: string
  key: string
  drop_on_cache_err?: boolean
}

export interface RateLimitProcessorConfig {
  resource: string
}

export interface HttpProcessorConfig {
  url: string
  verb?: string
  headers?: Record<string, string>
}

export interface ParallelProcessorConfig {
  cap?: number
  processors: ProcessorConfig[]
}

export interface ProcessorConfig {
  mapping?: string
  branch?: BranchProcessorConfig
  cache?: CacheProcessorConfig
  dedupe?: DedupeProcessorConfig
  rate_limit?: RateLimitProcessorConfig
  http?: HttpProcessorConfig
  parallel?: ParallelProcessorConfig
  filter?: string
  try?: ProcessorConfig[]
  catch?: ProcessorConfig[]
  [key: string]: unknown
}

// Pipeline
export interface PipelineConfig {
  processors: ProcessorConfig[]
  threads?: number
}

// Cache Resources
export interface MemoryCacheConfig {
  ttl?: string
  compaction_interval?: string
  init_values?: Record<string, string>
}

export interface RedisCacheConfig {
  url: string
  default_ttl?: string
}

export interface CacheConfig {
  label: string
  memory?: MemoryCacheConfig
  redis?: RedisCacheConfig
  [key: string]: unknown
}

// Rate Limit Resources
export interface LocalRateLimitConfig {
  count: number
  interval: string
}

export interface RateLimitConfig {
  label: string
  local?: LocalRateLimitConfig
  [key: string]: unknown
}

// Buffer
export interface BatchPolicy {
  count?: number
  period?: string
  byte_size?: number
}

export interface MemoryBufferConfig {
  limit?: number
  batch_policy?: BatchPolicy
}

export interface BufferConfig {
  memory?: MemoryBufferConfig
  [key: string]: unknown
}

// Metrics
export interface PrometheusMetricsConfig {
  prefix?: string
  path?: string
}

export interface StatsdMetricsConfig {
  address: string
  flush_period?: string
  prefix?: string
}

export interface MetricsConfig {
  prometheus?: PrometheusMetricsConfig
  statsd?: StatsdMetricsConfig
  [key: string]: unknown
}

// Tracing
export interface JaegerTracingConfig {
  agent_address?: string
  service_name?: string
}

export interface TracingConfig {
  jaeger?: JaegerTracingConfig
  [key: string]: unknown
}

// Logger
export interface LoggerConfig {
  level?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
  format?: 'json' | 'logfmt'
}

// TLS
export interface TLSConfig {
  enabled?: boolean
  skip_cert_verify?: boolean
  root_cas?: string
  client_certs?: Array<{
    cert: string
    key: string
  }>
}

// Main Config
export interface BenthosConfig {
  input: InputConfig
  output: OutputConfig
  pipeline?: PipelineConfig
  cache_resources?: CacheConfig[]
  rate_limit_resources?: RateLimitConfig[]
  buffer?: BufferConfig
  metrics?: MetricsConfig
  tracer?: TracingConfig
  logger?: LoggerConfig
}

/**
 * Custom error for config validation failures
 */
export class ConfigValidationError extends Error {
  path?: string

  constructor(message: string, path?: string) {
    super(path ? `${message} at ${path}` : message)
    this.name = 'ConfigValidationError'
    this.path = path
  }
}

const KNOWN_INPUT_TYPES = [
  'kafka', 'http_server', 'aws_sqs', 'generate', 'broker', 'stdin',
  'amqp_0_9', 'amqp_1', 'aws_kinesis', 'aws_s3', 'azure_blob_storage',
  'file', 'gcp_pubsub', 'hdfs', 'inproc', 'mongodb', 'mqtt', 'nanomsg',
  'nats', 'nats_jetstream', 'nsq', 'pulsar', 'redis_list', 'redis_pubsub',
  'redis_streams', 'resource', 'socket', 'websocket'
]

const KNOWN_OUTPUT_TYPES = [
  'kafka', 'http_client', 'aws_s3', 'switch', 'broker', 'drop', 'stdout',
  'amqp_0_9', 'amqp_1', 'aws_kinesis', 'aws_sqs', 'azure_blob_storage',
  'cache', 'file', 'gcp_pubsub', 'hdfs', 'inproc', 'mongodb', 'mqtt',
  'nanomsg', 'nats', 'nats_jetstream', 'nsq', 'pulsar', 'redis_list',
  'redis_pubsub', 'redis_streams', 'resource', 'socket', 'websocket'
]

function getInputType(input: InputConfig): string | undefined {
  for (const key of Object.keys(input)) {
    if (input[key] !== undefined) return key
  }
  return undefined
}

function getOutputType(output: OutputConfig): string | undefined {
  for (const key of Object.keys(output)) {
    if (output[key] !== undefined) return key
  }
  return undefined
}

function validateInput(input: InputConfig, path: string): void {
  const inputType = getInputType(input)

  if (!inputType) {
    throw new ConfigValidationError('Input configuration is empty', path)
  }

  if (!KNOWN_INPUT_TYPES.includes(inputType)) {
    throw new ConfigValidationError(`Unknown input type: ${inputType}`, path)
  }

  // Validate specific input types
  if (inputType === 'kafka') {
    const kafka = input.kafka!
    if (!kafka.addresses || kafka.addresses.length === 0) {
      throw new ConfigValidationError('addresses is required', `${path}.kafka`)
    }
    if (!kafka.topics || kafka.topics.length === 0) {
      throw new ConfigValidationError('topics is required', `${path}.kafka`)
    }
  }

  if (inputType === 'broker' && input.broker) {
    input.broker.inputs.forEach((subInput, i) => {
      validateInput(subInput, `${path}.broker.inputs[${i}]`)
    })
  }
}

function validateOutput(output: OutputConfig, path: string): void {
  const outputType = getOutputType(output)

  if (!outputType) {
    throw new ConfigValidationError('Output configuration is empty', path)
  }

  if (!KNOWN_OUTPUT_TYPES.includes(outputType)) {
    throw new ConfigValidationError(`Unknown output type: ${outputType}`, path)
  }

  // Validate specific output types
  if (outputType === 'kafka') {
    const kafka = output.kafka!
    if (!kafka.addresses || kafka.addresses.length === 0) {
      throw new ConfigValidationError('addresses is required', `${path}.kafka`)
    }
    if (!kafka.topic) {
      throw new ConfigValidationError('topic is required', `${path}.kafka`)
    }
  }

  if (outputType === 'broker' && output.broker) {
    output.broker.outputs.forEach((subOutput, i) => {
      validateOutput(subOutput, `${path}.broker.outputs[${i}]`)
    })
  }

  if (outputType === 'switch' && output.switch) {
    output.switch.cases.forEach((switchCase, i) => {
      validateOutput(switchCase.output, `${path}.switch.cases[${i}].output`)
    })
  }
}

/**
 * Validate a Benthos configuration object
 */
export function validateConfig(config: BenthosConfig): void {
  if (!config.input) {
    throw new ConfigValidationError('input is required')
  }

  if (!config.output) {
    throw new ConfigValidationError('output is required')
  }

  validateInput(config.input, 'input')
  validateOutput(config.output, 'output')

  // Validate processors if present
  if (config.pipeline?.processors) {
    // Basic structure validation - processors are more flexible
  }

  // Validate cache resources
  if (config.cache_resources) {
    for (const cache of config.cache_resources) {
      if (!cache.label) {
        throw new ConfigValidationError('cache resource must have a label')
      }
    }
  }

  // Validate rate limit resources
  if (config.rate_limit_resources) {
    for (const limit of config.rate_limit_resources) {
      if (!limit.label) {
        throw new ConfigValidationError('rate limit resource must have a label')
      }
    }
  }
}
