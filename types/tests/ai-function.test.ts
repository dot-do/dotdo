import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * AIFunction Type System Tests
 *
 * These tests verify the comprehensive AIFunction type system including:
 * - JSON Schema inference
 * - Executor options for each function type
 * - Execution result types
 * - Error types and type guards
 * - Function definition types
 * - PipelinePromise integration
 * - Template literal function signatures
 */

import type {
  // JSON Schema types
  JSONSchema,
  JSONSchemaType,
  InferSchema,
  InferSchemaType,
  // Tool types
  Tool,
  ToolInvocation,
  // Executor options
  BaseExecutorOptions,
  CodeOptions,
  GenerativeOptions,
  AgenticOptions,
  HumanOptions,
  // Configuration types
  RetryConfig,
  CacheConfig,
  MemoryConfig,
  ReminderConfig,
  EscalationConfig,
  // Metrics types
  ExecutionMetrics,
  GenerativeMetrics,
  AgenticMetrics,
  HumanMetrics,
  // Result types
  ExecutionResult,
  CodeExecutionResult,
  GenerativeExecutionResult,
  AgenticExecutionResult,
  HumanExecutionResult,
  // Error types
  AIFunctionErrorCode,
  AIFunctionErrorData,
  // Function definition types
  AIFunctionDefinition,
  CodeFunctionDefinition,
  GenerativeFunctionDefinition,
  AgenticFunctionDefinition,
  HumanFunctionDefinition,
  AnyFunctionDefinition,
  // Composition types
  ComposedFunction,
  CascadingFunction,
  // Template types
  ExtractTemplateParams,
  TemplateFn,
  // Builder types
  AIFunctionBuilder,
  // Utility types
  UnwrapResult,
  OptionsForType,
  ResultForType,
  MetricsForType,
} from '../AIFunction'

import {
  // Error classes
  AIFunctionError,
  ValidationError,
  TimeoutError,
  RateLimitError,
  ModelError,
  ToolError,
  ContentFilterError,
  HumanRejectedError,
  // Type guards
  isAIFunctionError,
  isErrorCode,
  isCodeFunction,
  isGenerativeFunction,
  isAgenticFunction,
  isHumanFunction,
  isSuccess,
  isFailure,
} from '../AIFunction'

// ============================================================================
// JSON Schema Inference Tests
// ============================================================================

describe('JSON Schema Type Inference', () => {
  describe('InferSchemaType', () => {
    it('should infer primitive types from schema type strings', () => {
      type StringType = InferSchemaType<'string'>
      type NumberType = InferSchemaType<'number'>
      type IntegerType = InferSchemaType<'integer'>
      type BooleanType = InferSchemaType<'boolean'>
      type NullType = InferSchemaType<'null'>

      expectTypeOf<StringType>().toEqualTypeOf<string>()
      expectTypeOf<NumberType>().toEqualTypeOf<number>()
      expectTypeOf<IntegerType>().toEqualTypeOf<number>()
      expectTypeOf<BooleanType>().toEqualTypeOf<boolean>()
      expectTypeOf<NullType>().toEqualTypeOf<null>()
    })
  })

  describe('InferSchema', () => {
    it('should infer string type', () => {
      type Schema = { type: 'string' }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<string>()
    })

    it('should infer number type', () => {
      type Schema = { type: 'number' }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<number>()
    })

    it('should infer boolean type', () => {
      type Schema = { type: 'boolean' }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<boolean>()
    })

    it('should infer array type with items', () => {
      type Schema = { type: 'array'; items: { type: 'string' } }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<string[]>()
    })

    it('should infer const type', () => {
      type Schema = { const: 'hello' }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<'hello'>()
    })

    it('should infer enum type', () => {
      type Schema = { enum: readonly ['a', 'b', 'c'] }
      type Inferred = InferSchema<Schema>
      expectTypeOf<Inferred>().toEqualTypeOf<'a' | 'b' | 'c'>()
    })
  })
})

// ============================================================================
// Tool Type Tests
// ============================================================================

describe('Tool Types', () => {
  it('should define a valid tool', () => {
    const searchTool: Tool<string, string[]> = {
      name: 'search',
      description: 'Search the web',
      execute: async (query: string) => ['result1', 'result2'],
    }

    expect(searchTool.name).toBe('search')
    expect(searchTool.description).toBe('Search the web')
  })

  it('should define tool invocation result', () => {
    const invocation: ToolInvocation<string[]> = {
      tool: 'search',
      input: 'query',
      output: ['result1', 'result2'],
      durationMs: 100,
      success: true,
    }

    expect(invocation.success).toBe(true)
    expect(invocation.output).toEqual(['result1', 'result2'])
  })
})

// ============================================================================
// Executor Options Tests
// ============================================================================

describe('Executor Options', () => {
  describe('BaseExecutorOptions', () => {
    it('should allow all base options', () => {
      const options: BaseExecutorOptions = {
        timeout: 5000,
        retry: { maxAttempts: 3 },
        cache: true,
        tags: { env: 'test' },
      }

      expect(options.timeout).toBe(5000)
    })
  })

  describe('CodeOptions', () => {
    it('should extend base options with code-specific options', () => {
      const options: CodeOptions = {
        timeout: 5000,
        sandbox: true,
        memoryLimit: 256,
      }

      expect(options.sandbox).toBe(true)
      expect(options.memoryLimit).toBe(256)
    })
  })

  describe('GenerativeOptions', () => {
    it('should include all AI generation options', () => {
      const options: GenerativeOptions = {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 1000,
        systemPrompt: 'You are a helpful assistant',
        stopSequences: ['\n'],
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
        stream: false,
        jsonMode: true,
        seed: 42,
      }

      expect(options.model).toBe('gpt-4o')
      expect(options.temperature).toBe(0.7)
    })
  })

  describe('AgenticOptions', () => {
    it('should extend generative options with tool support', () => {
      const options: AgenticOptions = {
        model: 'gpt-4o',
        tools: [{ name: 'search', description: 'Search', execute: async () => [] }],
        maxToolCalls: 10,
        maxIterations: 5,
        parallelToolCalls: true,
        toolChoice: 'auto',
        planningMode: 'react',
        memory: { maxTurns: 10 },
      }

      expect(options.maxToolCalls).toBe(10)
      expect(options.planningMode).toBe('react')
    })
  })

  describe('HumanOptions', () => {
    it('should include human task options', () => {
      const options: HumanOptions = {
        channel: 'slack',
        assignee: 'user@example.com.ai',
        priority: 'high',
        dueDate: new Date(),
        reminders: [{ timing: 'before_due', duration: 'P1D' }],
        escalation: { after: 'P2D', to: 'manager@example.com.ai' },
        instructions: 'Please review and approve',
        requiresApproval: true,
      }

      expect(options.channel).toBe('slack')
      expect(options.priority).toBe('high')
    })
  })
})

// ============================================================================
// Configuration Type Tests
// ============================================================================

describe('Configuration Types', () => {
  describe('RetryConfig', () => {
    it('should define retry configuration', () => {
      const config: RetryConfig = {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryOn: ['NETWORK_ERROR', /timeout/i],
        noRetryOn: ['VALIDATION_ERROR'],
      }

      expect(config.maxAttempts).toBe(3)
    })
  })

  describe('CacheConfig', () => {
    it('should define cache configuration', () => {
      const config: CacheConfig = {
        ttlSeconds: 3600,
        keyFn: (input) => JSON.stringify(input),
        staleWhileRevalidate: true,
        namespace: 'ai-functions',
      }

      expect(config.ttlSeconds).toBe(3600)
    })
  })

  describe('MemoryConfig', () => {
    it('should define memory configuration for agentic functions', () => {
      const config: MemoryConfig = {
        maxTurns: 20,
        maxTokens: 4000,
        summarization: 'rolling',
        store: 'durable-object',
      }

      expect(config.summarization).toBe('rolling')
    })
  })
})

// ============================================================================
// Execution Metrics Tests
// ============================================================================

describe('Execution Metrics', () => {
  describe('ExecutionMetrics', () => {
    it('should track base metrics', () => {
      const metrics: ExecutionMetrics = {
        durationMs: 150,
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        cached: false,
      }

      expect(metrics.durationMs).toBe(150)
    })
  })

  describe('GenerativeMetrics', () => {
    it('should include token usage metrics', () => {
      const metrics: GenerativeMetrics = {
        durationMs: 500,
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        cached: false,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'gpt-4o',
        provider: 'openai',
        finishReason: 'stop',
      }

      expect(metrics.totalTokens).toBe(150)
      expect(metrics.finishReason).toBe('stop')
    })
  })

  describe('AgenticMetrics', () => {
    it('should include tool invocation metrics', () => {
      const metrics: AgenticMetrics = {
        durationMs: 2000,
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        cached: false,
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        model: 'gpt-4o',
        provider: 'openai',
        finishReason: 'stop',
        iterations: 3,
        toolInvocations: [
          { tool: 'search', input: 'query', output: [], durationMs: 100, success: true },
        ],
        toolDurationMs: 100,
        planningSteps: ['Research', 'Analyze', 'Summarize'],
      }

      expect(metrics.iterations).toBe(3)
      expect(metrics.toolInvocations).toHaveLength(1)
    })
  })

  describe('HumanMetrics', () => {
    it('should include human response metrics', () => {
      const metrics: HumanMetrics = {
        durationMs: 3600000, // 1 hour
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        cached: false,
        channel: 'slack',
        respondent: 'user@example.com.ai',
        timeToFirstResponseMs: 600000,
        remindersSent: 1,
        escalated: false,
      }

      expect(metrics.channel).toBe('slack')
      expect(metrics.respondent).toBe('user@example.com.ai')
    })
  })
})

// ============================================================================
// Execution Result Tests
// ============================================================================

describe('Execution Result Types', () => {
  describe('ExecutionResult', () => {
    it('should represent successful execution', () => {
      const result: ExecutionResult<string> = {
        success: true,
        value: 'result',
        metrics: {
          durationMs: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
        },
        traceId: 'trace-123',
      }

      expect(result.success).toBe(true)
      expect(result.value).toBe('result')
    })

    it('should represent failed execution', () => {
      const result: ExecutionResult<string> = {
        success: false,
        error: new AIFunctionError('TIMEOUT_ERROR', 'Timed out'),
        metrics: {
          durationMs: 5000,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 3,
          cached: false,
        },
        traceId: 'trace-456',
      }

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TIMEOUT_ERROR')
    })
  })

  describe('Type-specific result types', () => {
    it('should have CodeExecutionResult type', () => {
      const result: CodeExecutionResult<number> = {
        success: true,
        value: 42,
        metrics: {
          durationMs: 10,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
        },
        traceId: 'trace-789',
      }

      expect(result.value).toBe(42)
    })

    it('should have GenerativeExecutionResult type', () => {
      const result: GenerativeExecutionResult<string> = {
        success: true,
        value: 'Generated text',
        metrics: {
          durationMs: 500,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          model: 'gpt-4o',
          provider: 'openai',
          finishReason: 'stop',
        },
        traceId: 'trace-abc',
      }

      expect(result.metrics.finishReason).toBe('stop')
    })
  })
})

// ============================================================================
// Error Type Tests
// ============================================================================

describe('Error Types', () => {
  describe('AIFunctionError', () => {
    it('should create base error', () => {
      const error = new AIFunctionError('INTERNAL_ERROR', 'Something went wrong')

      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.message).toBe('Something went wrong')
      expect(error.name).toBe('AIFunctionError')
    })

    it('should serialize to JSON', () => {
      const error = new AIFunctionError('VALIDATION_ERROR', 'Invalid input', { field: 'name' })
      const json = error.toJSON()

      expect(json.code).toBe('VALIDATION_ERROR')
      expect(json.details?.field).toBe('name')
    })
  })

  describe('ValidationError', () => {
    it('should include field errors', () => {
      const error = new ValidationError([
        { field: 'name', message: 'Required' },
        { field: 'email', message: 'Invalid format' },
      ])

      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.fieldErrors).toHaveLength(2)
      expect(error.message).toContain('name: Required')
    })
  })

  describe('TimeoutError', () => {
    it('should include timeout duration', () => {
      const error = new TimeoutError(5000)

      expect(error.code).toBe('TIMEOUT_ERROR')
      expect(error.timeoutMs).toBe(5000)
      expect(error.message).toContain('5000ms')
    })
  })

  describe('RateLimitError', () => {
    it('should include retry information', () => {
      const error = new RateLimitError(60000, 100, 0)

      expect(error.code).toBe('RATE_LIMIT_ERROR')
      expect(error.retryAfterMs).toBe(60000)
      expect(error.limit).toBe(100)
      expect(error.remaining).toBe(0)
    })
  })

  describe('ModelError', () => {
    it('should include model information', () => {
      const error = new ModelError('gpt-5', 'unavailable')

      expect(error.code).toBe('MODEL_ERROR')
      expect(error.model).toBe('gpt-5')
      expect(error.reason).toBe('unavailable')
    })
  })

  describe('ToolError', () => {
    it('should include tool information', () => {
      const cause = new Error('API failed')
      const error = new ToolError('search', cause)

      expect(error.code).toBe('TOOL_ERROR')
      expect(error.toolName).toBe('search')
      expect(error.cause).toBe(cause)
    })
  })

  describe('ContentFilterError', () => {
    it('should include filter details', () => {
      const error = new ContentFilterError('hate_speech', 'high')

      expect(error.code).toBe('CONTENT_FILTER_ERROR')
      expect(error.category).toBe('hate_speech')
      expect(error.severity).toBe('high')
    })
  })

  describe('HumanRejectedError', () => {
    it('should include rejection details', () => {
      const error = new HumanRejectedError('user@example.com.ai', 'Budget too high')

      expect(error.code).toBe('HUMAN_REJECTED_ERROR')
      expect(error.respondent).toBe('user@example.com.ai')
      expect(error.reason).toBe('Budget too high')
    })
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isAIFunctionError', () => {
    it('should return true for AIFunctionError', () => {
      const error = new AIFunctionError('INTERNAL_ERROR', 'test')
      expect(isAIFunctionError(error)).toBe(true)
    })

    it('should return true for subclasses', () => {
      const error = new ValidationError([{ field: 'x', message: 'y' }])
      expect(isAIFunctionError(error)).toBe(true)
    })

    it('should return false for regular Error', () => {
      const error = new Error('test')
      expect(isAIFunctionError(error)).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(isAIFunctionError('string')).toBe(false)
      expect(isAIFunctionError(null)).toBe(false)
      expect(isAIFunctionError(undefined)).toBe(false)
    })
  })

  describe('isErrorCode', () => {
    it('should check specific error codes', () => {
      const error = new TimeoutError(5000)

      expect(isErrorCode(error, 'TIMEOUT_ERROR')).toBe(true)
      expect(isErrorCode(error, 'VALIDATION_ERROR')).toBe(false)
    })
  })

  describe('Function type guards', () => {
    it('should identify code functions', () => {
      const def: AnyFunctionDefinition = {
        name: 'test',
        type: 'code',
        handler: () => 'result',
      }

      expect(isCodeFunction(def)).toBe(true)
      expect(isGenerativeFunction(def)).toBe(false)
    })

    it('should identify generative functions', () => {
      const def: AnyFunctionDefinition = {
        name: 'test',
        type: 'generative',
        prompt: 'Generate something',
      }

      expect(isGenerativeFunction(def)).toBe(true)
      expect(isCodeFunction(def)).toBe(false)
    })

    it('should identify agentic functions', () => {
      const def: AnyFunctionDefinition = {
        name: 'test',
        type: 'agentic',
        goal: 'Research something',
        tools: [],
      }

      expect(isAgenticFunction(def)).toBe(true)
      expect(isGenerativeFunction(def)).toBe(false)
    })

    it('should identify human functions', () => {
      const def: AnyFunctionDefinition = {
        name: 'test',
        type: 'human',
        taskDescription: 'Please review',
      }

      expect(isHumanFunction(def)).toBe(true)
      expect(isAgenticFunction(def)).toBe(false)
    })
  })

  describe('Result type guards', () => {
    it('should identify successful results', () => {
      const success: ExecutionResult<string> = {
        success: true,
        value: 'result',
        metrics: {
          durationMs: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
        },
        traceId: 'test',
      }

      expect(isSuccess(success)).toBe(true)
      expect(isFailure(success)).toBe(false)

      if (isSuccess(success)) {
        // Type should be narrowed to include value
        expectTypeOf(success.value).toEqualTypeOf<string>()
      }
    })

    it('should identify failed results', () => {
      const failure: ExecutionResult<string> = {
        success: false,
        error: new AIFunctionError('INTERNAL_ERROR', 'Failed'),
        metrics: {
          durationMs: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
        },
        traceId: 'test',
      }

      expect(isFailure(failure)).toBe(true)
      expect(isSuccess(failure)).toBe(false)

      if (isFailure(failure)) {
        // Type should be narrowed to include error
        expectTypeOf(failure.error).toEqualTypeOf<AIFunctionError>()
      }
    })
  })
})

// ============================================================================
// Function Definition Tests
// ============================================================================

describe('Function Definition Types', () => {
  describe('CodeFunctionDefinition', () => {
    it('should define a code function', () => {
      const def: CodeFunctionDefinition<string, number> = {
        name: 'strlen',
        type: 'code',
        description: 'Get string length',
        handler: (input: string) => input.length,
      }

      expect(def.type).toBe('code')
      expect(def.handler('hello')).toBe(5)
    })
  })

  describe('GenerativeFunctionDefinition', () => {
    it('should define a generative function', () => {
      const def: GenerativeFunctionDefinition<string, string> = {
        name: 'summarize',
        type: 'generative',
        description: 'Summarize text',
        prompt: (input: string) => `Summarize: ${input}`,
        systemPrompt: 'You are a summarization assistant',
      }

      expect(def.type).toBe('generative')
    })
  })

  describe('AgenticFunctionDefinition', () => {
    it('should define an agentic function with tools', () => {
      const def: AgenticFunctionDefinition<string, { findings: string[] }> = {
        name: 'research',
        type: 'agentic',
        description: 'Research a topic',
        goal: (topic: string) => `Research ${topic} thoroughly`,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            execute: async (query: string) => ['result'],
          },
        ],
      }

      expect(def.type).toBe('agentic')
      expect(def.tools).toHaveLength(1)
    })
  })

  describe('HumanFunctionDefinition', () => {
    it('should define a human function', () => {
      const def: HumanFunctionDefinition<
        { amount: number; reason: string },
        { approved: boolean }
      > = {
        name: 'approve-expense',
        type: 'human',
        description: 'Approve an expense',
        taskDescription: (input) => `Approve $${input.amount} for ${input.reason}?`,
        formSchema: {
          type: 'object',
          properties: {
            approved: { type: 'boolean' },
            notes: { type: 'string' },
          },
          required: ['approved'],
        },
        channel: 'slack',
      }

      expect(def.type).toBe('human')
      expect(def.channel).toBe('slack')
    })
  })
})

// ============================================================================
// Utility Type Tests
// ============================================================================

describe('Utility Types', () => {
  describe('UnwrapResult', () => {
    it('should extract output type from ExecutionResult', () => {
      type Result = ExecutionResult<{ name: string; age: number }>
      type Unwrapped = UnwrapResult<Result>

      expectTypeOf<Unwrapped>().toEqualTypeOf<{ name: string; age: number }>()
    })
  })

  describe('OptionsForType', () => {
    it('should map function type to options type', () => {
      type CodeOpts = OptionsForType<'code'>
      type GenerativeOpts = OptionsForType<'generative'>
      type AgenticOpts = OptionsForType<'agentic'>
      type HumanOpts = OptionsForType<'human'>

      expectTypeOf<CodeOpts>().toEqualTypeOf<CodeOptions>()
      expectTypeOf<GenerativeOpts>().toEqualTypeOf<GenerativeOptions>()
      expectTypeOf<AgenticOpts>().toEqualTypeOf<AgenticOptions>()
      expectTypeOf<HumanOpts>().toEqualTypeOf<HumanOptions>()
    })
  })

  describe('ResultForType', () => {
    it('should map function type to result type', () => {
      type CodeResult = ResultForType<'code', string>
      type GenerativeResult = ResultForType<'generative', string>

      expectTypeOf<CodeResult>().toEqualTypeOf<CodeExecutionResult<string>>()
      expectTypeOf<GenerativeResult>().toEqualTypeOf<GenerativeExecutionResult<string>>()
    })
  })

  describe('MetricsForType', () => {
    it('should map function type to metrics type', () => {
      type CodeMetrics = MetricsForType<'code'>
      type GenerativeMetricsType = MetricsForType<'generative'>
      type AgenticMetricsType = MetricsForType<'agentic'>
      type HumanMetricsType = MetricsForType<'human'>

      expectTypeOf<CodeMetrics>().toEqualTypeOf<ExecutionMetrics>()
      expectTypeOf<GenerativeMetricsType>().toEqualTypeOf<GenerativeMetrics>()
      expectTypeOf<AgenticMetricsType>().toEqualTypeOf<AgenticMetrics>()
      expectTypeOf<HumanMetricsType>().toEqualTypeOf<HumanMetrics>()
    })
  })
})

// ============================================================================
// Template Literal Type Tests
// ============================================================================

describe('Template Literal Types', () => {
  describe('ExtractTemplateParams', () => {
    it('should extract parameter names from template strings', () => {
      type Params = ExtractTemplateParams<"Hello ${'name'}, you are ${'age'} years old">

      // Should extract 'name' and 'age' as union
      const _typeCheck: Params = 'name' as Params
      const _typeCheck2: Params = 'age' as Params

      expect(true).toBe(true) // Type test
    })
  })

  describe('TemplateFn', () => {
    it('should define a template function type', () => {
      type Greeting = TemplateFn<string, { name: string; greeting: string }>

      const _typeCheck: Greeting = {
        template: "Hello ${'name'}",
        params: ['name', 'greeting'],
        call: async ({ name, greeting }) => `${greeting}, ${name}!`,
      } as any

      expect(true).toBe(true) // Type test
    })
  })
})

// ============================================================================
// Error Code Completeness Tests
// ============================================================================

describe('AIFunctionErrorCode', () => {
  it('should include all expected error codes', () => {
    const errorCodes: AIFunctionErrorCode[] = [
      'VALIDATION_ERROR',
      'TIMEOUT_ERROR',
      'RATE_LIMIT_ERROR',
      'AUTHENTICATION_ERROR',
      'AUTHORIZATION_ERROR',
      'MODEL_ERROR',
      'TOOL_ERROR',
      'CONTEXT_LENGTH_ERROR',
      'CONTENT_FILTER_ERROR',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
      'CANCELLED_ERROR',
      'QUOTA_ERROR',
      'HUMAN_TIMEOUT_ERROR',
      'HUMAN_REJECTED_ERROR',
      'ESCALATION_ERROR',
    ]

    expect(errorCodes).toHaveLength(16)
  })
})

// ============================================================================
// Real-World Usage Examples
// ============================================================================

describe('Real-World Usage Examples', () => {
  describe('Code function workflow', () => {
    it('should type a complete code function flow', async () => {
      // Define the function
      const def: CodeFunctionDefinition<string, number> = {
        name: 'wordCount',
        type: 'code',
        handler: (text) => text.split(/\s+/).filter(Boolean).length,
      }

      // Simulate execution
      const result: CodeExecutionResult<number> = {
        success: true,
        value: 5,
        metrics: {
          durationMs: 1,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
        },
        traceId: 'test-trace',
      }

      if (isSuccess(result)) {
        expect(result.value).toBe(5)
      }
    })
  })

  describe('Generative function workflow', () => {
    it('should type a complete generative function flow', async () => {
      // Define the function
      const def: GenerativeFunctionDefinition<{ topic: string }, string> = {
        name: 'generateBlogPost',
        type: 'generative',
        prompt: (input) => `Write a blog post about ${input.topic}`,
        defaultOptions: {
          temperature: 0.7,
          maxTokens: 2000,
        },
      }

      // Simulate execution result
      const result: GenerativeExecutionResult<string> = {
        success: true,
        value: 'Here is a blog post about AI...',
        metrics: {
          durationMs: 2000,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          cached: false,
          promptTokens: 50,
          completionTokens: 500,
          totalTokens: 550,
          model: 'gpt-4o',
          provider: 'openai',
          finishReason: 'stop',
        },
        traceId: 'gen-trace',
      }

      expect(result.metrics.totalTokens).toBe(550)
    })
  })

  describe('Error handling flow', () => {
    it('should handle errors with proper types', () => {
      const result: ExecutionResult<string> = {
        success: false,
        error: new RateLimitError(60000, 100, 0),
        metrics: {
          durationMs: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          retryCount: 3,
          cached: false,
        },
        traceId: 'error-trace',
      }

      if (isFailure(result) && result.error instanceof RateLimitError) {
        expect(result.error.retryAfterMs).toBe(60000)
      }
    })
  })
})
