/**
 * Ensure Default DO Utility
 *
 * Handles the DX improvement for auto-creating a default personal DO
 * when users have no workers configured.
 */

import { WorkersDoClient, type Worker } from '../services/workers-do'
import { createLogger } from './logger'

const logger = createLogger('ensure-do')

export interface EnsureDefaultDOOptions {
  /** Auth token for workers.do API */
  token: string
  /** User's email (used to derive default DO name) */
  email?: string
  /** Whether to prompt user before creating (future: could add interactive confirmation) */
  autoCreate?: boolean
}

export interface EnsureDefaultDOResult {
  /** The worker (either existing or newly created) */
  worker: Worker
  /** Whether a new worker was created */
  created: boolean
}

/**
 * Ensures the user has at least one DO available.
 * If they have workers, returns the most recently accessed one.
 * If they have no workers, auto-creates a default personal DO.
 *
 * @param options - Configuration options
 * @returns The worker and whether it was newly created
 */
export async function ensureDefaultDO(options: EnsureDefaultDOOptions): Promise<EnsureDefaultDOResult> {
  const { token, email, autoCreate = true } = options
  const client = new WorkersDoClient(token)

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
