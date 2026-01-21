/**
 * Test Durable Object Classes for RPC Integration Tests
 *
 * These DO classes are exported for vitest-pool-workers to instantiate
 * during miniflare integration testing.
 */

import {
  createServer,
  createCrossDOClient,
  CrossDOContext,
  RPCError,
  RPCErrorCode,
  NotFoundError,
  ValidationError,
} from '../index'

// Type interfaces for cross-DO calls
interface TargetDOInterface {
  getBalance(): Promise<number>
  charge(amount: number): Promise<{ success: boolean; balance: number }>
  deposit(amount: number): Promise<number>
  getId(): Promise<string>
  slowOperation(delayMs: number): Promise<string>
}

interface Env {
  DO: DurableObjectNamespace
  TARGET_DO: DurableObjectNamespace
  SOURCE_DO: DurableObjectNamespace
}

/**
 * Test DO that exposes RPC methods for testing client-server communication
 */
export class TestDO implements DurableObject {
  private state: DurableObjectState
  private app: ReturnType<typeof createServer>
  private counter = 0

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.app = createServer({ target: this })
  }

  // Simple method
  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`
  }

  // Method with multiple args
  async add(a: number, b: number): Promise<number> {
    return a + b
  }

  // Method that returns complex object
  async getInfo(): Promise<{ id: string; counter: number; timestamp: number }> {
    return {
      id: this.state.id.toString(),
      counter: this.counter,
      timestamp: Date.now(),
    }
  }

  // Method that modifies state
  async increment(): Promise<number> {
    this.counter++
    return this.counter
  }

  // Method that throws NotFoundError
  async notFound(id: string): Promise<never> {
    throw NotFoundError.forResource('Item', id)
  }

  // Method that throws ValidationError
  async validate(email: string): Promise<never> {
    throw ValidationError.forField('email', 'must be a valid email address', email)
  }

  // Method that throws generic error
  async crash(): Promise<never> {
    throw new Error('Intentional crash for testing')
  }

  // Method that throws RPCError with custom code
  async customError(): Promise<never> {
    throw new RPCError(RPCErrorCode.CONFLICT, 'Resource conflict', { resource: 'test' })
  }

  // Slow method for timeout testing
  async slow(delayMs: number): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return 'completed'
  }

  // Nested methods for testing dot notation
  math = {
    multiply: (a: number, b: number): number => a * b,
    divide: (a: number, b: number): number => {
      if (b === 0) throw new ValidationError('Cannot divide by zero')
      return a / b
    },
  }

  // Batch processing method
  async processItems(items: string[]): Promise<string[]> {
    return items.map((item) => item.toUpperCase())
  }

  // Method for cross-DO testing
  async callTargetDO(targetId: string, method: string, ...args: unknown[]): Promise<unknown> {
    const targetStub = (this.state as unknown as { env: Env }).env.TARGET_DO.get(
      (this.state as unknown as { env: Env }).env.TARGET_DO.idFromName(targetId)
    )
    const response = await targetStub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
    })
    if (!response.ok) {
      const errorBody = await response.json() as { code?: string; message?: string; details?: Record<string, unknown> }
      throw new RPCError(
        (errorBody.code as typeof RPCErrorCode[keyof typeof RPCErrorCode]) || RPCErrorCode.INTERNAL_ERROR,
        errorBody.message || 'Cross-DO call failed',
        errorBody.details
      )
    }
    return response.json()
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

/**
 * Target DO for cross-DO RPC testing
 */
export class TargetDO implements DurableObject {
  private state: DurableObjectState
  private app: ReturnType<typeof createServer>
  private balance = 1000

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.app = createServer({ target: this })
  }

  async getBalance(): Promise<number> {
    return this.balance
  }

  async charge(amount: number): Promise<{ success: boolean; balance: number }> {
    if (amount > this.balance) {
      throw new ValidationError('Insufficient balance', {
        requested: amount,
        available: this.balance,
      })
    }
    this.balance -= amount
    return { success: true, balance: this.balance }
  }

  async deposit(amount: number): Promise<number> {
    this.balance += amount
    return this.balance
  }

  async getId(): Promise<string> {
    return this.state.id.toString()
  }

  async slowOperation(delayMs: number): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return 'completed'
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

/**
 * Source DO that makes cross-DO calls for testing
 */
export class SourceDO implements DurableObject {
  private app: ReturnType<typeof createServer>
  private env: Env

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env
    this.app = createServer({ target: this })
  }

  async getTargetBalance(targetId: string): Promise<number> {
    const client = createCrossDOClient<TargetDOInterface>(
      this.env.TARGET_DO,
      targetId
    )
    return client.getBalance()
  }

  async chargeTarget(targetId: string, amount: number): Promise<{ success: boolean; balance: number }> {
    const client = createCrossDOClient<TargetDOInterface>(
      this.env.TARGET_DO,
      targetId
    )
    return client.charge(amount)
  }

  async broadcastToTargets(targetIds: string[], _message: string): Promise<string[]> {
    const $ = new CrossDOContext(this.env as unknown as Record<string, DurableObjectNamespace>) as unknown as { TARGET_DO: <D extends object>(id?: string | DurableObjectId) => D & { broadcast: <M extends keyof D>(ids: string[], method: M, ...args: unknown[]) => Promise<unknown[]> } }
    const results = await $.TARGET_DO<TargetDOInterface>().broadcast(
      targetIds,
      'getId'
    )
    return results as string[]
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

// Re-export context test DOs for remote context tests
export { ContextDO, EntityDO } from './context-test-dos'
