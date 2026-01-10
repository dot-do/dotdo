/**
 * Mock for @cloudflare/sandbox module
 *
 * This mock allows tests to import modules that depend on @cloudflare/sandbox
 * without requiring the actual Cloudflare containers runtime.
 */

import type { DurableObject, DurableObjectState } from './cloudflare-workers'

/**
 * Mock Sandbox class
 */
export class Sandbox {
  ctx: DurableObjectState
  env: unknown

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx
    this.env = env
  }

  async exec(command: string) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    }
  }

  async writeFile(path: string, content: string) {}

  async readFile(path: string) {
    return { content: '' }
  }

  async destroy() {}
}

/**
 * Mock getSandbox function
 */
export function getSandbox(stub: unknown) {
  return {
    exec: async (command: string) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    }),
    execStream: async function* (command: string) {
      yield { type: 'complete', exitCode: 0 }
    },
    writeFile: async () => {},
    readFile: async () => ({ content: '' }),
    mkdir: async () => {},
    deleteFile: async () => {},
    exists: async () => ({ exists: false }),
    destroy: async () => {},
    exposePort: async () => ({ url: 'http://localhost:8080' }),
    getExposedPorts: async () => [],
    createCodeContext: async () => ({ id: 'ctx-mock' }),
    runCode: async () => ({
      code: '',
      logs: { stdout: [], stderr: [] },
      results: [],
      success: true,
      executionCount: 1,
    }),
  }
}

/**
 * Mock proxyToSandbox function
 */
export function proxyToSandbox(request: Request, stub: unknown) {
  return new Response('Mock sandbox response', { status: 200 })
}

/**
 * Mock parseSSEStream function
 */
export async function* parseSSEStream(response: Response) {
  yield { type: 'complete', exitCode: 0 }
}

export default {
  Sandbox,
  getSandbox,
  proxyToSandbox,
  parseSSEStream,
}
