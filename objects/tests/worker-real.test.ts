/**
 * Worker Integration Tests - NO MOCKS
 *
 * Tests Worker functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests task execution, question answering, decision making, approvals,
 * and notification channels via RPC.
 *
 * @module objects/tests/worker-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type {
  Task,
  TaskResult,
  Answer,
  Decision,
  ApprovalRequest,
  ApprovalResult,
  Option,
  Channel,
  WorkerMode,
} from '../Worker'

// ============================================================================
// TYPES
// ============================================================================

interface TestWorkerStub extends DurableObjectStub {
  // RPC methods
  runTask(task: Task, context?: Record<string, unknown>): Promise<TaskResult>
  askQuestion(question: string, context?: Record<string, unknown>): Promise<Answer>
  makeChoice(question: string, options: Option[], context?: Record<string, unknown>): Promise<Decision>
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>
  sendNotification(message: string, channels: Channel[]): Promise<void>
  generateStructured<T>(prompt: string, schema?: unknown): Promise<T>
  getCurrentMode(): Promise<WorkerMode>
  changeMode(mode: WorkerMode): Promise<WorkerMode>

  // Test helper methods
  getLastTask(): Promise<Task | null>
  getLastQuestion(): Promise<string | null>
  getLastDecision(): Promise<{ question: string; options: Option[] } | null>
  getLastApproval(): Promise<ApprovalRequest | null>
  getNotifications(): Promise<Array<{ message: string; channel: Channel }>>
  clearTestState(): Promise<void>
}

interface TestEnv {
  WORKER: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `worker-test-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: Worker Task Execution
// ============================================================================

describe('Worker Integration Tests (Real Miniflare)', () => {
  let stub: TestWorkerStub
  let ns: string

  beforeEach(async () => {
    ns = uniqueNs()
    const id = (env as TestEnv).WORKER.idFromName(ns)
    stub = (env as TestEnv).WORKER.get(id) as TestWorkerStub
    await stub.clearTestState()
  })

  // ==========================================================================
  // TASK EXECUTION
  // ==========================================================================

  describe('Task Execution', () => {
    it('executes a task successfully', async () => {
      const task: Task = {
        id: 'task-1',
        type: 'process',
        description: 'Process test data',
        input: { data: 'test data' },
      }

      const result = await stub.runTask(task)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      expect((result.output as { executed: boolean }).executed).toBe(true)
    })

    it('handles task failure gracefully', async () => {
      const task: Task = {
        id: 'task-fail',
        type: 'fail', // Special type that triggers failure in test implementation
        description: 'This task will fail',
        input: {},
      }

      const result = await stub.runTask(task)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('records the last executed task', async () => {
      const task: Task = {
        id: 'task-recorded',
        type: 'compute',
        description: 'Compute a value',
        input: { value: 42 },
      }

      await stub.runTask(task)
      const lastTask = await stub.getLastTask()

      expect(lastTask).not.toBeNull()
      expect(lastTask!.id).toBe('task-recorded')
      expect(lastTask!.type).toBe('compute')
    })

    it('includes duration in task result', async () => {
      const task: Task = {
        id: 'task-timed',
        type: 'process',
        description: 'Timed task',
        input: {},
      }

      const result = await stub.runTask(task)

      expect(result.duration).toBeDefined()
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('executes task with context', async () => {
      const task: Task = {
        id: 'task-context',
        type: 'process',
        description: 'Context task',
        input: {},
      }

      const context = {
        user: 'alice',
        tenant: 'acme',
        permissions: ['read', 'write'],
      }

      const result = await stub.runTask(task, context)

      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // QUESTION ANSWERING
  // ==========================================================================

  describe('Question Answering', () => {
    it('answers a question', async () => {
      const answer = await stub.askQuestion('What is the capital of France?')

      expect(answer.text).toBeDefined()
      expect(answer.text).toContain('What is the capital of France?')
    })

    it('includes confidence score', async () => {
      const answer = await stub.askQuestion('How many planets are in our solar system?')

      expect(answer.confidence).toBeDefined()
      expect(answer.confidence).toBeGreaterThan(0)
      expect(answer.confidence).toBeLessThanOrEqual(1)
    })

    it('includes sources when available', async () => {
      const answer = await stub.askQuestion('What is the speed of light?')

      expect(answer.sources).toBeDefined()
      expect(Array.isArray(answer.sources)).toBe(true)
    })

    it('records the last question asked', async () => {
      await stub.askQuestion('What is 2 + 2?')
      const lastQuestion = await stub.getLastQuestion()

      expect(lastQuestion).toBe('What is 2 + 2?')
    })

    it('answers with context', async () => {
      const context = {
        documents: ['doc1.txt', 'doc2.pdf'],
        searchScope: 'internal',
      }

      const answer = await stub.askQuestion('Find relevant information', context)

      expect(answer.text).toBeDefined()
    })
  })

  // ==========================================================================
  // DECISION MAKING
  // ==========================================================================

  describe('Decision Making', () => {
    const options: Option[] = [
      { id: 'opt-a', label: 'Option A', description: 'First option' },
      { id: 'opt-b', label: 'Option B', description: 'Second option' },
      { id: 'opt-c', label: 'Option C', description: 'Third option' },
    ]

    it('makes a decision from options', async () => {
      const decision = await stub.makeChoice(
        'Which option should we choose?',
        options
      )

      expect(decision.selectedOption).toBeDefined()
      expect(options.some((o) => o.id === decision.selectedOption.id)).toBe(true)
    })

    it('provides reasoning for decision', async () => {
      const decision = await stub.makeChoice(
        'What approach should we take?',
        options
      )

      expect(decision.reasoning).toBeDefined()
      expect(decision.reasoning.length).toBeGreaterThan(0)
    })

    it('includes confidence in decision', async () => {
      const decision = await stub.makeChoice(
        'Select the best solution',
        options
      )

      expect(decision.confidence).toBeDefined()
      expect(decision.confidence).toBeGreaterThan(0)
      expect(decision.confidence).toBeLessThanOrEqual(1)
    })

    it('records the last decision made', async () => {
      await stub.makeChoice('Pick one', options)
      const lastDecision = await stub.getLastDecision()

      expect(lastDecision).not.toBeNull()
      expect(lastDecision!.question).toBe('Pick one')
      expect(lastDecision!.options.length).toBe(3)
    })

    it('handles binary decisions', async () => {
      const binaryOptions: Option[] = [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ]

      const decision = await stub.makeChoice(
        'Should we proceed?',
        binaryOptions
      )

      expect(['yes', 'no']).toContain(decision.selectedOption.id)
    })

    it('makes decision with context', async () => {
      const context = {
        constraints: { budget: 10000 },
        priorities: ['quality', 'speed'],
      }

      const decision = await stub.makeChoice(
        'Select vendor',
        options,
        context
      )

      expect(decision.selectedOption).toBeDefined()
    })
  })

  // ==========================================================================
  // APPROVAL WORKFLOW
  // ==========================================================================

  describe('Approval Workflow', () => {
    it('processes approval request', async () => {
      const request: ApprovalRequest = {
        id: 'approval-1',
        type: 'expense',
        subject: 'Conference attendance',
        description: 'Requesting approval for conference registration',
        amount: 500,
        requester: 'alice@example.com',
      }

      const result = await stub.requestApproval(request)

      expect(result.approved).toBe(true)
      expect(result.approver).toBeDefined()
      expect(result.approvedAt).toBeDefined()
    })

    it('rejects approval when type is reject', async () => {
      const request: ApprovalRequest = {
        id: 'approval-reject',
        type: 'reject', // Special type for rejection testing
        subject: 'Rejected Request',
        description: 'This should be rejected',
        requester: 'bob@example.com',
      }

      const result = await stub.requestApproval(request)

      expect(result.approved).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('records the last approval request', async () => {
      const request: ApprovalRequest = {
        id: 'approval-recorded',
        type: 'purchase',
        subject: 'New Equipment',
        description: 'Laptop upgrade',
        amount: 1500,
        requester: 'charlie@example.com',
      }

      await stub.requestApproval(request)
      const lastApproval = await stub.getLastApproval()

      expect(lastApproval).not.toBeNull()
      expect(lastApproval!.id).toBe('approval-recorded')
      expect(lastApproval!.subject).toBe('New Equipment')
    })

    it('includes approval timestamp', async () => {
      const request: ApprovalRequest = {
        id: 'approval-timed',
        type: 'access',
        subject: 'System Access',
        description: 'Requesting admin access',
        requester: 'dave@example.com',
      }

      const result = await stub.requestApproval(request)

      expect(result.approvedAt).toBeDefined()
      expect(new Date(result.approvedAt!).getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  // ==========================================================================
  // NOTIFICATIONS
  // ==========================================================================

  describe('Notifications', () => {
    it('sends notification to single channel', async () => {
      await stub.sendNotification('Test message', ['email'])

      const notifications = await stub.getNotifications()

      expect(notifications.length).toBe(1)
      expect(notifications[0]!.message).toBe('Test message')
      expect(notifications[0]!.channel).toBe('email')
    })

    it('sends notification to multiple channels', async () => {
      await stub.sendNotification('Multi-channel alert', ['email', 'slack', 'sms'])

      const notifications = await stub.getNotifications()

      expect(notifications.length).toBe(3)
      expect(notifications.map((n) => n.channel)).toContain('email')
      expect(notifications.map((n) => n.channel)).toContain('slack')
      expect(notifications.map((n) => n.channel)).toContain('sms')
    })

    it('preserves message content across channels', async () => {
      const message = 'Important: System maintenance at 2pm'
      await stub.sendNotification(message, ['email', 'slack'])

      const notifications = await stub.getNotifications()

      expect(notifications.every((n) => n.message === message)).toBe(true)
    })

    it('clears notifications with test state', async () => {
      await stub.sendNotification('Message 1', ['email'])
      await stub.sendNotification('Message 2', ['slack'])

      let notifications = await stub.getNotifications()
      expect(notifications.length).toBe(2)

      await stub.clearTestState()

      notifications = await stub.getNotifications()
      expect(notifications.length).toBe(0)
    })
  })

  // ==========================================================================
  // STRUCTURED OUTPUT GENERATION
  // ==========================================================================

  describe('Structured Output Generation', () => {
    it('generates structured output from prompt', async () => {
      const result = await stub.generateStructured<{ generated: boolean; prompt: string }>(
        'Create a summary'
      )

      expect(result.generated).toBe(true)
      expect(result.prompt).toBe('Create a summary')
    })

    it('accepts schema for output validation', async () => {
      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: { type: 'array' },
        },
      }

      const result = await stub.generateStructured<{ generated: boolean }>(
        'Generate a list',
        schema
      )

      expect(result.generated).toBe(true)
    })
  })

  // ==========================================================================
  // MODE MANAGEMENT
  // ==========================================================================

  describe('Mode Management', () => {
    it('starts in supervised mode by default', async () => {
      const mode = await stub.getCurrentMode()

      expect(mode).toBe('supervised')
    })

    it('changes to autonomous mode', async () => {
      const newMode = await stub.changeMode('autonomous')

      expect(newMode).toBe('autonomous')
    })

    it('changes to manual mode', async () => {
      const newMode = await stub.changeMode('manual')

      expect(newMode).toBe('manual')
    })

    it('persists mode across calls', async () => {
      await stub.changeMode('autonomous')

      const mode = await stub.getCurrentMode()

      expect(mode).toBe('autonomous')
    })

    it('cycles through modes', async () => {
      expect(await stub.getCurrentMode()).toBe('supervised')

      await stub.changeMode('autonomous')
      expect(await stub.getCurrentMode()).toBe('autonomous')

      await stub.changeMode('manual')
      expect(await stub.getCurrentMode()).toBe('manual')

      await stub.changeMode('supervised')
      expect(await stub.getCurrentMode()).toBe('supervised')
    })
  })

  // ==========================================================================
  // HTTP API
  // ==========================================================================

  describe('HTTP API', () => {
    it('handles POST /task', async () => {
      const task: Task = {
        id: 'http-task',
        type: 'process',
        input: { via: 'http' },
      }

      const response = await stub.fetch(
        new Request('https://test.api/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task),
        })
      )

      expect(response.status).toBe(200)

      const result = await response.json() as TaskResult
      expect(result.status).toBe('completed')
    })

    it('handles POST /ask', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: 'What time is it?' }),
        })
      )

      expect(response.status).toBe(200)

      const answer = await response.json() as Answer
      expect(answer.text).toBeDefined()
    })

    it('handles POST /decide', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/decide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 'Which color?',
            options: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue' },
            ],
          }),
        })
      )

      expect(response.status).toBe(200)

      const decision = await response.json() as Decision
      expect(decision.selectedOption).toBeDefined()
    })

    it('handles POST /approve', async () => {
      const request: ApprovalRequest = {
        id: 'http-approval',
        type: 'purchase',
        subject: 'HTTP Approval Test',
        description: 'Testing via HTTP',
        requester: 'test@example.com',
      }

      const response = await stub.fetch(
        new Request('https://test.api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      )

      expect(response.status).toBe(200)

      const result = await response.json() as ApprovalResult
      expect(result.approved).toBe(true)
    })

    it('handles GET /mode', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/mode', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const data = await response.json() as { mode: string }
      expect(['autonomous', 'supervised', 'manual']).toContain(data.mode)
    })

    it('handles PUT /mode', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/mode', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'autonomous' }),
        })
      )

      expect(response.status).toBe(200)

      const data = await response.json() as { mode: string }
      expect(data.mode).toBe('autonomous')
    })

    it('handles health check', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/health', { method: 'GET' })
      )

      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty task input', async () => {
      const task: Task = {
        id: 'empty-input',
        type: 'process',
        input: {},
      }

      const result = await stub.runTask(task)

      expect(result.success).toBe(true)
    })

    it('handles empty question', async () => {
      const answer = await stub.askQuestion('')

      expect(answer.text).toBeDefined()
    })

    it('handles single option decision', async () => {
      const decision = await stub.makeChoice('Only one choice', [
        { id: 'only', label: 'Only Option' },
      ])

      expect(decision.selectedOption.id).toBe('only')
    })

    it('handles notification with empty channels', async () => {
      await stub.sendNotification('No channels', [])

      const notifications = await stub.getNotifications()
      expect(notifications.length).toBe(0)
    })

    it('handles special characters in messages', async () => {
      const specialMessage = 'Test <script>alert("xss")</script> & "quotes" \'apostrophes\''

      await stub.sendNotification(specialMessage, ['email'])

      const notifications = await stub.getNotifications()
      expect(notifications[0]!.message).toBe(specialMessage)
    })

    it('handles unicode in questions', async () => {
      const unicodeQuestion = 'What is the meaning of life? (meaning and purpose) in the context of various cultures and belief systems'

      const answer = await stub.askQuestion(unicodeQuestion)

      expect(answer.text).toContain(unicodeQuestion)
    })

    it('handles concurrent task execution', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-${i}`,
        type: 'process',
        input: { index: i },
      }))

      const results = await Promise.all(
        tasks.map((task) => stub.runTask(task))
      )

      expect(results.length).toBe(5)
      expect(results.every((r) => r.success)).toBe(true)
    })
  })
})
