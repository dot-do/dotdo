/**
 * dotdo Testing Utilities
 *
 * Provides reusable testing infrastructure for dotdo applications.
 * Import from `dotdo/testing` to use these utilities.
 *
 * @example
 * ```typescript
 * import { createTestClient, createMockDO } from 'dotdo/testing'
 * import { Business } from '../objects/Business'
 *
 * // Test API endpoints
 * const client = createTestClient(app)
 * const response = await client.get('/health')
 * response.expectStatus(200).expectJson()
 *
 * // Test Durable Objects
 * const { instance, storage, env } = createMockDO(Business, {
 *   id: 'test-business',
 *   storage: { config: { name: 'Acme' } },
 * })
 * ```
 *
 * @module dotdo/testing
 */

// API Testing Utilities
export { createTestClient, type TestClient, type TestResponse } from './api'

// Durable Object Testing Utilities
export {
  // Main factory function
  createMockDO,

  // Component factories
  createMockId,
  createMockStorage,
  createMockState,
  createMockEnv,
  createMockDONamespace,
  createMockAI,
  createMockR2,
  createMockKV,
  createMockPipeline,

  // Utility functions
  createMockRequest,
  expectStorageOperation,
  expectSqlQuery,

  // Types
  type MockDOOptions,
  type MockDOResult,
  type MockDurableObjectId,
  type MockDurableObjectState,
  type MockDurableObjectStorage,
  type MockDurableObjectStub,
  type MockDurableObjectNamespace,
  type MockSqlStorage,
  type MockSqlStorageCursor,
  type MockEnv,
  type MockAI,
  type MockR2,
  type MockKV,
  type MockPipeline,
  type StorageOperation,
  type SqlOperation,
  type DurableObjectListOptions,
} from './do'

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
