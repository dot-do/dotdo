// Secure sandbox environment for code execution with $ context injection
import { evaluate } from 'ai-evaluate/node'
import type { WorkflowContext } from '@dotdo/do'
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
  logs?: Array<{ level: string; message: string; timestamp?: number | undefined }> | undefined
  /** Resource usage statistics */
  resourceUsage?: ResourceUsage | undefined
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
  memoryLimitMB: 128,
  allowNetwork: false
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
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000 // 1 minute
}

/**
 * Default concurrency limit settings
 */
export const DEFAULT_CONCURRENCY_LIMIT: ConcurrencyLimitConfig = {
  maxConcurrent: 5
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

    return {
      release: () => this.concurrencyLimiter.release(clientId)
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
 * Create a request-scoped resource enforcer.
 *
 * This is the PREFERRED pattern for multi-tenant environments like Cloudflare Workers.
 * Each DO instance or request context should create its own enforcer to prevent
 * rate limit state from leaking between tenants.
 *
 * @example
 * ```typescript
 * // In your DO constructor or request handler:
 * class MyDO {
 *   private enforcer: SandboxResourceEnforcer
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     // Each DO instance gets its own isolated enforcer
 *     this.enforcer = createScopedResourceEnforcer()
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     const { release } = await this.enforcer.acquire(clientId)
 *     try {
 *       // ... execute sandboxed code
 *     } finally {
 *       release()
 *     }
 *   }
 * }
 * ```
 *
 * @param rateLimitConfig - Optional rate limit configuration
 * @param concurrencyConfig - Optional concurrency limit configuration
 * @returns A new isolated SandboxResourceEnforcer instance
 */
export function createScopedResourceEnforcer(
  rateLimitConfig?: Partial<RateLimitConfig>,
  concurrencyConfig?: Partial<ConcurrencyLimitConfig>
): SandboxResourceEnforcer {
  return new SandboxResourceEnforcer(rateLimitConfig, concurrencyConfig)
}

// ============================================================================
// DEPRECATED GLOBAL STATE - SECURITY ISSUE (do-5sc9b)
// ============================================================================
// The following global state and functions are DEPRECATED because they can leak
// rate limit state between tenants in multi-tenant Workers environments.
//
// DO NOT USE THESE FUNCTIONS IN PRODUCTION.
// Use createScopedResourceEnforcer() instead to create isolated enforcer instances.
// ============================================================================

/**
 * @deprecated Global state can leak between tenants in Workers environments.
 * Use createScopedResourceEnforcer() instead to create isolated enforcer instances.
 * @internal
 */
let globalEnforcer: SandboxResourceEnforcer | null = null

/**
 * Track whether we've already logged a deprecation warning (to avoid spam)
 * @internal
 */
let hasLoggedGetGlobalWarning = false
let hasLoggedSetGlobalWarning = false

/**
 * Security warning message for deprecated global functions
 * @internal
 */
const GLOBAL_STATE_SECURITY_WARNING = `
[SECURITY WARNING] Using deprecated global resource enforcer functions.
This can leak rate limit state between tenants in multi-tenant Workers environments.

Migration guide:
  // BEFORE (deprecated - DO NOT USE):
  const enforcer = getGlobalResourceEnforcer()

  // AFTER (recommended):
  const enforcer = createScopedResourceEnforcer()
  // Store the enforcer in your DO instance or request context

See: https://github.com/dotdo/dotdo/issues/do-5sc9b
`.trim()

/**
 * Get or create the global resource enforcer.
 *
 * @deprecated SECURITY ISSUE: This function uses global state which can leak rate limits
 * between tenants in multi-tenant Workers environments. DO NOT USE IN PRODUCTION.
 * Use createScopedResourceEnforcer() instead to create isolated enforcer instances
 * per DO or request context.
 *
 * Migration guide:
 * ```typescript
 * // BEFORE (deprecated - DO NOT USE):
 * const enforcer = getGlobalResourceEnforcer()
 *
 * // AFTER (recommended):
 * const enforcer = createScopedResourceEnforcer()
 * // Store the enforcer in your DO instance or request context
 * ```
 *
 * @throws {Error} Always throws in production to prevent security vulnerabilities.
 *                 For testing purposes only, set DOTDO_ALLOW_DEPRECATED_GLOBALS=true.
 */
export function getGlobalResourceEnforcer(): SandboxResourceEnforcer {
  // Log warning once to avoid spam
  if (!hasLoggedGetGlobalWarning) {
    hasLoggedGetGlobalWarning = true
    console.warn(GLOBAL_STATE_SECURITY_WARNING)
  }

  // In production, throw an error to prevent security issues
  // Allow bypass only for tests via environment variable
  const allowDeprecated = typeof process !== 'undefined' &&
    process.env?.DOTDO_ALLOW_DEPRECATED_GLOBALS === 'true'

  if (!allowDeprecated) {
    throw new Error(
      '[SECURITY] getGlobalResourceEnforcer() is deprecated and disabled. ' +
      'Global state can leak between tenants. Use createScopedResourceEnforcer() instead. ' +
      'Set DOTDO_ALLOW_DEPRECATED_GLOBALS=true to bypass (for testing only).'
    )
  }

  if (!globalEnforcer) {
    globalEnforcer = new SandboxResourceEnforcer()
  }
  return globalEnforcer
}

/**
 * Set a custom global resource enforcer (useful for testing).
 *
 * @deprecated SECURITY ISSUE: This function uses global state which can leak rate limits
 * between tenants in multi-tenant Workers environments. DO NOT USE IN PRODUCTION.
 * Use createScopedResourceEnforcer() instead to create isolated enforcer instances
 * per DO or request context.
 *
 * Migration guide:
 * ```typescript
 * // BEFORE (deprecated - DO NOT USE):
 * setGlobalResourceEnforcer(customEnforcer)
 *
 * // AFTER (recommended):
 * // Pass the enforcer directly to your sandbox or DO instance:
 * const enforcer = createScopedResourceEnforcer(rateLimitConfig, concurrencyConfig)
 * ```
 *
 * @throws {Error} Always throws in production to prevent security vulnerabilities.
 *                 For testing purposes only, set DOTDO_ALLOW_DEPRECATED_GLOBALS=true.
 */
export function setGlobalResourceEnforcer(enforcer: SandboxResourceEnforcer | null): void {
  // Log warning once to avoid spam
  if (!hasLoggedSetGlobalWarning) {
    hasLoggedSetGlobalWarning = true
    console.warn(GLOBAL_STATE_SECURITY_WARNING)
  }

  // In production, throw an error to prevent security issues
  // Allow bypass only for tests via environment variable
  const allowDeprecated = typeof process !== 'undefined' &&
    process.env?.DOTDO_ALLOW_DEPRECATED_GLOBALS === 'true'

  if (!allowDeprecated) {
    throw new Error(
      '[SECURITY] setGlobalResourceEnforcer() is deprecated and disabled. ' +
      'Global state can leak between tenants. Use createScopedResourceEnforcer() instead. ' +
      'Set DOTDO_ALLOW_DEPRECATED_GLOBALS=true to bypass (for testing only).'
    )
  }

  globalEnforcer = enforcer
}

/**
 * Reset the deprecation warning flags (for testing purposes only)
 * @internal
 */
export function _resetDeprecationWarnings(): void {
  hasLoggedGetGlobalWarning = false
  hasLoggedSetGlobalWarning = false
}

// Storage for captured operations (shared between sandbox instances)
interface CapturedSendData {
  type: string
  payload?: unknown
  [key: string]: unknown
}

interface CapturedOnData {
  noun: string
  verb: string
  handler?: string
}

interface CapturedEveryData {
  prop: string
  time?: string
  handler?: string
  called?: boolean
  args?: number
}

interface CapturedOperationBase {
  actionResult?: unknown
}

interface CapturedSendOperation extends CapturedOperationBase {
  type: 'send'
  data: CapturedSendData
}

interface CapturedTryOperation extends CapturedOperationBase {
  type: 'try'
  data: Record<string, unknown>
}

interface CapturedDoOperation extends CapturedOperationBase {
  type: 'do'
  data: Record<string, unknown>
}

interface CapturedOnOperation extends CapturedOperationBase {
  type: 'on'
  data: CapturedOnData
}

interface CapturedEveryOperation extends CapturedOperationBase {
  type: 'every'
  data: CapturedEveryData
}

type CapturedOperation = CapturedSendOperation | CapturedTryOperation | CapturedDoOperation | CapturedOnOperation | CapturedEveryOperation

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

// SECURITY FIX (do-94il): Hook Array.prototype.join/fill to track memory
const __origJoin = __OriginalArray.prototype.join;
__OriginalArray.prototype.join = function(sep) { const r = __origJoin.call(this, sep); if (r.length > 1000) __resource__.trackAllocation(r.length * 2); return r; };
const __origFill = __OriginalArray.prototype.fill;
__OriginalArray.prototype.fill = function(v, s, e) { const r = __origFill.call(this, v, s, e); const fs = s || 0, fe = e !== undefined ? e : this.length; if (typeof v === 'string' && v.length > 0) __resource__.trackAllocation((fe - fs) * v.length * 2); return r; };

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
 * Find the matching closing parenthesis for an opening paren
 * Returns the index of the closing paren or -1 if not found
 */
function findMatchingParen(code: string, openIndex: number): number {
  let depth = 1
  let i = openIndex + 1
  while (i < code.length && depth > 0) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') depth--
    i++
  }
  return depth === 0 ? i - 1 : -1
}

/**
 * Normalize Unicode whitespace characters to regular spaces.
 * Prevents bypasses using exotic whitespace like U+00A0, U+200B, etc.
 * SECURITY FIX (do-94il): Addresses Unicode whitespace obfuscation bypass.
 */
function normalizeWhitespace(code: string): string {
  return code.replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, ' ')
}

/**
 * Strip comments from code while preserving string literals.
 * Returns code with comments replaced by spaces to preserve positions.
 * SECURITY FIX (do-94il): Addresses comment obfuscation bypass.
 */
function stripComments(code: string): { stripped: string } {
  let result = ''
  let i = 0
  while (i < code.length) {
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i]
      result += code[i]
      i++
      if (quote === '`') {
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) { result += code[i]! + code[i + 1]!; i += 2 }
          else if (code[i] === '$' && code[i + 1] === '{') {
            result += code[i]! + code[i + 1]!; i += 2
            let bd = 1
            while (i < code.length && bd > 0) { if (code[i] === '{') bd++; else if (code[i] === '}') bd--; result += code[i]; i++ }
          } else if (code[i] === '`') { result += code[i]; i++; break }
          else { result += code[i]; i++ }
        }
      } else {
        while (i < code.length && code[i] !== quote) {
          if (code[i] === '\\' && i + 1 < code.length) { result += code[i]! + code[i + 1]!; i += 2 }
          else { result += code[i]; i++ }
        }
        if (i < code.length) { result += code[i]; i++ }
      }
    } else if (code[i] === '/' && code[i + 1] === '/') {
      let end = i; while (end < code.length && code[end] !== '\n') end++
      result += ' '.repeat(end - i); i = end
    } else if (code[i] === '/' && code[i + 1] === '*') {
      let end = i + 2; while (end < code.length - 1 && !(code[end] === '*' && code[end + 1] === '/')) end++; end += 2
      let spaces = ''; for (let j = i; j < end; j++) spaces += code[j] === '\n' ? '\n' : ' '
      result += spaces; i = end
    } else { result += code[i]; i++ }
  }
  return { stripped: result }
}

/**
 * Find the end of a control flow body (handles both braced and braceless).
 */
function findControlFlowBodyEnd(code: string, startIndex: number): number {
  let i = startIndex
  while (i < code.length && /\s/.test(code.charAt(i))) i++
  if (i >= code.length) return i
  if (code.charAt(i) === '{') {
    let bd = 1; i++
    while (i < code.length && bd > 0) {
      const ch = code.charAt(i)
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; i++
        while (i < code.length) { if (code.charAt(i) === '\\' && i + 1 < code.length) i += 2; else if (code.charAt(i) === q) { i++; break } else i++ }
        continue
      }
      if (ch === '{') bd++; else if (ch === '}') bd--; i++
    }
    return i
  }
  if (code.charAt(i) === ';') return i + 1
  return findStatementEnd(code, i)
}

/**
 * Find the end of a statement, handling control flow keywords recursively.
 * SECURITY FIX (do-94il): Critical for nested braceless loops like: for (...) for (...) x++
 */
function findStatementEnd(code: string, startIndex: number): number {
  let i = startIndex
  while (i < code.length && /\s/.test(code.charAt(i))) i++
  if (i >= code.length) return i
  if (code.charAt(i) === '{') return -1
  if (code.charAt(i) === ';') return i + 1
  const keywords = ['for', 'while', 'do', 'if', 'switch', 'with', 'try']
  for (const kw of keywords) {
    const nextChar = code.charAt(i + kw.length)
    if (code.slice(i, i + kw.length) === kw && (!nextChar || /[\s(;{]/.test(nextChar))) {
      i += kw.length; while (i < code.length && /\s/.test(code.charAt(i))) i++
      if (kw === 'do') {
        i = findControlFlowBodyEnd(code, i); while (i < code.length && /\s/.test(code.charAt(i))) i++
        if (code.slice(i, i + 5) === 'while') { i += 5; while (i < code.length && /\s/.test(code.charAt(i))) i++; if (code.charAt(i) === '(') { const c = findMatchingParen(code, i); if (c !== -1) i = c + 1 }; while (i < code.length && /\s/.test(code.charAt(i))) i++; if (code.charAt(i) === ';') i++ }
        return i
      } else if (kw === 'if') {
        if (code.charAt(i) === '(') { const c = findMatchingParen(code, i); if (c !== -1) { i = c + 1; i = findControlFlowBodyEnd(code, i); let j = i; while (j < code.length && /\s/.test(code.charAt(j))) j++; if (code.slice(j, j + 4) === 'else') { i = j + 4; i = findControlFlowBodyEnd(code, i) } } }
        return i
      } else {
        if (code.charAt(i) === '(') { const c = findMatchingParen(code, i); if (c !== -1) { i = c + 1; i = findControlFlowBodyEnd(code, i) } }
        return i
      }
    }
  }
  let bd = 0, pd = 0, bk = 0
  while (i < code.length) {
    const ch = code.charAt(i)
    if (ch === '"' || ch === "'" || ch === '`') { const q = ch; i++; while (i < code.length) { if (code.charAt(i) === '\\' && i + 1 < code.length) i += 2; else if (code.charAt(i) === q) { i++; break } else i++ }; continue }
    if (ch === '{') bd++; else if (ch === '}') bd--; else if (ch === '(') pd++; else if (ch === ')') pd--; else if (ch === '[') bk++; else if (ch === ']') bk--
    if (ch === ';' && bd === 0 && pd === 0 && bk === 0) return i + 1
    if (ch === '\n' && bd === 0 && pd === 0 && bk === 0) { let j = i + 1; while (j < code.length && /[ \t]/.test(code.charAt(j))) j++; if (j < code.length && /[+\-*/%&|^<>=!?:,.]/.test(code.charAt(j))) { i++; continue }; return i + 1 }
    i++
  }
  return i
}

/**
 * Process loops of a given type (while or for).
 * Handles both braced and braceless loop bodies.
 * SECURITY FIX (do-94il): Handles braceless loops by wrapping them with checkpoints.
 */
function processLoops(code: string, loopType: 'while' | 'for'): string {
  let result = '', lastIndex = 0
  const loopRegex = new RegExp(`\\b${loopType}\\s*\\(`, 'g')
  let match
  while ((match = loopRegex.exec(code)) !== null) {
    const openParenIndex = match.index + match[0].length - 1
    const closeParenIndex = findMatchingParen(code, openParenIndex)
    if (closeParenIndex === -1) continue
    const afterParen = code.slice(closeParenIndex + 1)
    const wsMatch = afterParen.match(/^\s*/), whitespace = wsMatch ? wsMatch[0] : ''
    const afterWhitespace = afterParen.slice(whitespace.length)
    if (afterWhitespace.startsWith('{')) {
      const braceIndex = closeParenIndex + 1 + whitespace.length + 1
      result += code.slice(lastIndex, braceIndex); result += ' __resource__.checkCpuTime();'; lastIndex = braceIndex
    } else if (afterWhitespace.length > 0 && !afterWhitespace.startsWith(';')) {
      const statementStart = closeParenIndex + 1 + whitespace.length
      const statementEnd = findStatementEnd(code, statementStart)
      if (statementEnd > statementStart) {
        let statement = code.slice(statementStart, statementEnd)
        statement = processLoops(statement, 'for'); statement = processLoops(statement, 'while')
        result += code.slice(lastIndex, statementStart); result += '{ __resource__.checkCpuTime(); ' + statement.trim() + ' }'; lastIndex = statementEnd
      }
    } else if (afterWhitespace.startsWith(';')) {
      const semiIndex = closeParenIndex + 1 + whitespace.length + 1
      result += code.slice(lastIndex, closeParenIndex + 1); result += '{ __resource__.checkCpuTime(); }'; lastIndex = semiIndex
    }
    loopRegex.lastIndex = lastIndex > match.index + match[0].length ? lastIndex : match.index + match[0].length
  }
  result += code.slice(lastIndex)
  return result
}

/**
 * Inject CPU checkpoints and memory tracking into code.
 * SECURITY FIX (do-94il): Addresses regex bypass vulnerabilities:
 * 1. Normalizes Unicode whitespace to prevent exotic whitespace bypasses
 * 2. Strips comments to prevent comment obfuscation attacks
 * 3. Handles braceless loops by wrapping them in braces with checkpoints
 * 4. Recursively processes nested loops
 * 5. Tracks string concatenation for memory protection
 */
function injectResourceChecks(code: string): string {
  code = normalizeWhitespace(code)
  const { stripped } = stripComments(code)
  let processedCode = stripped
  processedCode = processLoops(processedCode, 'while')
  processedCode = processLoops(processedCode, 'for')
  processedCode = processedCode.replace(/\bdo\s*\{/g, 'do { __resource__.checkCpuTime();')
  processedCode = processedCode.replace(/(\w+)\s*=\s*(\w+)\s*\+\s*(\w+)\s*;?/g, (m, v, l, r) => {
    if (l === v || r === v || l === r) return `${m}; if (typeof ${v} === 'string' && ${v}.length > 1000) __resource__.trackAllocation(${v}.length * 2);`
    return m
  })
  processedCode = processedCode.replace(/(\w+)\s*=\s*`[^`]*\$\{\s*\1\s*\}[^`]*\$\{\s*\1\s*\}[^`]*`\s*;?/g, (m, v) => {
    return `${m}; if (typeof ${v} === 'string' && ${v}.length > 1000) __resource__.trackAllocation(${v}.length * 2);`
  })
  return processedCode
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
        const evaluatePromise = evaluate({
          script: fullCode,
          timeout: limits.timeout,
          fetch: limits.allowNetwork ? undefined : null, // Block network access unless allowed
        })

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
            captured = (wrappedValue['__sandbox_captured__'] as CapturedOperation[]) || []
          }

          if ('__sandbox_result__' in wrappedValue) {
            userResult = wrappedValue['__sandbox_result__']
          }

          if ('__sandbox_error__' in wrappedValue) {
            userError = wrappedValue['__sandbox_error__'] as string
          }

          // Extract resource stats from sandbox
          if ('__sandbox_stats__' in wrappedValue) {
            sandboxStats = (wrappedValue['__sandbox_stats__'] as typeof sandboxStats) || {}
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
          timedOut: false,
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
            value: undefined,
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
          value: undefined,
          error: message,
          duration,
          resourceUsage: {
            executionTime: duration,
            codeSize,
            timedOut: timedOut,
            outputTruncated: false,
            limitViolated: errorLimitViolated
          }
        }
      }
    }
  }
}
