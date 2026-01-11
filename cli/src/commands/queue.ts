/**
 * Queue Command
 *
 * Queue operations via queue.do
 *
 * Usage:
 *   do queue publish my-queue '{"event": "user.signup"}'
 *   do queue publish my-queue '{}' --delay 60
 *   do queue publish my-queue '<xml>data</xml>' --content-type application/xml
 *   do queue list
 *   do queue list --json
 */

import { parseArgs, requirePositional, getStringFlag, getBooleanFlag, getNumberFlag } from '../args'
import { queueRequest } from '../rpc'
import { formatJson, formatTable } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface PublishResponse {
  message_id: string
  status: string
}

interface QueueInfo {
  name: string
  messages: number
  consumers?: number
}

interface ListQueuesResponse {
  queues: QueueInfo[]
}

// ============================================================================
// Subcommands
// ============================================================================

async function publish(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const queueName = requirePositional(args, 0, 'queue name')
  const messageBody = requirePositional(args, 1, 'message body')

  // Parse message body
  let body: unknown
  const contentType = getStringFlag(args, 'content-type') ?? 'application/json'

  if (contentType === 'application/json') {
    try {
      body = JSON.parse(messageBody)
    } catch {
      throw new Error(`Invalid message body: expected valid JSON`)
    }
  } else {
    body = messageBody
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  }

  const delay = getNumberFlag(args, 'delay')
  if (delay !== undefined) {
    headers['X-Delay'] = String(delay)
  }

  // Make request
  const response = await queueRequest<PublishResponse>(`/queues/${encodeURIComponent(queueName)}/messages`, {
    method: 'POST',
    body,
    headers,
  })

  // Output result
  const config = await getConfig()
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(`Message published: ${response.message_id}`)
    if (response.status) {
      console.log(`Status: ${response.status}`)
    }
  }
}

async function list(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Make request
  const response = await queueRequest<ListQueuesResponse>('/queues', {
    method: 'GET',
  })

  // Output result
  const config = await getConfig()
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else if (response.queues.length === 0) {
    console.log('No queues found')
  } else {
    // Cast to Record<string, unknown>[] for formatTable
    console.log(formatTable(response.queues as unknown as Record<string, unknown>[]))
  }
}

// ============================================================================
// Command Router
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const [subcommand, ...restArgs] = rawArgs

  switch (subcommand) {
    case 'publish':
      return publish(restArgs)
    case 'list':
      return list(restArgs)
    default:
      if (!subcommand) {
        throw new Error(`Missing subcommand. Usage: do queue <publish|list>`)
      }
      throw new Error(`Unknown subcommand: ${subcommand}. Available: publish, list`)
  }
}
