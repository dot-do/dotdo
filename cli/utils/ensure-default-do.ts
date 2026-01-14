/**
 * Ensure Default DO Utility
 *
 * Handles the DX improvement for auto-creating a default personal DO
 * when users have no workers configured.
 *
 * Features:
 * - Graceful handling of network errors with clear messages
 * - Falls back to local development mode when workers.do is unreachable
 */

import { WorkersDoClient, type Worker } from '../services/workers-do'
import { NetworkError } from './errors'
import { createLogger } from './logger'

const logger = createLogger('ensure-do')

export interface EnsureDefaultDOOptions {
  /** Auth token for workers.do API */
  token: string
  /** User's email (used to derive default DO name) */
  email?: string
  /** Whether to prompt user before creating (future: could add interactive confirmation) */
  autoCreate?: boolean
  /** Whether to allow fallback to local mode on network errors (default: false) */
  allowLocalFallback?: boolean
}

export interface EnsureDefaultDOResult {
  /** The worker (either existing or newly created) */
  worker: Worker
  /** Whether a new worker was created */
  created: boolean
  /** Whether we're falling back to local mode due to network issues */
  localFallback?: boolean
}

/**
 * Create a fallback local worker configuration.
 * Used when workers.do is unreachable and local fallback is enabled.
 */
function createLocalFallbackWorker(email?: string): Worker {
  const name = email
    ? email.split('@')[0].replace(/[.+]/g, '-').toLowerCase()
    : 'local'

  return {
    $id: 'local',
    name,
    url: 'http://localhost:8787',
    createdAt: new Date().toISOString(),
  }
}

/**
 * Ensures the user has at least one DO available.
 * If they have workers, returns the most recently accessed one.
 * If they have no workers, auto-creates a default personal DO.
 *
 * When workers.do is unreachable:
 * - If allowLocalFallback is true, returns a local development configuration
 * - Otherwise, throws a NetworkError with a helpful message
 *
 * @param options - Configuration options
 * @returns The worker and whether it was newly created
 */
export async function ensureDefaultDO(options: EnsureDefaultDOOptions): Promise<EnsureDefaultDOResult> {
  const { token, email, autoCreate = true, allowLocalFallback = false } = options
  const client = new WorkersDoClient(token)

  try {
    // Check if user has any workers
    const workers = await client.list({ sortBy: 'accessed', limit: 1 })

    if (workers.length > 0) {
      // User has workers, return the most recently accessed
      return {
        worker: workers[0],
        created: false,
      }
    }

    // No workers exist
    if (!autoCreate) {
      throw new Error('No workers found and auto-creation is disabled.')
    }

    // Auto-create a default personal DO
    logger.info('No workers found. Creating your personal DO...')

    const worker = await client.create({ email })

    logger.success(`Created personal DO: ${worker.name || worker.url}`)

    return {
      worker,
      created: true,
    }
  } catch (error) {
    // Handle network errors gracefully
    if (NetworkError.isNetworkError(error)) {
      if (allowLocalFallback) {
        logger.warn('Unable to connect to workers.do registry. Starting local dev mode...')
        logger.info('Tip: Check your internet connection or try again later.')

        return {
          worker: createLocalFallbackWorker(email),
          created: false,
          localFallback: true,
        }
      }

      // Re-throw with a clear message if local fallback is not enabled
      if (error instanceof NetworkError) {
        throw error
      }

      // Wrap in NetworkError for consistent handling
      throw NetworkError.serviceUnavailable(
        'workers.do',
        'https://workers.do',
        error instanceof Error ? error : undefined
      )
    }

    // Re-throw non-network errors
    throw error
  }
}

/**
 * Derives a default DO name from an email address.
 * Used to suggest a name for the user's personal DO.
 *
 * @param email - User's email address
 * @returns A sanitized name suitable for a DO
 *
 * @example
 * deriveNameFromEmail('john.doe@example.com') // 'john-doe'
 * deriveNameFromEmail('alice+test@company.io') // 'alice-test'
 */
export function deriveNameFromEmail(email: string): string {
  // Extract username from email (part before @)
  const username = email.split('@')[0]
  // Sanitize: replace dots/plus with hyphens, lowercase
  return username.replace(/[.+]/g, '-').toLowerCase()
}
