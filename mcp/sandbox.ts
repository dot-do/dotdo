// Secure sandbox environment for code execution with $ context injection
import { evaluate } from '../primitives/packages/ai-evaluate/src/node.js'
import type { WorkflowContext } from '../do/context.js'

export interface SandboxPermissions {
  allowSend?: boolean
  allowTry?: boolean
  allowDo?: boolean
  allowOn?: boolean
  allowEvery?: boolean
}

export interface AuditLog {
  timestamp: number
  operation: 'send' | 'try' | 'do' | 'on' | 'every'
  type?: string
  details?: unknown
}

export interface SandboxOptions {
  context: WorkflowContext
  timeout?: number
  permissions?: SandboxPermissions
  audit?: boolean
  onAudit?: (log: AuditLog) => void
}

export interface SandboxResult {
  success: boolean
  value?: unknown
  error?: string
  duration: number
  logs?: Array<{ level: string; message: string; args: unknown[] }>
}

export interface Sandbox {
  execute(code: string): Promise<SandboxResult>
}

// Storage for captured operations (shared between sandbox instances)
interface CapturedOperation {
  type: 'send' | 'try' | 'do' | 'on' | 'every'
  data: any
}

const capturedOperations = new Map<string, CapturedOperation[]>()

/**
 * Generate $ context code that will be prepended to user code
 * This creates stub implementations that capture operations
 */
function generateSandboxContextCode(
  permissions: SandboxPermissions = {}
): string {
  const {
    allowSend = true,
    allowTry = true,
    allowDo = true,
    allowOn = true,
    allowEvery = true
  } = permissions

  return `
// $ WorkflowContext - Sandbox Implementation
const __captured__ = [];

const $ = {
  send: ${allowSend ? `
    (event) => {
      __captured__.push({ type: 'send', data: event });
    }
  ` : `
    () => { throw new Error('Permission denied: $.send() is disabled'); }
  `},

  try: ${allowTry ? `
    async (action) => {
      __captured__.push({ type: 'try', data: {} });
      return action();
    }
  ` : `
    () => { throw new Error('Permission denied: $.try() is disabled'); }
  `},

  do: ${allowDo ? `
    async (action, options) => {
      __captured__.push({ type: 'do', data: options || {} });
      return action();
    }
  ` : `
    () => { throw new Error('Permission denied: $.do() is disabled'); }
  `},

  on: ${allowOn ? `
    new Proxy({}, {
      get(_, noun) {
        return new Proxy({}, {
          get(_, verb) {
            return (handler) => {
              __captured__.push({ type: 'on', data: { noun: String(noun), verb: String(verb) } });
            };
          }
        });
      }
    })
  ` : `
    new Proxy({}, {
      get() { throw new Error('Permission denied: $.on is disabled'); }
    })
  `},

  every: ${allowEvery ? `
    new Proxy(() => {}, {
      get(target, prop) {
        __captured__.push({ type: 'every', data: { prop: String(prop) } });
        // Return a chainable proxy that can be called or accessed further
        return new Proxy(() => {}, {
          get(_, nextProp) {
            if (nextProp === 'then' || nextProp === 'catch') {
              // Don't intercept Promise methods
              return undefined;
            }
            __captured__.push({ type: 'every', data: { prop: String(prop) + '.' + String(nextProp) } });
            return target; // Return base for further chaining
          },
          apply() {
            return undefined;
          }
        });
      },
      apply() {
        return undefined;
      }
    })
  ` : `
    new Proxy({}, {
      get() { throw new Error('Permission denied: $.every is disabled'); }
    })
  `}
};
`
}

/**
 * Create a secure sandbox with $ context injection
 */
export function createSandbox(options: SandboxOptions): Sandbox {
  const { context, timeout = 5000, permissions, audit = false, onAudit } = options

  return {
    async execute(code: string): Promise<SandboxResult> {
      const startTime = Date.now()

      try {
        // Generate $ context code
        const contextCode = generateSandboxContextCode(permissions)

        // Prepend $ context to user code
        const wrappedCode = contextCode + '\n' + code

        // Execute code with $ context injected
        const result = await evaluate({
          script: wrappedCode,
          timeout,
          fetch: null, // Block network access for safety
        })

        // Extract captured operations from logs if available
        // We'll look for a special console.log output with the captured data
        const captured: CapturedOperation[] = []

        // Try to extract __captured__ from the result value if it's an object
        if (result.success && result.value && typeof result.value === 'object') {
          if ('__captured__' in result.value) {
            captured.push(...(result.value.__captured__ || []))
          }
        }

        // Get the actual user result
        const userResult = result.success && result.value && typeof result.value === 'object' && '__userResult__' in result.value
          ? result.value.__userResult__
          : result.value

        // Process captured operations
        for (const op of captured) {
          switch (op.type) {
            case 'send':
              if (onAudit && audit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'send',
                  type: op.data.type,
                  details: op.data.payload
                })
              }
              context.send(op.data)
              break

            case 'try':
              if (onAudit && audit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'try'
                })
              }
              break

            case 'do':
              if (onAudit && audit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'do',
                  details: op.data
                })
              }
              break

            case 'on':
              if (onAudit && audit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'on',
                  type: `${op.data.noun}.${op.data.verb}`
                })
              }
              break

            case 'every':
              if (onAudit && audit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'every',
                  type: op.data.prop
                })
              }
              break
          }
        }

        const duration = Date.now() - startTime

        // ai-evaluate returns { success, value, error, logs, duration }
        // We return the user's result
        return {
          success: result.success,
          value: result.value,
          error: result.error,
          duration,
          logs: result.logs
        }
      } catch (error) {
        const duration = Date.now() - startTime
        const message = error instanceof Error ? error.message : String(error)

        return {
          success: false,
          error: message,
          duration
        }
      }
    }
  }
}
