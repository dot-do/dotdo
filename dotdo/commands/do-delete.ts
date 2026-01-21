/**
 * DO Delete Command - do-tqkb
 *
 * Delete a Durable Object's storage.
 * Supports deletion by ID or name with confirmation.
 */

import { createInterface } from 'readline'

export const name = 'do-delete'
export const description = 'Delete a Durable Object'

export interface DoDeleteOptions {
  /** Durable Object ID to delete */
  id: string
  /** Namespace/binding name */
  namespace?: string
  /** Skip confirmation prompt */
  force?: boolean
  /** Path to wrangler config */
  config?: string
  /** Output as JSON for scripting */
  json?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

export interface DoDeleteResult {
  id: string
  deleted: boolean
  message: string
}

/**
 * Prompt user for confirmation
 */
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Main do delete command function
 */
export async function doDelete(options: DoDeleteOptions): Promise<DoDeleteResult> {
  const { id, namespace, force = false, config, json = false, verbose = false } = options

  if (verbose) {
    console.log('[do delete] Options:', options)
  }

  // In JSON mode, skip interactive prompts and just attempt deletion
  if (!json) {
    // Warn about deletion
    console.log('')
    console.log('  \x1b[33mWarning: Deleting a Durable Object removes all its stored data.\x1b[0m')
    console.log(`  \x1b[33mThis action cannot be undone.\x1b[0m`)
    console.log('')
    console.log(`  Target: ${id}`)
    if (namespace) {
      console.log(`  Namespace: ${namespace}`)
    }
    console.log('')
  }

  // Confirm deletion unless --force or --json
  if (!force && !json) {
    const confirmed = await confirm('  Are you sure you want to delete this Durable Object? [y/N] ')

    if (!confirmed) {
      if (!json) {
        console.log('')
        console.log('  \x1b[2mDeletion cancelled.\x1b[0m')
        console.log('')
      }

      const result: DoDeleteResult = {
        id,
        deleted: false,
        message: 'Deletion cancelled by user',
      }

      if (json) {
        console.log(JSON.stringify(result))
      }

      return result
    }
  }

  // Note: Wrangler doesn't have a direct "delete DO" command
  // Deletion is typically done by:
  // 1. Removing the DO binding from wrangler.toml and redeploying
  // 2. Using the Cloudflare API directly
  // 3. Calling deleteAll() on the DO's storage from within the DO

  // For now, we'll provide guidance on how to delete (only in non-JSON mode)
  if (!json) {
    console.log('')
    console.log('  \x1b[36mTo delete a Durable Object:\x1b[0m')
    console.log('')
    console.log('  1. \x1b[1mVia DO method:\x1b[0m Add a delete endpoint to your DO')
    console.log('     and call storage.deleteAll()')
    console.log('')
    console.log('  2. \x1b[1mVia Cloudflare Dashboard:\x1b[0m')
    console.log('     Workers & Pages > Your Worker > Durable Objects')
    console.log('')
    console.log('  3. \x1b[1mVia API:\x1b[0m Use the Cloudflare API to delete')
    console.log('     specific DO instances')
    console.log('')
  }

  // Try to make a DELETE request to the DO if we have a local dev server
  // This assumes the DO exposes a DELETE endpoint

  if (verbose) {
    console.log('[do delete] Attempting to delete via HTTP...')
  }

  try {
    // Try local dev server first
    const localUrl = `http://localhost:8787/${namespace || 'do'}/${id}`

    const response = await fetch(localUrl, {
      method: 'DELETE',
    }).catch(() => null)

    if (response?.ok) {
      const result: DoDeleteResult = {
        id,
        deleted: true,
        message: 'Deleted via local dev server',
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        console.log('  \x1b[32mDurable Object deleted successfully via local dev server.\x1b[0m')
        console.log('')
      }

      return result
    }
  } catch (error) {
    // Local server may not be running - this is expected in production
    // Log in verbose mode for debugging connection issues
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[do delete] Local server request failed: ${message}`)
    }
  }

  // If we get here, we couldn't delete automatically
  const result: DoDeleteResult = {
    id,
    deleted: false,
    message: 'Manual deletion required - see instructions above',
  }

  if (json) {
    console.log(JSON.stringify(result))
  }

  return result
}

/**
 * CLI command handler
 */
export function doDeleteCommand(id: string, options: Omit<DoDeleteOptions, 'id'> = {}): Promise<DoDeleteResult> {
  return doDelete({ id, ...options })
}
