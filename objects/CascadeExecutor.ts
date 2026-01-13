/**
 * CascadeExecutor - Re-exports from lib/executors/CascadeExecutor
 *
 * The CascadeExecutor tries function types in order of speed/cost:
 * 1. Code (fastest, cheapest, deterministic)
 * 2. Generative (AI inference, single call)
 * 3. Agentic (AI + tools, multi-step)
 * 4. Human (slowest, most expensive, guaranteed judgment)
 *
 * The cascade stops when a function succeeds. On failure, it escalates
 * to the next type automatically. The cascade path is recorded in the
 * resulting event for observability.
 *
 * @example
 * ```typescript
 * import { CascadeExecutor } from 'objects/CascadeExecutor'
 *
 * const executor = new CascadeExecutor({
 *   state: mockState,
 *   env: mockEnv,
 *   handlers: {
 *     code: async (input) => computeResult(input),
 *     generative: async (input) => aiGenerate(input),
 *     agentic: async (input) => agentRun(input),
 *     human: async (input) => requestHumanInput(input),
 *   },
 * })
 *
 * const result = await executor.execute({
 *   input: { query: 'test' },
 *   handlers: myHandlers,
 * })
 * ```
 */

// Re-export everything from lib/executors/CascadeExecutor
export {
  // Main class
  CascadeExecutor,

  // Error classes
  CascadeExhaustedError,
  CascadeTimeoutError,
  CascadeSkippedError,

  // Types
  type FunctionType,
  type CodeHandler,
  type GenerativeHandler,
  type AgenticHandler,
  type HumanHandler,
  type HandlerContext,
  type CascadeHandlers,
  type CascadeStep,
  type CascadePath,
  type EventContext,
  type Event5WH,
  type CascadeResult,
  type CascadeOptions,
  type CascadeExecutorOptions,
} from '../lib/executors/CascadeExecutor'

// Default export for convenience
export { CascadeExecutor as default } from '../lib/executors/CascadeExecutor'
