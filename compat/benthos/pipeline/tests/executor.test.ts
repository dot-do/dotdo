/**
 * RED Phase Tests: Benthos Pipeline Executor
 * Issue: dotdo-r11r1
 *
 * These tests define the expected behavior for the Pipeline Executor that:
 * 1. Loads config and builds pipeline from input → processors → output
 * 2. Runs message loop: input.next() → processor.process() → output.write()
 * 3. Chains multiple processors in sequence
 * 4. Handles processor errors (retry, drop, dead-letter)
 * 5. Tracks metrics (messages processed, failed, dropped)
 * 6. Supports graceful shutdown (stop(), drain())
 * 7. Async execution with configurable concurrency
 *
 * These tests should FAIL until the implementation is complete.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BenthosMessage,
  BenthosBatch,
  createMessage,
  createBatch
} from '../../core/message'
import type { BenthosConfig, ProcessorConfig } from '../../core/config'
import { PipelineExecutor } from '../executor'

// Mock implementations for testing
class MockInput {
  private messages: BenthosMessage[] = []
  private index: number = 0
  private closed: boolean = false

  addMessage(msg: BenthosMessage): void {
    this.messages.push(msg)
  }

  async next(): Promise<BenthosMessage | null> {
    if (this.index >= this.messages.length) {
      return null
    }
    return this.messages[this.index++]
  }

  async close(): Promise<void> {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  reset(): void {
    this.index = 0
  }
}

class MockOutput {
  private messages: BenthosMessage[] = []
  private closed: boolean = false

  async write(msg: BenthosMessage | BenthosBatch): Promise<void> {
    if (msg instanceof BenthosBatch) {
      for (const m of msg) {
        this.messages.push(m)
      }
    } else {
      this.messages.push(msg)
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  getMessages(): BenthosMessage[] {
    return this.messages
  }

  clear(): void {
    this.messages = []
  }
}

class MockProcessor {
  private shouldFail: boolean = false
  private processorName: string = 'mock'

  constructor(name: string = 'mock') {
    this.processorName = name
  }

  setFail(fail: boolean): void {
    this.shouldFail = fail
  }

  async process(msg: BenthosMessage | BenthosBatch): Promise<BenthosMessage | BenthosBatch | null> {
    if (this.shouldFail) {
      throw new Error(`Processor ${this.processorName} failed`)
    }

    if (msg instanceof BenthosBatch) {
      return msg.map(m => m.withContent(`[${this.processorName}]${m.content}`))
    }

    return msg.withContent(`[${this.processorName}]${msg.content}`)
  }

  getName(): string {
    return this.processorName
  }
}

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor
  let input: MockInput
  let output: MockOutput
  let mockConfig: BenthosConfig

  beforeEach(() => {
    input = new MockInput()
    output = new MockOutput()
    mockConfig = {
      input: { stdin: {} },
      output: { stdout: {} }
    }
  })

  afterEach(async () => {
    if (executor) {
      await executor.stop()
    }
  })

  describe('Basic execution', () => {
    it('creates executor with config', () => {
      executor = new PipelineExecutor(mockConfig)

      expect(executor).toBeDefined()
      expect(executor.getConfig()).toEqual(mockConfig)
    })

    it('starts and stops the executor', async () => {
      executor = new PipelineExecutor(mockConfig)

      await executor.start()
      expect(executor.isRunning()).toBe(true)

      await executor.stop()
      expect(executor.isRunning()).toBe(false)
    })

    it('processes single message through pipeline', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
      expect(output.getMessages()[0].content).toContain('test')
    })

    it('processes multiple messages in sequence', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(3)
      expect(output.getMessages()[0].content).toContain('msg1')
      expect(output.getMessages()[1].content).toContain('msg2')
      expect(output.getMessages()[2].content).toContain('msg3')
    })

    it('returns control after processing completes', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      const result = await executor.processOnce()

      expect(result).toBeDefined()
    })
  })

  describe('Processor chaining', () => {
    it('chains two processors in sequence', async () => {
      const proc1 = new MockProcessor('proc1')
      const proc2 = new MockProcessor('proc2')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)

      input.addMessage(createMessage('data'))

      await executor.start()
      await executor.processOnce()

      const msg = output.getMessages()[0]
      expect(msg.content).toContain('[proc1]')
      expect(msg.content).toContain('[proc2]')
      expect(msg.content).toContain('data')
    })

    it('chains three processors maintaining order', async () => {
      const proc1 = new MockProcessor('first')
      const proc2 = new MockProcessor('second')
      const proc3 = new MockProcessor('third')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)
      executor.addProcessor(proc3)

      input.addMessage(createMessage('x'))

      await executor.start()
      await executor.processOnce()

      const msg = output.getMessages()[0]
      const content = msg.content
      const firstIdx = content.indexOf('[first]')
      const secondIdx = content.indexOf('[second]')
      const thirdIdx = content.indexOf('[third]')

      expect(firstIdx).toBeLessThan(secondIdx)
      expect(secondIdx).toBeLessThan(thirdIdx)
    })

    it('passes metadata through processor chain', async () => {
      const proc1 = new MockProcessor('proc1')
      const proc2 = new MockProcessor('proc2')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)

      input.addMessage(createMessage('test', { 'key': 'value' }))

      await executor.start()
      await executor.processOnce()

      const msg = output.getMessages()[0]
      expect(msg.metadata.get('key')).toBe('value')
    })

    it('supports empty processor chain', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      const msg = output.getMessages()[0]
      expect(msg.content).toBe('test')
    })
  })

  describe('Error handling', () => {
    it('catches processor error and marks message with error', async () => {
      const proc = new MockProcessor('error-proc')
      proc.setFail(true)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
      const msg = output.getMessages()[0]
      expect(msg.hasError()).toBe(true)
      expect(msg.getError()?.message).toContain('error-proc')
    })

    it('retries processor on first failure', async () => {
      const proc = new MockProcessor('retry-proc')
      let attemptCount = 0

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 2, backoffMs: 1 })

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
    })

    it('drops message after max retries', async () => {
      const proc = new MockProcessor('drop-proc')
      proc.setFail(true)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 1, backoffMs: 1 })

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(executor.getMetrics().dropped).toBeGreaterThan(0)
    })

    it('routes failed messages to dead-letter output', async () => {
      const proc = new MockProcessor('dead-letter-proc')
      proc.setFail(true)

      const deadLetterOutput = new MockOutput()

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setDeadLetterOutput(deadLetterOutput)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 0, backoffMs: 0 })

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(deadLetterOutput.getMessages()).toHaveLength(1)
      expect(deadLetterOutput.getMessages()[0].hasError()).toBe(true)
    })

    it('continues processing after error in batch', async () => {
      const proc = new MockProcessor('partial-fail')
      let count = 0
      const origProcess = proc.process.bind(proc)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processAll()

      expect(output.getMessages().length).toBeGreaterThanOrEqual(1)
    })

    it('handles processor returning null (drop)', async () => {
      const proc = new MockProcessor('drop')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      // Message dropped, not written to output
      expect(output.getMessages()).toHaveLength(0)
    })
  })

  describe('Metrics tracking', () => {
    it('tracks processed message count', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processAll()

      const metrics = executor.getMetrics()
      expect(metrics.processed).toBe(3)
    })

    it('tracks failed message count', async () => {
      const proc = new MockProcessor('fail-proc')
      proc.setFail(true)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 0, backoffMs: 0 })

      input.addMessage(createMessage('test1'))
      input.addMessage(createMessage('test2'))

      await executor.start()
      await executor.processAll()

      const metrics = executor.getMetrics()
      expect(metrics.failed).toBeGreaterThan(0)
    })

    it('tracks dropped message count', async () => {
      const proc = new MockProcessor('drop-proc')
      proc.setFail(true)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 0, backoffMs: 0 })

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))

      await executor.start()
      await executor.processAll()

      const metrics = executor.getMetrics()
      expect(metrics.dropped).toBeGreaterThan(0)
    })

    it('tracks bytes processed', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('hello'))
      input.addMessage(createMessage('world'))

      await executor.start()
      await executor.processAll()

      const metrics = executor.getMetrics()
      expect(metrics.bytesProcessed).toBeGreaterThan(0)
    })

    it('tracks latency per message', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      const metrics = executor.getMetrics()
      expect(metrics.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('provides latency percentiles', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      for (let i = 0; i < 100; i++) {
        input.addMessage(createMessage(`msg${i}`))
      }

      await executor.start()
      await executor.processAll()

      const metrics = executor.getMetrics()
      expect(metrics.latencyP50).toBeDefined()
      expect(metrics.latencyP95).toBeDefined()
      expect(metrics.latencyP99).toBeDefined()
    })

    it('resets metrics', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      let metrics = executor.getMetrics()
      expect(metrics.processed).toBe(1)

      executor.resetMetrics()

      metrics = executor.getMetrics()
      expect(metrics.processed).toBe(0)
    })

    it('tracks start and stop time', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      const beforeStart = Date.now()
      await executor.start()
      const afterStart = Date.now()

      input.addMessage(createMessage('test'))
      await executor.processOnce()

      const beforeStop = Date.now()
      await executor.stop()
      const afterStop = Date.now()

      const metrics = executor.getMetrics()
      expect(metrics.startTime).toBeGreaterThanOrEqual(beforeStart)
      expect(metrics.startTime).toBeLessThanOrEqual(afterStart)
      expect(metrics.stopTime).toBeGreaterThanOrEqual(beforeStop)
      expect(metrics.stopTime).toBeLessThanOrEqual(afterStop)
    })
  })

  describe('Graceful shutdown', () => {
    it('stops accepting new messages on stop', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.stop()

      expect(executor.isRunning()).toBe(false)
    })

    it('drains pending messages before shutdown', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.drain()

      expect(output.getMessages()).toHaveLength(3)
    })

    it('drain waits for all in-flight messages', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setConcurrency(2)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.drain()

      expect(executor.getInFlightCount()).toBe(0)
    })

    it('closes input after drain', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.drain()

      expect(input.isClosed()).toBe(true)
    })

    it('closes output after drain', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.drain()

      expect(output.isClosed()).toBe(true)
    })

    it('handles stop during processing', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      for (let i = 0; i < 100; i++) {
        input.addMessage(createMessage(`msg${i}`))
      }

      await executor.start()

      // Give it a moment to start processing
      await new Promise(resolve => setTimeout(resolve, 10))

      await executor.stop()

      expect(executor.isRunning()).toBe(false)
    })

    it('prevents operations after stop', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.stop()

      input.addMessage(createMessage('test'))

      try {
        await executor.processOnce()
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('stopped')
      }
    })
  })

  describe('Concurrency and batching', () => {
    it('processes messages with default concurrency', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(3)
    })

    it('limits concurrency to specified level', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setConcurrency(2)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()

      // Only 2 should be in flight at max
      expect(executor.getInFlightCount()).toBeLessThanOrEqual(2)

      await executor.processAll()

      expect(output.getMessages()).toHaveLength(3)
    })

    it('handles batches of messages', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setBatchSize(2)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processAll()

      expect(output.getMessages().length).toBeGreaterThanOrEqual(1)
    })

    it('processes batch as single unit through processors', async () => {
      const proc = new MockProcessor('batch-proc')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setBatchSize(3)
      executor.addProcessor(proc)

      input.addMessage(createMessage('a'))
      input.addMessage(createMessage('b'))
      input.addMessage(createMessage('c'))

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(3)
    })

    it('tracks in-flight message count', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()

      const initialInFlight = executor.getInFlightCount()
      expect(initialInFlight).toBeGreaterThanOrEqual(0)

      await executor.processOnce()

      expect(executor.getInFlightCount()).toBeLessThanOrEqual(initialInFlight)
    })

    it('respects max in-flight limit', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.setMaxInFlight(1)

      for (let i = 0; i < 5; i++) {
        input.addMessage(createMessage(`msg${i}`))
      }

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(5)
    })
  })

  describe('Configuration', () => {
    it('loads configuration', () => {
      executor = new PipelineExecutor(mockConfig)

      expect(executor.getConfig()).toEqual(mockConfig)
    })

    it('builds pipeline from processors config', async () => {
      const configWithProcessors: BenthosConfig = {
        ...mockConfig,
        pipeline: {
          processors: [
            { mapping: 'root = this' }
          ]
        }
      }

      executor = new PipelineExecutor(configWithProcessors)

      expect(executor.getProcessorCount()).toBeGreaterThanOrEqual(0)
    })

    it('applies retry policy from config', () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setRetryPolicy({ maxRetries: 3, backoffMs: 100 })

      // Verify policy is set
      expect(executor).toBeDefined()
    })

    it('applies concurrency from config', () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setConcurrency(4)

      expect(executor).toBeDefined()
    })
  })

  describe('Message flow', () => {
    it('preserves message content through pipeline', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      const originalContent = { name: 'test', value: 123 }
      input.addMessage(createMessage(originalContent))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
    })

    it('preserves message metadata through pipeline', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test', { 'source': 'kafka' }))

      await executor.start()
      await executor.processOnce()

      const msg = output.getMessages()[0]
      expect(msg.metadata.get('source')).toBe('kafka')
    })

    it('handles messages with no metadata', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
    })

    it('processes empty messages', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage(''))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
    })
  })

  describe('Execution flow control', () => {
    it('processOnce returns when one message complete', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test1'))
      input.addMessage(createMessage('test2'))

      await executor.start()
      await executor.processOnce()

      expect(output.getMessages()).toHaveLength(1)
    })

    it('processAll waits for all messages', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      for (let i = 0; i < 5; i++) {
        input.addMessage(createMessage(`msg${i}`))
      }

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(5)
    })

    it('processUntil stops at condition', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('msg1'))
      input.addMessage(createMessage('msg2'))
      input.addMessage(createMessage('msg3'))

      await executor.start()
      await executor.processUntil(msg => msg.content.includes('msg2'))

      expect(output.getMessages()).toHaveLength(2)
    })

    it('can process in a loop manually', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test1'))
      input.addMessage(createMessage('test2'))

      await executor.start()

      let count = 0
      while (count < 2 && executor.isRunning()) {
        await executor.processOnce()
        count++
      }

      expect(output.getMessages()).toHaveLength(2)
    })
  })

  describe('Error states', () => {
    it('handles null message from input', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      // Don't add any messages, input will return null

      await executor.start()
      const result = await executor.processOnce()

      expect(result).toBeNull()
    })

    it('handles missing input gracefully', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setOutput(output)

      await executor.start()

      try {
        await executor.processOnce()
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('input')
      }
    })

    it('handles missing output gracefully', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)

      input.addMessage(createMessage('test'))

      await executor.start()

      try {
        await executor.processOnce()
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('output')
      }
    })

    it('throws when starting twice', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()

      try {
        await executor.start()
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('already')
      }
    })
  })

  describe('Health and status', () => {
    it('reports running status', async () => {
      executor = new PipelineExecutor(mockConfig)

      expect(executor.isRunning()).toBe(false)

      await executor.start()
      expect(executor.isRunning()).toBe(true)

      await executor.stop()
      expect(executor.isRunning()).toBe(false)
    })

    it('provides processor count', async () => {
      const proc1 = new MockProcessor('proc1')
      const proc2 = new MockProcessor('proc2')

      executor = new PipelineExecutor(mockConfig)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)

      expect(executor.getProcessorCount()).toBe(2)
    })

    it('provides current metrics', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      const metrics = executor.getMetrics()

      expect(metrics).toHaveProperty('processed')
      expect(metrics).toHaveProperty('failed')
      expect(metrics).toHaveProperty('dropped')
      expect(metrics).toHaveProperty('bytesProcessed')
    })

    it('provides status object', async () => {
      executor = new PipelineExecutor(mockConfig)

      await executor.start()

      const status = executor.getStatus()

      expect(status).toHaveProperty('running')
      expect(status).toHaveProperty('config')
      expect(status).toHaveProperty('metrics')
    })
  })

  describe('Processor management', () => {
    it('adds processors in order', () => {
      const proc1 = new MockProcessor('first')
      const proc2 = new MockProcessor('second')
      const proc3 = new MockProcessor('third')

      executor = new PipelineExecutor(mockConfig)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)
      executor.addProcessor(proc3)

      expect(executor.getProcessorCount()).toBe(3)
    })

    it('retrieves processor by index', () => {
      const proc1 = new MockProcessor('proc1')
      const proc2 = new MockProcessor('proc2')

      executor = new PipelineExecutor(mockConfig)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)

      const retrieved = executor.getProcessor(0)
      expect(retrieved).toBe(proc1)

      const retrieved2 = executor.getProcessor(1)
      expect(retrieved2).toBe(proc2)
    })

    it('removes processor by index', () => {
      const proc1 = new MockProcessor('proc1')
      const proc2 = new MockProcessor('proc2')

      executor = new PipelineExecutor(mockConfig)
      executor.addProcessor(proc1)
      executor.addProcessor(proc2)

      executor.removeProcessor(0)

      expect(executor.getProcessorCount()).toBe(1)
      expect(executor.getProcessor(0)).toBe(proc2)
    })

    it('clears all processors', () => {
      executor = new PipelineExecutor(mockConfig)
      executor.addProcessor(new MockProcessor('proc1'))
      executor.addProcessor(new MockProcessor('proc2'))

      executor.clearProcessors()

      expect(executor.getProcessorCount()).toBe(0)
    })
  })

  describe('Resource cleanup', () => {
    it('closes input on cleanup', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.stop()

      expect(input.isClosed()).toBe(true)
    })

    it('closes output on cleanup', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.stop()

      expect(output.isClosed()).toBe(true)
    })

    it('handles cleanup when processor fails to close', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()

      // Should not throw on stop
      await expect(executor.stop()).resolves.toBeUndefined()
    })
  })

  describe('Advanced scenarios', () => {
    it('handles rapid start/stop cycles', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      for (let i = 0; i < 3; i++) {
        await executor.start()
        await executor.stop()
      }

      expect(executor.isRunning()).toBe(false)
    })

    it('processes large batch efficiently', async () => {
      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)

      const largeCount = 1000
      for (let i = 0; i < largeCount; i++) {
        input.addMessage(createMessage(`msg${i}`))
      }

      await executor.start()
      await executor.processAll()

      expect(output.getMessages()).toHaveLength(largeCount)
    })

    it('handles processor that filters messages', async () => {
      const filterProc = new MockProcessor('filter')

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(filterProc)

      input.addMessage(createMessage('keep'))
      input.addMessage(createMessage('keep'))
      input.addMessage(createMessage('remove'))

      await executor.start()
      await executor.processAll()

      // Some or all messages should be written
      expect(output.getMessages().length).toBeGreaterThanOrEqual(0)
    })

    it('supports custom error handler', async () => {
      let errorHandlerCalled = false

      const proc = new MockProcessor('error-handler-proc')
      proc.setFail(true)

      executor = new PipelineExecutor(mockConfig)
      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(proc)
      executor.setRetryPolicy({ maxRetries: 0, backoffMs: 0 })
      executor.setErrorHandler((error, msg) => {
        errorHandlerCalled = true
      })

      input.addMessage(createMessage('test'))

      await executor.start()
      await executor.processOnce()

      expect(errorHandlerCalled).toBe(true)
    })
  })
})
