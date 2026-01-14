/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides secure V8 isolate evaluation using Miniflare/workerd sandboxing.
 * Based on patterns from ai-evaluate package.
 */

import { ObjectStoreProxy } from './object-store-proxy'

export interface MiniflareEvaluatorConfig {
  timeout?: number
  memoryLimit?: number
  cpuLimit?: number
  objectStore?: ObjectStoreProxy
}

export interface EvaluatorResult {
  success: boolean
  value?: unknown
  error?: string
  logs: string[]
  duration: number
}

/**
 * Generate worker code for sandboxed execution.
 * Based on ai-evaluate's generateDevWorkerCode pattern.
 */
function generateWorkerCode(userCode: string): string {
  // Helper to stringify values for console output
  const stringifyHelper = `
const stringify = (val) => {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
};
`

  return `
// Sandbox Worker Entry Point
const logs = [];

${stringifyHelper}

// Capture console output
const originalConsole = { ...console };
const captureConsole = (level) => (...args) => {
  logs.push(args.map(stringify).join(' '));
  originalConsole[level](...args);
};
console.log = captureConsole('log');
console.warn = captureConsole('warn');
console.error = captureConsole('error');
console.info = captureConsole('info');
console.debug = captureConsole('debug');

// Store stub - operations not available in this sandbox mode
const store = {
  async getObject(sha) {
    throw new Error('store.getObject is not available in sandbox');
  },
  async putObject(type, data) {
    throw new Error('store.putObject is not available in sandbox');
  },
  async listObjects(options) {
    throw new Error('store.listObjects is not available in sandbox');
  }
};

// Execute user code
async function executeUserCode() {
  ${userCode}
}

export default {
  async fetch(request) {
    const start = Date.now();
    try {
      const value = await executeUserCode();
      return Response.json({
        success: true,
        value,
        logs,
        duration: Date.now() - start
      });
    } catch (error) {
      return Response.json({
        success: false,
        error: error.message || String(error),
        logs,
        duration: Date.now() - start
      });
    }
  }
};
`
}

export async function evaluateWithMiniflare(
  code: string,
  config?: MiniflareEvaluatorConfig
): Promise<EvaluatorResult> {
  const startTime = performance.now()

  // Check for network calls (fetch, XMLHttpRequest, etc.)
  if (/\bfetch\s*\(/.test(code) || /XMLHttpRequest/.test(code)) {
    return {
      success: false,
      error: 'network requests are blocked',
      logs: [],
      duration: performance.now() - startTime,
    }
  }

  const timeout = config?.timeout ?? 5000

  try {
    // Dynamic import to avoid bundling in production
    const { Miniflare } = await import('miniflare')

    const workerCode = generateWorkerCode(code)

    const mf = new Miniflare({
      modules: true,
      script: workerCode,
      compatibilityDate: '2024-01-01'
    })

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout exceeded')), timeout)
      })

      // Race the fetch against the timeout
      const response = await Promise.race([
        mf.dispatchFetch('http://sandbox/execute'),
        timeoutPromise
      ])

      const result = await response.json() as EvaluatorResult

      return {
        success: result.success,
        value: result.value,
        error: result.error,
        logs: result.logs,
        duration: result.duration
      }
    } finally {
      await mf.dispose()
    }
  } catch (error) {
    const err = error as Error
    return {
      success: false,
      error: err.message || String(error),
      logs: [],
      duration: performance.now() - startTime
    }
  }
}
