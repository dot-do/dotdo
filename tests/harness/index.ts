/**
 * dotdo Testing Utilities
 *
 * Provides reusable testing infrastructure for dotdo applications.
 * Import from `dotdo/testing` to use these utilities.
 *
 * @example
 * ```typescript
 * import { createTestClient } from 'dotdo/testing'
 *
 * // Test API endpoints
 * const client = createTestClient(app)
 * const response = await client.get('/health')
 * response.expectStatus(200).expectJson()
 * ```
 *
 * NOTE: For Durable Object testing, use the real miniflare runtime via
 * @cloudflare/vitest-pool-workers. Mock DO infrastructure has been removed.
 *
 * @module dotdo/testing
 */

// API Testing Utilities
export { createTestClient, type TestClient, type TestResponse } from './api'

// Executor Testing Utilities
export {
  createTestContext,
  mockAI,
  mockKV,
  mockDB,
  mockQueue,
  mockFetch,
  type TestContext,
  type TestContextOptions,
  type MockAI as ExecutorMockAI,
  type MockAIOptions,
  type MockKV as ExecutorMockKV,
  type MockDB,
  type MockDBResponses,
  type MockQueue,
  type MockQueueOptions,
  type MockFetchResponses,
  type MockServices,
  type CapturedEvent,
  type CapturedLog,
  type AICall,
  type KVOperation,
  type DBQuery,
  type FetchCall,
} from './executor-context'

// Workflow Testing Utilities
export {
  WorkflowTestHarness,
  type WorkflowTestHarnessOptions,
  type StepCall,
  type EmittedEvent,
  type LogEntry,
  type WorkflowRunResult,
  type QueuedEvent,
} from './workflow-harness'

// Test Workflow Runtime (with hooks, mocks, time control)
export {
  // Factory function
  createTestWorkflowRuntime,

  // Storage
  InMemoryStepStorage,

  // Types
  type TestWorkflowRuntime,
  type TestRuntimeOptions,
  type StepExecution,
  type RuntimeState,
  type SimulatedFailure,
  type BeforeStepHook,
  type AfterStepHook,
  type OnStepErrorHook,
  type MockHandler,
  type MockHandlerMap,
} from './runtime'
