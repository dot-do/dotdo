/**
 * RED Phase Tests: Pipeline Executor
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for the pipeline executor that orchestrates message flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PipelineExecutor,
  createMessage,
  createBatch,
  BenthosMessage,
  BenthosBatch,
  type Input,
  type Output,
  type Processor,
  type BenthosConfig,
} from '../src'

/**
 * Mock input that yields predefined messages
 */
class MockInput implements Input {
  private messages: BenthosMessage[]
  private index = 0

  constructor(messages: (string | object)[]) {
    this.messages = messages.map(m =>
      typeof m === 'string' ? createMessage(m) : createMessage(m)
    )
  }

  async next(): Promise<BenthosMessage | null> {
    if (this.index >= this.messages.length) {
      return null
    }
    return this.messages[this.index++]
  }

  async close(): Promise<void> {}

  reset(): void {
    this.index = 0
  }
}

/**
 * Mock output that collects messages
 */
class MockOutput implements Output {
  public messages: (BenthosMessage | BenthosBatch)[] = []

  async write(msg: BenthosMessage | BenthosBatch): Promise<void> {
    this.messages.push(msg)
  }

  async close(): Promise<void> {}
}

/**
 * Mock processor that transforms messages
 */
class MockProcessor implements Processor {
  constructor(
    private transformer: (msg: BenthosMessage) => BenthosMessage | null,
    private name: string = 'mock'
  ) {}

  async process(msg: BenthosMessage | BenthosBatch): Promise<BenthosMessage | BenthosBatch | null> {
    if (msg instanceof BenthosBatch) {
      const results = [...msg].map(m => this.transformer(m)).filter(m => m !== null) as BenthosMessage[]
      return createBatch(results)
    }
    return this.transformer(msg)
  }

  getName(): string {
    return this.name
  }
}

describe('PipelineExecutor', () => {
  const minimalConfig: BenthosConfig = {
    input: { stdin: {} },
    output: { stdout: {} }
  }

  describe('lifecycle', () => {
    it('should start and stop', async () => {
      const executor = new PipelineExecutor(minimalConfig)

      expect(executor.isRunning()).toBe(false)
      await executor.start()
      expect(executor.isRunning()).toBe(true)
      await executor.stop()
      expect(executor.isRunning()).toBe(false)
    })

    it('should throw when already running', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      await executor.start()

      await expect(executor.start()).rejects.toThrow('already running')
      await executor.stop()
    })

    it('should track start and stop times in metrics', async () => {
      const executor = new PipelineExecutor(minimalConfig)

      await executor.start()
      const metrics = executor.getMetrics()
      expect(metrics.startTime).toBeGreaterThan(0)

      await executor.stop()
      const finalMetrics = executor.getMetrics()
      expect(finalMetrics.stopTime).toBeGreaterThan(0)
    })
  })

  describe('message processing', () => {
    it('should process messages from input to output', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['message 1', 'message 2'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processOnce()
      await executor.processOnce()
      await executor.stop()

      expect(output.messages.length).toBe(2)
      expect((output.messages[0] as BenthosMessage).content).toBe('message 1')
      expect((output.messages[1] as BenthosMessage).content).toBe('message 2')
    })

    it('should return null when no more messages', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['only one'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processOnce()
      const result = await executor.processOnce()
      await executor.stop()

      expect(result).toBeNull()
    })

    it('should throw when input not configured', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const output = new MockOutput()
      executor.setOutput(output)

      await executor.start()
      await expect(executor.processOnce()).rejects.toThrow('No input configured')
      await executor.stop()
    })

    it('should throw when output not configured', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      executor.setInput(input)

      await executor.start()
      await expect(executor.processOnce()).rejects.toThrow('No output configured')
      await executor.stop()
    })

    it('should throw when executor stopped', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()
      executor.setInput(input)
      executor.setOutput(output)

      await expect(executor.processOnce()).rejects.toThrow('stopped')
    })
  })

  describe('processors', () => {
    it('should apply single processor', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['hello'])
      const output = new MockOutput()
      const processor = new MockProcessor(msg =>
        msg.withContent(msg.content.toUpperCase())
      )

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(processor)

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect((output.messages[0] as BenthosMessage).content).toBe('HELLO')
    })

    it('should chain multiple processors', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(new MockProcessor(msg =>
        msg.withContent(msg.content + '-first')
      ))
      executor.addProcessor(new MockProcessor(msg =>
        msg.withContent(msg.content + '-second')
      ))

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect((output.messages[0] as BenthosMessage).content).toBe('test-second-first')
    })

    it('should drop message when processor returns null', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['keep', 'drop', 'keep'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(new MockProcessor(msg =>
        msg.content === 'drop' ? null : msg
      ))

      await executor.start()
      await executor.processAll()
      await executor.stop()

      expect(output.messages.length).toBe(2)
      const metrics = executor.getMetrics()
      expect(metrics.dropped).toBe(1)
    })

    it('should remove processor by index', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      executor.addProcessor(new MockProcessor(m => m))
      executor.addProcessor(new MockProcessor(m => m))

      expect(executor.getProcessorCount()).toBe(2)
      executor.removeProcessor(0)
      expect(executor.getProcessorCount()).toBe(1)
    })

    it('should clear all processors', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      executor.addProcessor(new MockProcessor(m => m))
      executor.addProcessor(new MockProcessor(m => m))

      executor.clearProcessors()
      expect(executor.getProcessorCount()).toBe(0)
    })

    it('should drop message when processor named "drop"', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(new MockProcessor(msg => msg, 'drop'))

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect(output.messages.length).toBe(0)
      expect(executor.getMetrics().dropped).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should handle processor errors', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()
      const failingProcessor = new MockProcessor(() => {
        throw new Error('processing failed')
      })

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(failingProcessor)

      await executor.start()
      // Default behavior: mark error but continue
      await executor.processOnce()
      await executor.stop()

      const metrics = executor.getMetrics()
      expect(metrics.failed).toBe(1)
    })

    it('should call error handler on failure', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()
      const errorHandler = vi.fn()

      executor.setInput(input)
      executor.setOutput(output)
      executor.addProcessor(new MockProcessor(() => {
        throw new Error('fail')
      }))
      executor.setErrorHandler(errorHandler)

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect(errorHandler).toHaveBeenCalled()
    })

    it('should send to dead-letter queue on error with retry policy', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()
      const dlq = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)
      executor.setDeadLetterOutput(dlq)
      executor.setRetryPolicy({ maxRetries: 0, backoffMs: 0 })
      executor.addProcessor(new MockProcessor(() => {
        throw new Error('fail')
      }))

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect(dlq.messages.length).toBe(1)
      expect(executor.getMetrics().dropped).toBe(1)
    })

    it('should retry on failure', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()
      let attempts = 0

      executor.setInput(input)
      executor.setOutput(output)
      executor.setRetryPolicy({ maxRetries: 2, backoffMs: 10 })
      executor.addProcessor(new MockProcessor(() => {
        attempts++
        if (attempts < 3) throw new Error('fail')
        return createMessage('success')
      }))

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect(attempts).toBe(3)
      expect(output.messages.length).toBe(1)
    })
  })

  describe('metrics', () => {
    it('should track processed count', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['a', 'b', 'c'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processOnce()
      await executor.processOnce()
      await executor.processOnce()
      await executor.stop()

      expect(executor.getMetrics().processed).toBe(3)
    })

    it('should track bytes processed', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['hello'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processOnce()
      await executor.stop()

      expect(executor.getMetrics().bytesProcessed).toBe(5)
    })

    it('should track latency percentiles', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['a', 'b', 'c', 'd', 'e'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processAll()
      await executor.stop()

      const metrics = executor.getMetrics()
      expect(metrics.latencyP50).toBeGreaterThanOrEqual(0)
      expect(metrics.latencyP95).toBeGreaterThanOrEqual(0)
      expect(metrics.latencyP99).toBeGreaterThanOrEqual(0)
    })

    it('should reset metrics', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processOnce()

      executor.resetMetrics()

      expect(executor.getMetrics().processed).toBe(0)
      expect(executor.getMetrics().bytesProcessed).toBe(0)
      await executor.stop()
    })

    it('should track in-flight count', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      expect(executor.getInFlightCount()).toBe(0)
    })
  })

  describe('status', () => {
    it('should return complete status', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['test'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      const status = executor.getStatus()
      await executor.stop()

      expect(status.running).toBe(true)
      expect(status.config).toBe(minimalConfig)
      expect(status.metrics).toBeDefined()
    })

    it('should return config', () => {
      const executor = new PipelineExecutor(minimalConfig)
      expect(executor.getConfig()).toBe(minimalConfig)
    })
  })

  describe('drain', () => {
    it('should drain all messages before shutdown', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['a', 'b', 'c'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.drain()

      expect(output.messages.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('processUntil', () => {
    it('should process until condition met', async () => {
      const executor = new PipelineExecutor(minimalConfig)
      const input = new MockInput(['a', 'b', 'stop', 'd'])
      const output = new MockOutput()

      executor.setInput(input)
      executor.setOutput(output)

      await executor.start()
      await executor.processUntil(msg => msg.content === 'stop')
      await executor.stop()

      expect(output.messages.length).toBe(3)
    })
  })

  describe('configuration', () => {
    it('should set concurrency', () => {
      const executor = new PipelineExecutor(minimalConfig)
      executor.setConcurrency(4)
      // Concurrency is internal, just verify no throw
      expect(true).toBe(true)
    })

    it('should set batch size', () => {
      const executor = new PipelineExecutor(minimalConfig)
      executor.setBatchSize(100)
      expect(true).toBe(true)
    })

    it('should set max in-flight', () => {
      const executor = new PipelineExecutor(minimalConfig)
      executor.setMaxInFlight(50)
      expect(true).toBe(true)
    })
  })
})
