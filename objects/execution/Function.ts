/**
 * Function - Serverless function execution unit
 *
 * Represents a deployable function with sandbox execution.
 * Integrates with ai-evaluate for secure code execution.
 */

import { DO, Env } from '../core/DO'

export interface FunctionConfig {
  name: string
  description?: string
  runtime: 'javascript' | 'typescript'
  source: string
  timeout?: number
  memory?: number
}

export interface FunctionInvocation {
  id: string
  functionId: string
  input: unknown
  output?: unknown
  error?: string
  startedAt: Date
  completedAt?: Date
  duration?: number
}

export class Function extends DO {
  private config: FunctionConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get function configuration
   */
  async getConfig(): Promise<FunctionConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as FunctionConfig | null
    }
    return this.config
  }

  /**
   * Set function configuration (deploy)
   */
  async deploy(config: FunctionConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('function.deployed', { config })
  }

  /**
   * Invoke the function
   */
  async invoke(input: unknown): Promise<FunctionInvocation> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Function not deployed')
    }

    const invocation: FunctionInvocation = {
      id: crypto.randomUUID(),
      functionId: this.ctx.id.toString(),
      input,
      startedAt: new Date(),
    }

    await this.emit('function.invoked', { invocationId: invocation.id, input })

    try {
      // In production, use ai-evaluate sandbox
      // For now, stub the execution
      const output = await this.executeInSandbox(config.source, input)

      invocation.output = output
      invocation.completedAt = new Date()
      invocation.duration = invocation.completedAt.getTime() - invocation.startedAt.getTime()

      await this.ctx.storage.put(`invocation:${invocation.id}`, invocation)
      await this.emit('function.completed', { invocationId: invocation.id, output })

      return invocation
    } catch (error) {
      invocation.error = error instanceof Error ? error.message : String(error)
      invocation.completedAt = new Date()
      invocation.duration = invocation.completedAt.getTime() - invocation.startedAt.getTime()

      await this.ctx.storage.put(`invocation:${invocation.id}`, invocation)
      await this.emit('function.failed', { invocationId: invocation.id, error: invocation.error })

      return invocation
    }
  }

  /**
   * Execute code in sandbox (stub - integrate with ai-evaluate)
   */
  protected async executeInSandbox(source: string, input: unknown): Promise<unknown> {
    // In production, this would use ai-evaluate:
    // return evaluate({ script: source, env: { input: JSON.stringify(input) } }, this.env)

    // Stub implementation
    return { executed: true, input }
  }

  /**
   * Get invocation history
   */
  async getInvocations(limit: number = 10): Promise<FunctionInvocation[]> {
    const map = await this.ctx.storage.list({ prefix: 'invocation:' })
    const invocations = Array.from(map.values()) as FunctionInvocation[]
    return invocations.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/deploy' && request.method === 'POST') {
      const config = (await request.json()) as FunctionConfig
      await this.deploy(config)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/invoke' && request.method === 'POST') {
      const input = await request.json()
      const result = await this.invoke(input)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/invocations') {
      const invocations = await this.getInvocations()
      return new Response(JSON.stringify(invocations), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Function
