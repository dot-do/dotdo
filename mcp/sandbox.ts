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

/**
 * Resource limits for sandbox execution
 */
export interface ResourceLimits {
  /** Maximum execution time in milliseconds (default: 5000) */
  timeout?: number
  /** Maximum code size in bytes (default: 100KB) */
  maxCodeSize?: number
  /** Maximum output size in bytes (default: 1MB) */
  maxOutputSize?: number
  /** Memory limit hint in MB - informational, actual enforcement depends on runtime */
  memoryLimitMB?: number
}

/**
 * Resource usage statistics from sandbox execution
 */
export interface ResourceUsage {
  /** Actual execution time in milliseconds */
  executionTime: number
  /** Code size in bytes */
  codeSize: number
  /** Whether execution was terminated due to timeout */
  timedOut: boolean
  /** Whether output was truncated due to size limits */
  outputTruncated: boolean
}

export interface SandboxOptions {
  context: WorkflowContext
  /** @deprecated Use resourceLimits.timeout instead */
  timeout?: number
  permissions?: SandboxPermissions
  audit?: boolean
  onAudit?: (log: AuditLog) => void
  /** Resource limits for execution */
  resourceLimits?: ResourceLimits
}

export interface SandboxResult {
  success: boolean
  value?: unknown
  error?: string
  duration: number
  logs?: Array<{ level: string; message: string; args: unknown[] }>
  /** Resource usage statistics */
  resourceUsage?: ResourceUsage
}

export interface Sandbox {
  execute(code: string): Promise<SandboxResult>
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = {
  timeout: 5000,
  maxCodeSize: 100 * 1024, // 100KB
  maxOutputSize: 1024 * 1024, // 1MB
  memoryLimitMB: 128
}

// Storage for captured operations (shared between sandbox instances)
interface CapturedOperation {
  type: 'send' | 'try' | 'do' | 'on' | 'every'
  data: any
  actionResult?: any
}

/**
 * Generate $ context code that will be prepended to user code
 * This creates stub implementations that capture operations and return them
 * along with the user's result in a wrapped object.
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
// Operations are captured and returned with the result
const __sandbox_captured__ = [];

const $ = {
  send: ${allowSend ? `
    (event) => {
      __sandbox_captured__.push({ type: 'send', data: event });
    }
  ` : `
    () => { throw new Error('Permission denied: $.send() is disabled'); }
  `},

  try: ${allowTry ? `
    async (action) => {
      const result = await action();
      __sandbox_captured__.push({ type: 'try', data: {}, actionResult: result });
      return result;
    }
  ` : `
    () => { throw new Error('Permission denied: $.try() is disabled'); }
  `},

  do: ${allowDo ? `
    async (action, options) => {
      const result = await action();
      __sandbox_captured__.push({ type: 'do', data: options || {}, actionResult: result });
      return result;
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
              __sandbox_captured__.push({ type: 'on', data: { noun: String(noun), verb: String(verb), handler: handler.toString() } });
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
    // $.every is an object proxy that supports chaining and calling
    // e.g., $.every.day(), $.every.Monday.at9am(), $.every.day.at('6pm')()
    // Using an object target ensures typeof $.every === 'object'
    new Proxy({}, {
      get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === Symbol.toStringTag) {
          return undefined;
        }
        // For 'at' method, return a function that returns another callable proxy
        if (prop === 'at') {
          return (time) => {
            __sandbox_captured__.push({ type: 'every', data: { prop: 'at', time } });
            // Return a callable that accepts a handler
            return (handler) => {
              __sandbox_captured__.push({ type: 'every', data: { prop: 'at', time, handler: handler?.toString() } });
            };
          };
        }
        __sandbox_captured__.push({ type: 'every', data: { prop: String(prop) } });
        // Return a callable proxy for chaining like $.every.day() or $.every.Monday.at9am
        const createCallableChain = (currentProp) => {
          return new Proxy(function() {}, {
            get(_, nextProp) {
              if (nextProp === 'then' || nextProp === 'catch' || nextProp === Symbol.toStringTag) {
                return undefined;
              }
              // Handle .at('time') method
              if (nextProp === 'at') {
                return (time) => {
                  __sandbox_captured__.push({ type: 'every', data: { prop: currentProp + '.at', time } });
                  return (handler) => {
                    __sandbox_captured__.push({ type: 'every', data: { prop: currentProp + '.at', time, handler: handler?.toString() } });
                  };
                };
              }
              __sandbox_captured__.push({ type: 'every', data: { prop: currentProp + '.' + String(nextProp) } });
              return createCallableChain(currentProp + '.' + String(nextProp));
            },
            apply(_, thisArg, args) {
              // Called as function: $.every.day(), $.every.hour()
              __sandbox_captured__.push({ type: 'every', data: { prop: currentProp, called: true, args: args?.length } });
              return undefined;
            }
          });
        };
        return createCallableChain(String(prop));
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
 * Wrap user code to return both the result and captured operations
 * This ensures we can extract captured $ operations after execution
 */
function wrapUserCode(code: string): string {
  // Wrap the user code to capture both result and operations
  // We use an async IIFE that returns a special object with both values
  return `
// Execute user code and capture result
const __sandbox_exec__ = async () => {
  let __user_result__;
  try {
    __user_result__ = await (async () => {
      ${code}
    })();
  } catch (e) {
    return { __sandbox_error__: e.message, __sandbox_captured__: __sandbox_captured__ };
  }
  return { __sandbox_result__: __user_result__, __sandbox_captured__: __sandbox_captured__ };
};
return __sandbox_exec__();
`
}

/**
 * Validate code against resource limits before execution
 */
function validateCode(code: string, limits: Required<ResourceLimits>): void {
  const codeBytes = new TextEncoder().encode(code).length
  if (codeBytes > limits.maxCodeSize) {
    throw new Error(
      `Code size (${codeBytes} bytes) exceeds maximum allowed (${limits.maxCodeSize} bytes)`
    )
  }
}

/**
 * Truncate output if it exceeds the maximum size
 */
function truncateOutput(value: unknown, maxSize: number): { value: unknown; truncated: boolean } {
  if (value === undefined || value === null) {
    return { value, truncated: false }
  }

  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > maxSize) {
      // Try to preserve structure for objects/arrays
      if (typeof value === 'object') {
        return {
          value: { __truncated__: true, __originalSize__: serialized.length },
          truncated: true
        }
      }
      // For strings, truncate with indicator
      if (typeof value === 'string') {
        return {
          value: value.slice(0, maxSize - 20) + '... [truncated]',
          truncated: true
        }
      }
    }
    return { value, truncated: false }
  } catch {
    return { value, truncated: false }
  }
}

/**
 * Create a secure sandbox with $ context injection
 */
export function createSandbox(options: SandboxOptions): Sandbox {
  const { context, timeout: legacyTimeout, permissions, audit = false, onAudit, resourceLimits } = options

  // Merge resource limits with defaults (support legacy timeout option)
  const limits: Required<ResourceLimits> = {
    ...DEFAULT_RESOURCE_LIMITS,
    ...resourceLimits,
    timeout: resourceLimits?.timeout ?? legacyTimeout ?? DEFAULT_RESOURCE_LIMITS.timeout
  }

  return {
    async execute(code: string): Promise<SandboxResult> {
      const startTime = Date.now()
      let timedOut = false
      const codeSize = new TextEncoder().encode(code).length

      try {
        // Validate code size before processing
        validateCode(code, limits)

        // Generate $ context code
        const contextCode = generateSandboxContextCode(permissions)

        // Wrap user code to return result and captured operations
        const wrappedUserCode = wrapUserCode(code)

        // Combine context code with wrapped user code
        const fullCode = contextCode + '\n' + wrappedUserCode

        // Execute code with $ context injected
        // Use Promise.race with a timeout to ensure we don't hang
        const evaluatePromise = evaluate({
          script: fullCode,
          timeout: limits.timeout,
          fetch: null, // Block network access for safety
        })

        // Create our own timeout wrapper
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true
            reject(new Error('Sandbox execution timed out'))
          }, limits.timeout + 100)
        })

        const result = await Promise.race([evaluatePromise, timeoutPromise])

        const duration = Date.now() - startTime

        // Extract captured operations and user result from wrapped response
        let captured: CapturedOperation[] = []
        let userResult: unknown = result.value
        let userError: string | undefined = result.error

        if (result.value && typeof result.value === 'object') {
          const wrappedValue = result.value as Record<string, unknown>

          // Check for sandbox wrapper format
          if ('__sandbox_captured__' in wrappedValue) {
            captured = (wrappedValue.__sandbox_captured__ as CapturedOperation[]) || []
          }

          if ('__sandbox_result__' in wrappedValue) {
            userResult = wrappedValue.__sandbox_result__
          }

          if ('__sandbox_error__' in wrappedValue) {
            userError = wrappedValue.__sandbox_error__ as string
          }
        }

        // Process captured operations and call context methods
        for (const op of captured) {
          switch (op.type) {
            case 'send':
              // Call the real context.send
              context.send(op.data)
              if (audit && onAudit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'send',
                  type: op.data.type,
                  details: op.data.payload
                })
              }
              break

            case 'try':
              // The action was already executed in the sandbox
              // Call context.try with a resolved action to track that $.try was used
              // We pass a function that returns the already-computed result
              context.try(async () => op.actionResult)
              if (audit && onAudit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'try'
                })
              }
              break

            case 'do':
              // The action was already executed in the sandbox
              // Call context.do with the options and a resolved action
              context.do(async () => op.actionResult, op.data)
              if (audit && onAudit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'do',
                  details: op.data
                })
              }
              break

            case 'on':
              if (audit && onAudit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'on',
                  type: `${op.data.noun}.${op.data.verb}`
                })
              }
              break

            case 'every':
              if (audit && onAudit) {
                onAudit({
                  timestamp: Date.now(),
                  operation: 'every',
                  type: op.data.prop
                })
              }
              break
          }
        }

        // Apply output size limits and track truncation
        const { value: truncatedValue, truncated: outputTruncated } = truncateOutput(
          userResult,
          limits.maxOutputSize
        )

        // Build resource usage stats
        const resourceUsage: ResourceUsage = {
          executionTime: duration,
          codeSize,
          timedOut,
          outputTruncated
        }

        // If there was an error in user code, return failure
        if (userError) {
          return {
            success: false,
            error: userError,
            duration,
            logs: result.logs,
            resourceUsage
          }
        }

        return {
          success: result.success,
          value: truncatedValue,
          error: result.error,
          duration,
          logs: result.logs,
          resourceUsage
        }
      } catch (error) {
        const duration = Date.now() - startTime
        const message = error instanceof Error ? error.message : String(error)

        return {
          success: false,
          error: message,
          duration,
          resourceUsage: {
            executionTime: duration,
            codeSize,
            timedOut,
            outputTruncated: false
          }
        }
      }
    }
  }
}
