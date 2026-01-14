/**
 * workers.do Client
 *
 * Client for interacting with workers.do registry.
 * Handles listing DOs, linking folders, and deployments.
 *
 * Features:
 * - Automatic timeout handling (default: 10 seconds)
 * - Retry logic with exponential backoff for transient failures
 * - Clear error messages when workers.do is unreachable
 */

import { $Context } from '../../packages/client/src/index.js'
import { NetworkError } from '../utils/errors.js'

export interface Worker {
  $id: string
  name: string
  url: string
  createdAt: string
  deployedAt?: string
  accessedAt?: string
  linkedFolders?: string[]
}

export interface ListOptions {
  sortBy?: 'created' | 'deployed' | 'accessed'
  limit?: number
}

export interface CreateWorkerOptions {
  /** Worker name (defaults to username derived from email) */
  name?: string
  /** User's email (used to derive default name if name not provided) */
  email?: string
}

export interface LinkOptions {
  folder: string
  workerId: string
}

export interface WorkersDoClientOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number
}

const WORKERS_DO_URL = 'https://workers.do'
const DEFAULT_TIMEOUT = 10000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_DELAY = 1000

/**
 * Check if an error is a network/connection error that should trigger retry
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('aborted')
    )
  }
  return false
}

/**
 * Check if an error indicates workers.do is unreachable or returned invalid response
 */
function isServiceError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      isRetryableError(error) ||
      message.includes('bad rpc message') ||
      message.includes('invalid json') ||
      message.includes('unexpected token')
    )
  }
  return false
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(NetworkError.timeout(WORKERS_DO_URL, ms)), ms)
    )
  ])
}

export class WorkersDoClient {
  private token: string
  private $: ReturnType<typeof $Context>
  private timeout: number
  private maxRetries: number
  private retryBaseDelay: number

  constructor(token: string, options: WorkersDoClientOptions = {}) {
    this.token = token
    this.$ = $Context(WORKERS_DO_URL, { token })
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseDelay = options.retryBaseDelay ?? DEFAULT_RETRY_BASE_DELAY
  }

  /**
   * Execute an operation with retry logic and timeout
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await withTimeout(operation(), this.timeout, operationName)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry non-retryable errors
        if (!isRetryableError(error) && !isServiceError(error)) {
          throw this.wrapError(error, operationName)
        }

        // Last attempt - don't sleep, just throw
        if (attempt === this.maxRetries - 1) {
          break
        }

        // Exponential backoff with jitter
        const delay = this.retryBaseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)
        await sleep(delay)
      }
    }

    // All retries exhausted
    throw this.wrapError(lastError, operationName)
  }

  /**
   * Wrap an error with a user-friendly message
   */
  private wrapError(error: unknown, operationName: string): Error {
    if (error instanceof NetworkError) {
      return error
    }

    if (isServiceError(error)) {
      return NetworkError.serviceUnavailable(
        'workers.do',
        WORKERS_DO_URL,
        error instanceof Error ? error : undefined
      )
    }

    // Re-throw with context
    const message = error instanceof Error ? error.message : String(error)
    return new Error(`Failed to ${operationName}: ${message}`)
  }

  /**
   * List user's workers sorted by activity
   */
  async list(options: ListOptions = {}): Promise<Worker[]> {
    const { sortBy = 'accessed', limit = 20 } = options

    try {
      const workers = await this.withRetry(
        async () => this.$.workers.list({ sortBy, limit }) as Promise<unknown>,
        'list workers'
      )
      return workers as Worker[]
    } catch (error) {
      // For list, return empty array on network errors to allow graceful degradation
      if (NetworkError.isNetworkError(error)) {
        throw error // Let caller handle network errors explicitly
      }
      throw error
    }
  }

  /**
   * Link a folder to a worker
   */
  async link(options: LinkOptions): Promise<boolean> {
    const { folder, workerId } = options

    try {
      await this.withRetry(
        async () => this.$.workers.link({ folder, workerId }) as Promise<unknown>,
        'link folder'
      )
      return true
    } catch (error) {
      if (NetworkError.isNetworkError(error)) {
        throw error
      }
      throw error
    }
  }

  /**
   * Get a specific worker by ID
   */
  async get(workerId: string): Promise<Worker | null> {
    try {
      const worker = await this.withRetry(
        async () => this.$.workers.get(workerId) as Promise<unknown>,
        'get worker'
      )
      return worker as Worker
    } catch (error) {
      if (NetworkError.isNetworkError(error)) {
        throw error
      }
      return null
    }
  }

  /**
   * Create a new worker (default personal DO)
   */
  async create(options: CreateWorkerOptions = {}): Promise<Worker> {
    // Derive name from email if not provided
    let name = options.name
    if (!name && options.email) {
      // Extract username from email (part before @)
      name = options.email.split('@')[0]
      // Sanitize: replace dots/plus with hyphens, lowercase
      name = name.replace(/[.+]/g, '-').toLowerCase()
    }
    if (!name) {
      name = 'default'
    }

    const worker = await this.withRetry(
      async () => this.$.workers.create({ name }) as Promise<unknown>,
      'create worker'
    )
    return worker as Worker
  }

  /**
   * Check if workers.do is reachable
   * Returns true if service is available, false if unreachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      await withTimeout(
        Promise.resolve(this.$.health.check()),
        5000, // Shorter timeout for health check
        'health check'
      )
      return true
    } catch {
      return false
    }
  }
}
