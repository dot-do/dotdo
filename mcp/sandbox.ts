// Secure sandbox environment for code execution with $ context injection
import { evaluate } from 'ai-evaluate/node'
import type { WorkflowContext } from './types'
import { getErrorMessage } from '@dotdo/rpc'

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
  /** Memory limit in MB - enforced via allocation tracking */
  memoryLimitMB?: number
  /** Allow network access (fetch, WebSocket). Default: false */
  allowNetwork?: boolean
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
  /** Memory used in MB (approximate) */
  memoryUsedMB?: number | undefined
  /** Peak memory usage in MB */
  peakMemoryMB?: number | undefined
  /** CPU time consumed in milliseconds */
  cpuTimeMs?: number | undefined
  /** Which limit was violated (if any) */
  limitViolated?: 'timeout' | 'memory' | 'cpu' | 'network' | undefined
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
  /** Allow network access (fetch, WebSocket). Default: false */
  allowNetwork?: boolean
}

export interface SandboxResult {
  success: boolean
  value?: unknown | undefined
  error?: string | undefined
  duration: number
  logs?: Array<{ level: string; message: string; timestamp?: number }> | undefined
  /** Resource usage statistics */
  resourceUsage?: ResourceUsage
}

export interface Sandbox {
  execute(code: string): Promise<SandboxResult>
}

/**
 * Default resource limits
 *
 * These limits are carefully chosen to balance usability with security and
 * resource protection in a multi-tenant environment.
 *
 * RATIONALE FOR EACH LIMIT:
 *
 * 1. timeout (5000ms / 5 seconds)
 *    - WHY: Most legitimate code operations complete in <1 second. 5 seconds
 *      provides generous headroom for complex computations while preventing
 *      infinite loops and runaway processes from consuming worker resources.
 *    - SECURITY: Prevents denial-of-service via CPU exhaustion.
 *    - TRADE-OFF: Long-running analytics or ML operations may need higher limits,
 *      but those should be handled by dedicated compute resources, not sandboxes.
 *
 * 2. maxCodeSize (100KB)
 *    - WHY: 100KB is sufficient for any reasonable code snippet (roughly 3000
 *      lines of code). Larger payloads indicate code injection attacks or
 *      attempts to embed binary data in code.
 *    - SECURITY: Prevents memory exhaustion during code parsing/compilation.
 *    - TRADE-OFF: Minified libraries may exceed this; users should import
 *      libraries from context rather than embedding them.
 *
 * 3. maxOutputSize (1MB)
 *    - WHY: 1MB allows for substantial JSON responses (e.g., paginated data)
 *      while preventing memory exhaustion from exponential string growth or
 *      massive object serialization.
 *    - SECURITY: Prevents memory DoS by limiting response payload size.
 *    - TRADE-OFF: Large data exports should use streaming or pagination,
 *      not single-response dumps.
 *
 * 4. memoryLimitMB (128MB)
 *    - WHY: 128MB matches typical Cloudflare Worker memory limits and is
 *      sufficient for most data processing tasks. Higher limits risk
 *      impacting other tenants on the same isolate.
 *    - SECURITY: Prevents memory exhaustion attacks (e.g., exponential
 *      array/string growth, zip bombs).
 *    - TRADE-OFF: Memory-intensive operations (image processing, large
 *      dataset manipulation) should use dedicated compute.
 *
 * 5. allowNetwork (false by default)
 *    - WHY: Network access introduces SSRF (Server-Side Request Forgery)
 *      risks, data exfiltration vectors, and unpredictable latency.
 *    - SECURITY: Prevents sandbox escape via network calls, credential
 *      theft via internal service access, and data exfiltration.
 *    - TRADE-OFF: Legitimate integrations should use the $ context's
 *      controlled integration methods, not raw fetch.
 */
export const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = {
  timeout: 5000,
  maxCodeSize: 100 * 1024, // 100KB - sufficient for ~3000 lines of code
  maxOutputSize: 1024 * 1024, // 1MB - allows substantial responses, prevents memory DoS
  memoryLimitMB: 128, // Matches typical Worker memory limits
  allowNetwork: false // Disabled to prevent SSRF and data exfiltration
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window (default: 100) */
  maxRequests: number
  /** Window size in milliseconds (default: 60000 = 1 minute) */
  windowMs: number
}

/**
 * Concurrency limiting configuration
 */
export interface ConcurrencyLimitConfig {
  /** Maximum concurrent operations per client (default: 5) */
  maxConcurrent: number
}

/**
 * Default rate limit settings
 *
 * RATIONALE:
 *
 * maxRequests (100 per minute)
 * - WHY: 100 requests/minute (~1.67 req/sec) accommodates interactive use
 *   and reasonable automation while preventing abuse.
 * - SECURITY: Prevents resource exhaustion from rapid-fire requests,
 *   limits the damage from compromised API keys.
 * - TRADE-OFF: Bulk operations should batch work into fewer requests
 *   rather than sending many small ones.
 *
 * windowMs (60000ms / 1 minute)
 * - WHY: 1-minute sliding window provides intuitive rate limiting that
 *   users can reason about while allowing burst patterns.
 * - SECURITY: Short enough to limit sustained abuse, long enough to
 *   prevent legitimate burst traffic from triggering limits.
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100, // ~1.67 req/sec - accommodates interactive use
  windowMs: 60000 // 1 minute sliding window
}

/**
 * Default concurrency limit settings
 *
 * RATIONALE:
 *
 * maxConcurrent (5 operations per client)
 * - WHY: 5 concurrent operations allows parallel workflows (e.g., Promise.all
 *   with multiple $ operations) while preventing resource monopolization.
 * - SECURITY: Prevents a single client from consuming all available isolate
 *   resources, ensures fair sharing in multi-tenant environments.
 * - TRADE-OFF: Highly parallel workloads may need queuing, but this forces
 *   better resource management and prevents cascade failures.
 *
 * This limit is per-client (identified by clientId), so different clients
 * can each have 5 concurrent operations without affecting each other.
 */
export const DEFAULT_CONCURRENCY_LIMIT: ConcurrencyLimitConfig = {
  maxConcurrent: 5 // Per-client concurrency - allows parallel workflows
}

/**
 * Rate limiter - tracks requests per client within a sliding window
 */
export class RateLimiter {
  private windows: Map<string, { timestamps: number[]; blocked: boolean }> = new Map()
  private config: RateLimitConfig

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config }
  }

  /**
   * Check if a client can make a request
   * @param clientId - Unique identifier for the client
   * @returns Object with allowed status and remaining requests
   */
  check(clientId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now()
    const windowStart = now - this.config.windowMs

    // Get or create window data for this client
    let windowData = this.windows.get(clientId)
    if (!windowData) {
      windowData = { timestamps: [], blocked: false }
      this.windows.set(clientId, windowData)
    }

    // Clean up timestamps outside the window
    windowData.timestamps = windowData.timestamps.filter(ts => ts > windowStart)

    const remaining = this.config.maxRequests - windowData.timestamps.length
    const oldestTimestamp = windowData.timestamps[0] || now
    const resetMs = oldestTimestamp + this.config.windowMs - now

    if (remaining <= 0) {
      return { allowed: false, remaining: 0, resetMs: Math.max(0, resetMs) }
    }

    return { allowed: true, remaining: remaining - 1, resetMs: Math.max(0, resetMs) }
  }

  /**
   * Record a request for a client
   * @param clientId - Unique identifier for the client
   */
  record(clientId: string): void {
    const now = Date.now()
    let windowData = this.windows.get(clientId)
    if (!windowData) {
      windowData = { timestamps: [], blocked: false }
      this.windows.set(clientId, windowData)
    }
    windowData.timestamps.push(now)
  }

  /**
   * Try to acquire a rate limit slot
   * @param clientId - Unique identifier for the client
   * @returns Object with allowed status and rate limit info
   */
  tryAcquire(clientId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const result = this.check(clientId)
    if (result.allowed) {
      this.record(clientId)
    }
    return result
  }

  /**
   * Reset rate limit for a client (useful for testing)
   */
  reset(clientId: string): void {
    this.windows.delete(clientId)
  }

  /**
   * Reset all rate limits (useful for testing)
   */
  resetAll(): void {
    this.windows.clear()
  }
}

/**
 * Concurrency limiter - limits concurrent operations per client
 */
export class ConcurrencyLimiter {
  private activeOperations: Map<string, number> = new Map()
  private waitingQueues: Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>> = new Map()
  private config: ConcurrencyLimitConfig

  constructor(config: Partial<ConcurrencyLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONCURRENCY_LIMIT, ...config }
  }

  /**
   * Get current active operations count for a client
   */
  getActiveCount(clientId: string): number {
    return this.activeOperations.get(clientId) || 0
  }

  /**
   * Get waiting queue length for a client
   */
  getWaitingCount(clientId: string): number {
    return this.waitingQueues.get(clientId)?.length || 0
  }

  /**
   * Try to acquire a concurrency slot
   * @param clientId - Unique identifier for the client
   * @returns true if slot acquired, false if limit reached
   */
  tryAcquire(clientId: string): boolean {
    const current = this.activeOperations.get(clientId) || 0
    if (current >= this.config.maxConcurrent) {
      return false
    }
    this.activeOperations.set(clientId, current + 1)
    return true
  }

  /**
   * Acquire a slot, waiting if necessary
   * @param clientId - Unique identifier for the client
   * @param timeoutMs - Maximum time to wait (default: 30000ms)
   * @returns Promise that resolves when slot is acquired
   */
  async acquire(clientId: string, timeoutMs = 30000): Promise<void> {
    // Try immediate acquisition
    if (this.tryAcquire(clientId)) {
      return
    }

    // Need to wait for a slot
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        // Remove from waiting queue
        const queue = this.waitingQueues.get(clientId)
        if (queue) {
          const index = queue.findIndex(w => w.resolve === resolve)
          if (index !== -1) {
            queue.splice(index, 1)
          }
        }
        reject(new Error(`Concurrency limit timeout: waited ${timeoutMs}ms for a slot (max concurrent: ${this.config.maxConcurrent})`))
      }, timeoutMs)

      // Add to waiting queue
      let queue = this.waitingQueues.get(clientId)
      if (!queue) {
        queue = []
        this.waitingQueues.set(clientId, queue)
      }
      queue.push({
        resolve: () => {
          clearTimeout(timeout)
          resolve()
        },
        reject
      })
    })
  }

  /**
   * Release a concurrency slot
   * @param clientId - Unique identifier for the client
   */
  release(clientId: string): void {
    const current = this.activeOperations.get(clientId) || 0
    if (current > 0) {
      this.activeOperations.set(clientId, current - 1)

      // Check if anyone is waiting
      const queue = this.waitingQueues.get(clientId)
      if (queue && queue.length > 0) {
        const waiting = queue.shift()!
        // Acquire slot for waiting request
        this.activeOperations.set(clientId, (this.activeOperations.get(clientId) || 0) + 1)
        waiting.resolve()
      }
    }
  }

  /**
   * Reset concurrency limits for a client (useful for testing)
   */
  reset(clientId: string): void {
    this.activeOperations.delete(clientId)
    const queue = this.waitingQueues.get(clientId)
    if (queue) {
      queue.forEach(w => w.reject(new Error('Concurrency limiter reset')))
      this.waitingQueues.delete(clientId)
    }
  }

  /**
   * Reset all concurrency limits (useful for testing)
   */
  resetAll(): void {
    this.waitingQueues.forEach(queue => {
      queue.forEach(w => w.reject(new Error('Concurrency limiter reset')))
    })
    this.activeOperations.clear()
    this.waitingQueues.clear()
  }
}

/**
 * Combined resource enforcer that handles rate limiting and concurrency
 *
 * @deprecated Direct instantiation is discouraged. Use {@link createScopedResourceEnforcer}
 * instead to create request-scoped or DO-scoped enforcers that prevent state leakage
 * between requests in a Workers environment.
 *
 * @example
 * // WRONG: Global singleton (causes state leakage between requests)
 * const globalEnforcer = new SandboxResourceEnforcer()
 *
 * // CORRECT: Create per-request or per-DO instance
 * const enforcer = createScopedResourceEnforcer()
 */
export class SandboxResourceEnforcer {
  private rateLimiter: RateLimiter
  private concurrencyLimiter: ConcurrencyLimiter

  constructor(
    rateLimitConfig?: Partial<RateLimitConfig>,
    concurrencyConfig?: Partial<ConcurrencyLimitConfig>
  ) {
    this.rateLimiter = new RateLimiter(rateLimitConfig)
    this.concurrencyLimiter = new ConcurrencyLimiter(concurrencyConfig)
  }

  /**
   * Acquire resources for a sandbox execution
   * @param clientId - Unique identifier for the client
   * @param waitForSlot - If true, wait for a slot instead of failing immediately
   * @param timeoutMs - Timeout for waiting (if waitForSlot is true)
   * @returns Release function to call when done
   */
  async acquire(
    clientId: string,
    waitForSlot = false,
    timeoutMs = 30000
  ): Promise<{ release: () => void }> {
    // Check rate limit first
    const rateCheck = this.rateLimiter.tryAcquire(clientId)
    if (!rateCheck.allowed) {
      throw new Error(
        `Rate limit exceeded: ${DEFAULT_RATE_LIMIT.maxRequests} requests per ${DEFAULT_RATE_LIMIT.windowMs}ms. ` +
        `Reset in ${rateCheck.resetMs}ms.`
      )
    }

    // Now handle concurrency
    if (waitForSlot) {
      await this.concurrencyLimiter.acquire(clientId, timeoutMs)
    } else {
      if (!this.concurrencyLimiter.tryAcquire(clientId)) {
        throw new Error(
          `Concurrency limit exceeded: max ${DEFAULT_CONCURRENCY_LIMIT.maxConcurrent} concurrent operations per client`
        )
      }
    }

    // Create an idempotent release function to prevent double-release bugs
    // This ensures calling release() multiple times only decrements the counter once
    let released = false
    return {
      release: () => {
        if (!released) {
          released = true
          this.concurrencyLimiter.release(clientId)
        }
      }
    }
  }

  /**
   * Get rate limiter for direct access
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter
  }

  /**
   * Get concurrency limiter for direct access
   */
  getConcurrencyLimiter(): ConcurrencyLimiter {
    return this.concurrencyLimiter
  }

  /**
   * Reset all limits for testing
   */
  resetAll(): void {
    this.rateLimiter.resetAll()
    this.concurrencyLimiter.resetAll()
  }
}

/**
 * Create a new request-scoped or DO-scoped resource enforcer.
 *
 * This is the **preferred** way to create enforcers in Workers to prevent state leakage
 * between requests. Each call returns a fresh, isolated enforcer instance.
 *
 * @example
 * // In a Durable Object constructor:
 * class MyDO {
 *   private enforcer: SandboxResourceEnforcer
 *
 *   constructor() {
 *     this.enforcer = createScopedResourceEnforcer()
 *   }
 * }
 *
 * @example
 * // Per-request in a Worker:
 * export default {
 *   async fetch(request: Request) {
 *     const enforcer = createScopedResourceEnforcer()
 *     // Use enforcer for this request only
 *   }
 * }
 *
 * @param rateLimitConfig - Optional rate limit configuration
 * @param concurrencyConfig - Optional concurrency limit configuration
 * @returns A new, isolated SandboxResourceEnforcer instance
 */
export function createScopedResourceEnforcer(
  rateLimitConfig?: Partial<RateLimitConfig>,
  concurrencyConfig?: Partial<ConcurrencyLimitConfig>
): SandboxResourceEnforcer {
  return new SandboxResourceEnforcer(rateLimitConfig, concurrencyConfig)
}

// Storage for captured operations (shared between sandbox instances)
interface CapturedOperation {
  type: 'send' | 'try' | 'do' | 'on' | 'every'
  data: any
  actionResult?: any
}

/**
 * Generate resource enforcement code to be injected into sandbox
 * This code tracks memory allocations, CPU time, and blocks network access
 */
function generateResourceEnforcementCode(limits: Required<ResourceLimits>): string {
  return `
// Resource Enforcement - Injected by sandbox
const __resource__ = {
  startTime: Date.now(),
  cpuCheckpoints: 0,
  lastCpuCheck: Date.now(),
  memoryAllocated: 0,
  peakMemory: 0,
  memoryLimitBytes: ${limits.memoryLimitMB * 1024 * 1024},
  timeoutMs: ${limits.timeout},
  cpuTimeMs: 0,
  limitViolated: null,

  checkCpuTime() {
    const now = Date.now();
    const elapsed = now - this.startTime;
    this.cpuTimeMs = elapsed;

    // If we've been running for longer than timeout, it's a CPU time issue
    // (since async timeout should have fired)
    if (elapsed > this.timeoutMs) {
      this.limitViolated = 'cpu';
      throw new Error('CPU time limit exceeded: execution took ' + elapsed + 'ms (limit: ' + this.timeoutMs + 'ms)');
    }

    this.cpuCheckpoints++;
    this.lastCpuCheck = now;
  },

  trackAllocation(bytes) {
    this.memoryAllocated += bytes;
    if (this.memoryAllocated > this.peakMemory) {
      this.peakMemory = this.memoryAllocated;
    }
    if (this.memoryAllocated > this.memoryLimitBytes) {
      this.limitViolated = 'memory';
      const usedMB = Math.round(this.memoryAllocated / 1024 / 1024 * 100) / 100;
      const limitMB = Math.round(this.memoryLimitBytes / 1024 / 1024);
      throw new Error('Memory limit exceeded: ' + usedMB + 'MB used (limit: ' + limitMB + 'MB)');
    }
  },

  getStats() {
    return {
      memoryUsedMB: Math.round(this.memoryAllocated / 1024 / 1024 * 100) / 100,
      peakMemoryMB: Math.round(this.peakMemory / 1024 / 1024 * 100) / 100,
      cpuTimeMs: Date.now() - this.startTime,
      limitViolated: this.limitViolated
    };
  }
};

// Block network access unless explicitly allowed
${!limits.allowNetwork ? `
const __blockedFetch = () => {
  __resource__.limitViolated = 'network';
  throw new Error('Network access denied');
};

const __blockedWebSocket = function() {
  __resource__.limitViolated = 'network';
  throw new Error('Network access denied');
};

// Override fetch
if (typeof globalThis !== 'undefined') {
  globalThis.fetch = __blockedFetch;
  globalThis.WebSocket = __blockedWebSocket;
}

// Also override in local scope
const fetch = __blockedFetch;
const WebSocket = __blockedWebSocket;
` : ''}

// Wrap Array constructor to track memory - use globalThis to avoid TDZ
const __OriginalArray = globalThis.Array;

// Create tracked array constructor function
function __createTrackedArray(...args) {
  const arr = new __OriginalArray(...args);
  // Estimate memory: 8 bytes per element (for numbers) + overhead
  const estimatedBytes = (arr.length || 0) * 8 + 64;
  __resource__.trackAllocation(estimatedBytes);
  return arr;
}

// Copy static methods
__createTrackedArray.isArray = (arg) => __OriginalArray.isArray(arg);
__createTrackedArray.from = function(...args) {
  const arr = __OriginalArray.from.apply(__OriginalArray, args);
  const estimatedBytes = arr.length * 8 + 64;
  __resource__.trackAllocation(estimatedBytes);
  return arr;
};
__createTrackedArray.of = function(...args) {
  const arr = __OriginalArray.of.apply(__OriginalArray, args);
  const estimatedBytes = arr.length * 8 + 64;
  __resource__.trackAllocation(estimatedBytes);
  return arr;
};

// Copy prototype
__createTrackedArray.prototype = __OriginalArray.prototype;

// Replace Array globally
globalThis.Array = __createTrackedArray;

// Hook Array.prototype.join to track memory when joining large arrays or strings
// This prevents bypass via Array(n).fill(str).join('')
const __origJoin = __OriginalArray.prototype.join;
__OriginalArray.prototype.join = function(separator) {
  const result = __origJoin.call(this, separator);
  if (result.length > 1000) {
    // Track string memory: 2 bytes per char
    __resource__.trackAllocation(result.length * 2);
  }
  return result;
};

// Hook Array.prototype.fill to track when filling with large objects
const __origFill = __OriginalArray.prototype.fill;
__OriginalArray.prototype.fill = function(value, start, end) {
  const result = __origFill.call(this, value, start, end);
  // Estimate memory based on fill extent
  const fillStart = start || 0;
  const fillEnd = end !== undefined ? end : this.length;
  const fillCount = fillEnd - fillStart;
  if (typeof value === 'string' && value.length > 0) {
    // Track memory for string fills
    __resource__.trackAllocation(fillCount * value.length * 2);
  }
  return result;
};

// Track string length to catch exponential growth
// Intercept String.prototype.concat and the + operator by watching string creation
let __lastStringLength = 0;

// Override String constructor to track allocations
const __OriginalString = globalThis.String;
const __TrackedString = function(value) {
  const str = value === undefined ? '' : __OriginalString(value);
  if (str.length > 1000) {
    // Track string memory: 2 bytes per char
    __resource__.trackAllocation(str.length * 2);
  }
  return str;
};
__TrackedString.prototype = __OriginalString.prototype;
__TrackedString.fromCharCode = __OriginalString.fromCharCode;
__TrackedString.fromCodePoint = __OriginalString.fromCodePoint;
__TrackedString.raw = __OriginalString.raw;
globalThis.String = __TrackedString;

// Track large string concatenation via prototype
const __origConcat = __OriginalString.prototype.concat;
__OriginalString.prototype.concat = function(...args) {
  const result = __origConcat.apply(this, args);
  if (result.length > 10000) {
    __resource__.trackAllocation(result.length * 2);
  }
  return result;
};

// Hook into string repeat for exponential growth patterns
const __origRepeat = __OriginalString.prototype.repeat;
__OriginalString.prototype.repeat = function(count) {
  const result = __origRepeat.call(this, count);
  if (result.length > 1000) {
    __resource__.trackAllocation(result.length * 2);
  }
  return result;
};
`
}

/**
 * Placeholder type for storing comment positions
 */
interface CommentPlaceholder {
  start: number
  end: number
  placeholder: string
  original: string
}

/**
 * Strip comments from code while preserving positions
 * Returns the code with comments replaced by spaces and a mapping to restore them
 *
 * This is critical for security: comments can be used to obfuscate loop patterns
 * e.g., "while/\* bypass \*\/(true)" would not match the while regex
 */
function stripComments(code: string): { stripped: string; placeholders: CommentPlaceholder[] } {
  const placeholders: CommentPlaceholder[] = []
  let result = ''
  let i = 0

  while (i < code.length) {
    // Check for string literals (don't strip comments inside strings)
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i]
      result += code[i]
      i++
      // Handle template literal
      if (quote === '`') {
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) {
            result += code[i]! + code[i + 1]!
            i += 2
          } else if (code[i] === '$' && code[i + 1] === '{') {
            // Template expression - find matching }
            result += code[i]! + code[i + 1]!
            i += 2
            let braceDepth = 1
            while (i < code.length && braceDepth > 0) {
              if (code[i] === '{') braceDepth++
              else if (code[i] === '}') braceDepth--
              result += code[i]
              i++
            }
          } else if (code[i] === '`') {
            result += code[i]
            i++
            break
          } else {
            result += code[i]
            i++
          }
        }
      } else {
        // Regular string
        while (i < code.length && code[i] !== quote) {
          if (code[i] === '\\' && i + 1 < code.length) {
            result += code[i]! + code[i + 1]!
            i += 2
          } else {
            result += code[i]
            i++
          }
        }
        if (i < code.length) {
          result += code[i] // Closing quote
          i++
        }
      }
    }
    // Check for line comment
    else if (code[i] === '/' && code[i + 1] === '/') {
      const start = i
      let end = i
      while (end < code.length && code[end] !== '\n') {
        end++
      }
      // Replace with spaces to preserve positions
      const original = code.slice(start, end)
      const spaces = ' '.repeat(end - start)
      placeholders.push({ start, end, placeholder: spaces, original })
      result += spaces
      i = end
    }
    // Check for block comment
    else if (code[i] === '/' && code[i + 1] === '*') {
      const start = i
      let end = i + 2
      while (end < code.length - 1 && !(code[end] === '*' && code[end + 1] === '/')) {
        end++
      }
      end += 2 // Include */
      // Replace with spaces, preserving newlines
      const original = code.slice(start, end)
      let spaces = ''
      for (let j = start; j < end; j++) {
        spaces += code[j] === '\n' ? '\n' : ' '
      }
      placeholders.push({ start, end, placeholder: spaces, original })
      result += spaces
      i = end
    }
    else {
      result += code[i]
      i++
    }
  }

  return { stripped: result, placeholders }
}

/**
 * Normalize Unicode whitespace characters to regular spaces
 * This prevents bypasses using exotic whitespace characters like:
 * - U+00A0 (non-breaking space)
 * - U+200B (zero-width space)
 * - U+2003 (em space)
 * - etc.
 */
function normalizeWhitespace(code: string): string {
  // Unicode whitespace characters that should be normalized
  // Preserves newlines and tabs for readability
  return code.replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, ' ')
}

/**
 * Find the matching closing parenthesis for an opening paren
 * Returns the index of the closing paren or -1 if not found
 * Handles nested parentheses and string literals
 */
function findMatchingParen(code: string, openIndex: number): number {
  let depth = 1
  let i = openIndex + 1

  while (i < code.length && depth > 0) {
    const char = code[i]

    // Skip string literals
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      i++
      while (i < code.length) {
        if (code[i] === '\\' && i + 1 < code.length) {
          i += 2
        } else if (code[i] === quote) {
          i++
          break
        } else if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
          // Skip template literal expression
          i += 2
          let braceDepth = 1
          while (i < code.length && braceDepth > 0) {
            if (code[i] === '{') braceDepth++
            else if (code[i] === '}') braceDepth--
            i++
          }
        } else {
          i++
        }
      }
      continue
    }

    if (char === '(') depth++
    else if (char === ')') depth--
    i++
  }
  return depth === 0 ? i - 1 : -1
}

/**
 * Check if code at given index starts with a control flow keyword
 * Returns the keyword name and length if found, null otherwise
 */
function matchControlFlowKeyword(code: string, index: number): { keyword: string; length: number } | null {
  const keywords = ['for', 'while', 'do', 'if', 'switch', 'with', 'try']
  for (const kw of keywords) {
    if (code.slice(index, index + kw.length) === kw) {
      // Make sure it's a complete word (not part of identifier like "fortune")
      const nextChar = code[index + kw.length]
      if (!nextChar || /[\s(;{]/.test(nextChar)) {
        return { keyword: kw, length: kw.length }
      }
    }
  }
  return null
}

/**
 * Find the end of a control flow statement body (handles both braced and braceless)
 * Returns the index after the body ends
 */
function findControlFlowBodyEnd(code: string, startIndex: number): number {
  let i = startIndex

  // Skip whitespace
  while (i < code.length && /\s/.test(code[i])) {
    i++
  }

  if (i >= code.length) return i

  // If body starts with brace, find matching close brace
  if (code[i] === '{') {
    let braceDepth = 1
    i++
    while (i < code.length && braceDepth > 0) {
      // Skip string literals
      if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const quote = code[i]
        i++
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) {
            i += 2
          } else if (code[i] === quote) {
            i++
            break
          } else if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
            i += 2
            let bd = 1
            while (i < code.length && bd > 0) {
              if (code[i] === '{') bd++
              else if (code[i] === '}') bd--
              i++
            }
          } else {
            i++
          }
        }
        continue
      }
      if (code[i] === '{') braceDepth++
      else if (code[i] === '}') braceDepth--
      i++
    }
    return i
  }

  // Empty statement (semicolon only)
  if (code[i] === ';') {
    return i + 1
  }

  // Braceless body - could be another control flow or a simple statement
  // Recursively call findStatementEnd which handles control flow
  return findStatementEnd(code, i)
}

/**
 * Find the end of a single statement (for braceless loops)
 * Returns the index after the statement ends (after semicolon or newline for single statements)
 *
 * SECURITY FIX (do-94il): This function now correctly handles nested control flow statements
 * like `for (...) for (...) x++` by detecting control flow keywords and recursively
 * finding their body ends.
 */
function findStatementEnd(code: string, startIndex: number): number {
  let i = startIndex
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0

  // Skip leading whitespace
  while (i < code.length && /\s/.test(code[i])) {
    i++
  }

  // Handle block statement (braces)
  if (code[i] === '{') {
    return -1 // Caller should handle braced body differently
  }

  // Handle empty statement (just semicolon)
  if (code[i] === ';') {
    return i + 1
  }

  // SECURITY FIX: Check if statement starts with a control flow keyword
  // This handles nested braceless loops like: for (...) for (...) x++
  const ctrlMatch = matchControlFlowKeyword(code, i)
  if (ctrlMatch) {
    const { keyword, length } = ctrlMatch
    i += length

    // Skip whitespace after keyword
    while (i < code.length && /\s/.test(code[i])) {
      i++
    }

    // Handle the control flow statement based on type
    if (keyword === 'do') {
      // do-while: do { body } while (cond);
      const bodyEnd = findControlFlowBodyEnd(code, i)
      i = bodyEnd
      // Skip whitespace
      while (i < code.length && /\s/.test(code[i])) {
        i++
      }
      // Expect 'while'
      if (code.slice(i, i + 5) === 'while') {
        i += 5
        // Skip whitespace
        while (i < code.length && /\s/.test(code[i])) {
          i++
        }
        // Find matching paren for condition
        if (code[i] === '(') {
          const closeParen = findMatchingParen(code, i)
          if (closeParen !== -1) {
            i = closeParen + 1
            // Skip whitespace and optional semicolon
            while (i < code.length && /\s/.test(code[i])) {
              i++
            }
            if (code[i] === ';') i++
          }
        }
      }
      return i
    } else if (keyword === 'if') {
      // if (cond) body [else body]
      if (code[i] === '(') {
        const closeParen = findMatchingParen(code, i)
        if (closeParen !== -1) {
          i = closeParen + 1
          // Find end of if body
          i = findControlFlowBodyEnd(code, i)
          // Check for else
          let j = i
          while (j < code.length && /\s/.test(code[j])) {
            j++
          }
          if (code.slice(j, j + 4) === 'else') {
            i = j + 4
            // Find end of else body
            i = findControlFlowBodyEnd(code, i)
          }
        }
      }
      return i
    } else if (keyword === 'try') {
      // try { body } catch/finally
      const bodyEnd = findControlFlowBodyEnd(code, i)
      i = bodyEnd
      // Handle catch
      while (i < code.length && /\s/.test(code[i])) {
        i++
      }
      if (code.slice(i, i + 5) === 'catch') {
        i += 5
        while (i < code.length && /\s/.test(code[i])) {
          i++
        }
        // Optional catch parameter
        if (code[i] === '(') {
          const closeParen = findMatchingParen(code, i)
          if (closeParen !== -1) {
            i = closeParen + 1
          }
        }
        i = findControlFlowBodyEnd(code, i)
      }
      // Handle finally
      while (i < code.length && /\s/.test(code[i])) {
        i++
      }
      if (code.slice(i, i + 7) === 'finally') {
        i += 7
        i = findControlFlowBodyEnd(code, i)
      }
      return i
    } else {
      // for, while, switch, with: keyword (condition/expr) body
      if (code[i] === '(') {
        const closeParen = findMatchingParen(code, i)
        if (closeParen !== -1) {
          i = closeParen + 1
          // Find end of body
          i = findControlFlowBodyEnd(code, i)
        }
      }
      return i
    }
  }

  // Regular statement - find semicolon or appropriate end
  while (i < code.length) {
    const char = code[i]

    // Skip string literals
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      i++
      while (i < code.length) {
        if (code[i] === '\\' && i + 1 < code.length) {
          i += 2
        } else if (code[i] === quote) {
          i++
          break
        } else if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
          i += 2
          let bd = 1
          while (i < code.length && bd > 0) {
            if (code[i] === '{') bd++
            else if (code[i] === '}') bd--
            i++
          }
        } else {
          i++
        }
      }
      continue
    }

    // Track nested structures
    if (char === '{') braceDepth++
    else if (char === '}') braceDepth--
    else if (char === '(') parenDepth++
    else if (char === ')') parenDepth--
    else if (char === '[') bracketDepth++
    else if (char === ']') bracketDepth--

    // Statement ends at semicolon (when not nested)
    if (char === ';' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      return i + 1
    }

    // For braceless loop bodies that are single expressions without semicolon,
    // the statement ends at newline when not in nested structure
    if (char === '\n' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      // Check if next non-whitespace is something that continues the statement
      let j = i + 1
      while (j < code.length && /[ \t]/.test(code[j])) j++
      // If next char is operator or another control structure, statement continues
      if (j < code.length && /[+\-*/%&|^<>=!?:,.]/.test(code[j])) {
        i++
        continue
      }
      return i + 1
    }

    i++
  }

  return i
}

/**
 * Inject CPU checkpoints and memory tracking into code
 * This adds checkpoint calls at loop boundaries and tracks string growth
 *
 * SECURITY FIX (do-94il): This implementation addresses regex bypass vulnerabilities:
 * 1. Strips comments before processing to prevent comment obfuscation
 * 2. Normalizes Unicode whitespace to prevent exotic whitespace bypasses
 * 3. Handles braceless loops by wrapping single statements in braces with checkpoints
 * 4. Tracks template literal concatenation for memory protection
 */
function injectResourceChecks(code: string): string {
  // Step 1: Normalize Unicode whitespace to prevent exotic whitespace bypasses
  code = normalizeWhitespace(code)

  // Step 2: Strip comments to prevent comment obfuscation attacks
  const { stripped } = stripComments(code)
  // We work on stripped code for pattern matching, but we need to produce valid JS
  // So we'll use the stripped version for everything

  let processedCode = stripped

  // Step 3: Process while loops (both braced and braceless)
  processedCode = processLoops(processedCode, 'while')

  // Step 4: Process for loops (both braced and braceless)
  processedCode = processLoops(processedCode, 'for')

  // Step 5: Process do-while loops (always have braces in practice)
  processedCode = processedCode.replace(
    /\bdo\s*\{/g,
    'do { __resource__.checkCpuTime();'
  )

  // Step 6: Track string concatenation patterns
  // Standard concatenation: str = str + str or str += str
  processedCode = processedCode.replace(
    /(\w+)\s*=\s*(\w+)\s*\+\s*(\w+)\s*;?/g,
    (match, varName, left, right) => {
      if (left === varName || right === varName || left === right) {
        return `${match}; if (typeof ${varName} === 'string' && ${varName}.length > 1000) __resource__.trackAllocation(${varName}.length * 2);`
      }
      return match
    }
  )

  // Track template literal assignments that could grow exponentially
  // Pattern: str = `${str}${str}` or similar
  processedCode = processedCode.replace(
    /(\w+)\s*=\s*`[^`]*\$\{\s*\1\s*\}[^`]*\$\{\s*\1\s*\}[^`]*`\s*;?/g,
    (match, varName) => {
      return `${match}; if (typeof ${varName} === 'string' && ${varName}.length > 1000) __resource__.trackAllocation(${varName}.length * 2);`
    }
  )

  return processedCode
}

/**
 * Process loops of a given type (while or for)
 * Handles both braced and braceless loop bodies
 */
function processLoops(code: string, loopType: 'while' | 'for'): string {
  let result = ''
  let lastIndex = 0
  const loopRegex = new RegExp(`\\b${loopType}\\s*\\(`, 'g')
  let match

  while ((match = loopRegex.exec(code)) !== null) {
    const openParenIndex = match.index + match[0].length - 1
    const closeParenIndex = findMatchingParen(code, openParenIndex)

    if (closeParenIndex === -1) continue

    // Look for what comes after the closing paren
    const afterParen = code.slice(closeParenIndex + 1)

    // Skip whitespace to find first non-whitespace char
    const firstNonWhitespaceMatch = afterParen.match(/^\s*/)
    const whitespace = firstNonWhitespaceMatch ? firstNonWhitespaceMatch[0] : ''
    const afterWhitespace = afterParen.slice(whitespace.length)

    if (afterWhitespace.startsWith('{')) {
      // Braced loop - inject checkpoint after opening brace
      const braceIndex = closeParenIndex + 1 + whitespace.length + 1
      result += code.slice(lastIndex, braceIndex)
      result += ' __resource__.checkCpuTime();'
      lastIndex = braceIndex
    } else if (afterWhitespace.length > 0 && !afterWhitespace.startsWith(';')) {
      // Braceless loop with statement body - wrap in braces with checkpoint
      const statementStart = closeParenIndex + 1 + whitespace.length
      const statementEnd = findStatementEnd(code, statementStart)

      if (statementEnd > statementStart) {
        const statement = code.slice(statementStart, statementEnd)
        // Copy everything up to the statement
        result += code.slice(lastIndex, statementStart)
        // Wrap statement in braces with checkpoint
        result += '{ __resource__.checkCpuTime(); ' + statement.trim() + ' }'
        lastIndex = statementEnd
      }
    } else if (afterWhitespace.startsWith(';')) {
      // Empty loop body (semicolon) - inject checkpoint in condition check
      // This is tricky - for while(++x < n); we inject before the condition
      // For now, wrap in braces
      const semiIndex = closeParenIndex + 1 + whitespace.length + 1
      result += code.slice(lastIndex, closeParenIndex + 1)
      result += '{ __resource__.checkCpuTime(); }'
      lastIndex = semiIndex
    }

    // Update regex lastIndex to continue from where we left off
    loopRegex.lastIndex = lastIndex > match.index + match[0].length ? lastIndex : match.index + match[0].length
  }

  result += code.slice(lastIndex)
  return result
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
    const stats = typeof __resource__ !== 'undefined' ? __resource__.getStats() : {};
    return {
      __sandbox_error__: e.message,
      __sandbox_captured__: __sandbox_captured__,
      __sandbox_stats__: stats
    };
  }
  const stats = typeof __resource__ !== 'undefined' ? __resource__.getStats() : {};
  return {
    __sandbox_result__: __user_result__,
    __sandbox_captured__: __sandbox_captured__,
    __sandbox_stats__: stats
  };
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
  const { context, timeout: legacyTimeout, permissions, audit = false, onAudit, resourceLimits, allowNetwork } = options

  // Merge resource limits with defaults (support legacy timeout option)
  const limits: Required<ResourceLimits> = {
    ...DEFAULT_RESOURCE_LIMITS,
    ...resourceLimits,
    timeout: resourceLimits?.timeout ?? legacyTimeout ?? DEFAULT_RESOURCE_LIMITS.timeout,
    allowNetwork: allowNetwork ?? resourceLimits?.allowNetwork ?? DEFAULT_RESOURCE_LIMITS.allowNetwork
  }

  return {
    async execute(code: string): Promise<SandboxResult> {
      const startTime = Date.now()
      let timedOut = false
      let limitViolated: ResourceUsage['limitViolated'] = undefined
      const codeSize = new TextEncoder().encode(code).length

      try {
        // Validate code size before processing
        validateCode(code, limits)

        // Generate resource enforcement code
        const resourceCode = generateResourceEnforcementCode(limits)

        // Generate $ context code
        const contextCode = generateSandboxContextCode(permissions)

        // Inject CPU checkpoints into user code for busy loop detection
        const instrumentedUserCode = injectResourceChecks(code)

        // Wrap user code to return result and captured operations
        const wrappedUserCode = wrapUserCode(instrumentedUserCode)

        // Combine all code: resource enforcement + context + wrapped user code
        const fullCode = resourceCode + '\n' + contextCode + '\n' + wrappedUserCode

        // Debug: Log the transformed code to see if checkpoints are injected
        // console.log('Transformed code:', instrumentedUserCode)

        // Execute code with $ context injected
        // Use Promise.race with a timeout to ensure we don't hang
        const evaluateOptions: Parameters<typeof evaluate>[0] = {
          script: fullCode,
          timeout: limits.timeout,
        }
        // Block network access unless allowed
        if (!limits.allowNetwork) {
          evaluateOptions.fetch = null
        }
        const evaluatePromise = evaluate(evaluateOptions)

        // Create our own timeout wrapper with better error message
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true
            limitViolated = 'timeout'
            reject(new Error(`Execution timeout exceeded ${limits.timeout}ms (timed out)`))
          }, limits.timeout + 100)
        })

        const result = await Promise.race([evaluatePromise, timeoutPromise])

        const duration = Date.now() - startTime

        // Extract captured operations and user result from wrapped response
        let captured: CapturedOperation[] = []
        let userResult: unknown = result.value
        let userError: string | undefined = result.error
        let sandboxStats: { memoryUsedMB?: number; peakMemoryMB?: number; cpuTimeMs?: number; limitViolated?: string } = {}

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

          // Extract resource stats from sandbox
          if ('__sandbox_stats__' in wrappedValue) {
            sandboxStats = (wrappedValue.__sandbox_stats__ as typeof sandboxStats) || {}
          }
        }

        // Determine limit violated from error message or sandbox stats
        if (sandboxStats.limitViolated) {
          limitViolated = sandboxStats.limitViolated as ResourceUsage['limitViolated']
        } else if (userError) {
          if (userError.includes('CPU time limit')) {
            limitViolated = 'cpu'
          } else if (userError.includes('Memory limit')) {
            limitViolated = 'memory'
          } else if (userError.includes('Network access denied')) {
            limitViolated = 'network'
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

        // Build resource usage stats with data from sandbox
        const resourceUsage: ResourceUsage = {
          executionTime: duration,
          codeSize,
          timedOut,
          outputTruncated,
          memoryUsedMB: sandboxStats.memoryUsedMB,
          peakMemoryMB: sandboxStats.peakMemoryMB,
          cpuTimeMs: sandboxStats.cpuTimeMs ?? duration,
          limitViolated
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
        const message = getErrorMessage(error)

        // Detect limit violation from error message
        let errorLimitViolated: ResourceUsage['limitViolated'] = limitViolated
        if (!errorLimitViolated) {
          if (message.includes('CPU time limit')) {
            errorLimitViolated = 'cpu'
          } else if (message.includes('Memory limit')) {
            errorLimitViolated = 'memory'
          } else if (message.includes('Network access denied')) {
            errorLimitViolated = 'network'
          } else if (message.includes('timeout') || message.includes('Execution timeout')) {
            errorLimitViolated = 'timeout'
            timedOut = true
          }
        }

        return {
          success: false,
          error: message,
          duration,
          resourceUsage: {
            executionTime: duration,
            codeSize,
            timedOut,
            outputTruncated: false,
            limitViolated: errorLimitViolated
          }
        }
      }
    }
  }
}

/**
 * Test utilities - exported for unit testing the transformation functions
 * These allow testing the code injection fix without needing the full sandbox runtime
 */
export const _testUtils = {
  injectResourceChecks,
  stripComments,
  normalizeWhitespace,
  findMatchingParen,
  findStatementEnd,
  findControlFlowBodyEnd,
  matchControlFlowKeyword,
  processLoops
}
