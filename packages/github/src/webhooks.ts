/**
 * @dotdo/github - Webhook Handling
 *
 * Implements GitHub webhook signature verification and payload parsing.
 * @see https://docs.github.com/en/webhooks
 */

// ============================================================================
// Types
// ============================================================================

export type WebhookEventName =
  | 'push'
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'issues'
  | 'issue_comment'
  | 'create'
  | 'delete'
  | 'fork'
  | 'release'
  | 'workflow_run'
  | 'workflow_job'
  | 'check_run'
  | 'check_suite'
  | 'deployment'
  | 'deployment_status'
  | 'status'
  | 'repository'
  | 'star'
  | 'watch'
  | 'ping'
  | 'organization'
  | 'team'
  | 'member'
  | 'membership'
  | 'label'
  | 'milestone'
  | 'project'
  | 'project_card'
  | 'project_column'
  | 'package'
  | 'discussion'
  | 'discussion_comment'
  | 'commit_comment'
  | 'gollum'
  | 'public'
  | 'page_build'

export interface WebhookPayloadBase {
  event: WebhookEventName
  action?: string
  sender?: {
    login: string
    id: number
    avatar_url?: string
  }
  repository?: {
    id: number
    name: string
    full_name: string
    private?: boolean
    owner?: {
      login: string
      id: number
    }
    html_url?: string
    description?: string | null
    fork?: boolean
    default_branch?: string
  }
  organization?: {
    login: string
    id: number
  }
  installation?: {
    id: number
    account?: {
      login: string
      id: number
    }
  }
}

export interface PushPayload extends WebhookPayloadBase {
  event: 'push'
  ref: string
  before: string
  after: string
  created?: boolean
  deleted?: boolean
  forced?: boolean
  base_ref?: string | null
  compare?: string
  commits: Array<{
    id: string
    tree_id?: string
    distinct?: boolean
    message: string
    timestamp?: string
    url?: string
    author?: {
      name: string
      email: string
      username?: string
    }
    committer?: {
      name: string
      email: string
      username?: string
    }
    added?: string[]
    removed?: string[]
    modified?: string[]
  }>
  head_commit?: {
    id: string
    message: string
    author?: {
      name: string
      email: string
    }
  } | null
  pusher: {
    name: string
    email: string
  }
}

export interface PullRequestPayload extends WebhookPayloadBase {
  event: 'pull_request'
  action: 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'review_requested' | 'review_request_removed' | 'ready_for_review' | 'converted_to_draft' | 'locked' | 'unlocked' | 'auto_merge_enabled' | 'auto_merge_disabled'
  number: number
  pull_request: {
    id: number
    number: number
    title: string
    body?: string | null
    state: 'open' | 'closed'
    locked?: boolean
    draft?: boolean
    merged?: boolean
    merge_commit_sha?: string | null
    head: {
      ref: string
      sha: string
      label?: string
    }
    base: {
      ref: string
      sha: string
      label?: string
    }
    user: {
      login: string
      id?: number
    }
    html_url?: string
    created_at?: string
    updated_at?: string
    closed_at?: string | null
    merged_at?: string | null
    mergeable?: boolean | null
    mergeable_state?: string
    additions?: number
    deletions?: number
    changed_files?: number
  }
  label?: {
    name: string
    color?: string
  }
  assignee?: {
    login: string
    id?: number
  }
  requested_reviewer?: {
    login: string
    id?: number
  }
  changes?: {
    title?: { from: string }
    body?: { from: string }
    base?: { ref: { from: string } }
  }
}

export interface IssuesPayload extends WebhookPayloadBase {
  event: 'issues'
  action: 'opened' | 'closed' | 'reopened' | 'edited' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'pinned' | 'unpinned' | 'locked' | 'unlocked' | 'transferred' | 'milestoned' | 'demilestoned' | 'deleted'
  issue: {
    id: number
    number: number
    title: string
    body?: string | null
    state: 'open' | 'closed'
    state_reason?: 'completed' | 'not_planned' | 'reopened' | null
    user: {
      login: string
      id?: number
    }
    labels?: Array<{
      name: string
      color?: string
    }>
    assignees?: Array<{
      login: string
      id?: number
    }>
    html_url?: string
    created_at?: string
    updated_at?: string
    closed_at?: string | null
  }
  label?: {
    name: string
    color?: string
  }
  assignee?: {
    login: string
    id?: number
  }
  changes?: {
    title?: { from: string }
    body?: { from: string }
  }
}

export interface IssueCommentPayload extends WebhookPayloadBase {
  event: 'issue_comment'
  action: 'created' | 'edited' | 'deleted'
  issue: {
    id: number
    number: number
    title?: string
    state?: 'open' | 'closed'
    user?: {
      login: string
      id?: number
    }
    html_url?: string
    pull_request?: {
      url: string
    }
  }
  comment: {
    id: number
    body: string
    user: {
      login: string
      id?: number
    }
    html_url?: string
    created_at?: string
    updated_at?: string
  }
  changes?: {
    body?: { from: string }
  }
}

export interface WorkflowRunPayload extends WebhookPayloadBase {
  event: 'workflow_run'
  action: 'requested' | 'completed' | 'in_progress'
  workflow_run: {
    id: number
    name?: string
    head_branch?: string | null
    head_sha: string
    path?: string
    run_number: number
    event: string
    status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending' | null
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | null
    workflow_id: number
    url: string
    html_url: string
    created_at: string
    updated_at: string
    actor?: {
      login: string
      id?: number
    }
    run_attempt?: number
    run_started_at?: string
  }
  workflow: {
    id: number
    name: string
    path?: string
    state?: string
  }
}

export interface ReleasePayload extends WebhookPayloadBase {
  event: 'release'
  action: 'published' | 'unpublished' | 'created' | 'edited' | 'deleted' | 'prereleased' | 'released'
  release: {
    id: number
    tag_name: string
    target_commitish?: string
    name?: string | null
    body?: string | null
    draft: boolean
    prerelease: boolean
    created_at: string
    published_at?: string | null
    author?: {
      login: string
      id?: number
    }
    html_url?: string
    tarball_url?: string | null
    zipball_url?: string | null
    assets?: Array<{
      id: number
      name: string
      size: number
      download_count?: number
      browser_download_url?: string
    }>
  }
}

export interface PingPayload extends WebhookPayloadBase {
  event: 'ping'
  zen: string
  hook_id: number
  hook?: {
    type: string
    id: number
    name: string
    active: boolean
    events: string[]
    config: {
      url: string
      content_type: string
      insecure_ssl?: string
      secret?: string
    }
    updated_at?: string
    created_at?: string
  }
}

export type WebhookPayload =
  | PushPayload
  | PullRequestPayload
  | IssuesPayload
  | IssueCommentPayload
  | WorkflowRunPayload
  | ReleasePayload
  | PingPayload
  | WebhookPayloadBase

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify GitHub webhook signature
 *
 * @param payload - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - Webhook secret
 * @returns Whether the signature is valid
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!secret || !signature) {
    return false
  }

  // Signature format: sha256=<hash>
  if (!signature.startsWith('sha256=')) {
    return false
  }

  const expectedSignature = signature.slice(7) // Remove 'sha256=' prefix

  try {
    const encoder = new TextEncoder()

    // Import the secret as a key
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    // Calculate the expected signature
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    )

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(signatureBuffer))
    const calculatedSignature = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(calculatedSignature, expectedSignature)
  } catch {
    return false
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

// ============================================================================
// Payload Parsing
// ============================================================================

/**
 * Parse webhook payload with event type
 *
 * @param event - The X-GitHub-Event header value
 * @param payload - The parsed JSON payload
 * @returns Typed webhook payload
 */
export function parseWebhookPayload<T extends WebhookEventName>(
  event: T,
  payload: unknown
): WebhookPayload & { event: T } {
  const parsed = payload as Record<string, unknown>

  return {
    ...parsed,
    event,
  } as WebhookPayload & { event: T }
}

/**
 * Extract delivery ID from headers
 */
export function getDeliveryId(headers: Headers): string | null {
  return headers.get('X-GitHub-Delivery')
}

/**
 * Extract event name from headers
 */
export function getEventName(headers: Headers): WebhookEventName | null {
  return headers.get('X-GitHub-Event') as WebhookEventName | null
}

/**
 * Extract signature from headers
 */
export function getSignature(headers: Headers): string | null {
  return headers.get('X-Hub-Signature-256')
}

// ============================================================================
// Webhook Handler Types
// ============================================================================

export type WebhookHandler<T extends WebhookPayload = WebhookPayload> = (
  payload: T
) => void | Promise<void>

export interface WebhookHandlers {
  push?: WebhookHandler<PushPayload>
  pull_request?: WebhookHandler<PullRequestPayload>
  issues?: WebhookHandler<IssuesPayload>
  issue_comment?: WebhookHandler<IssueCommentPayload>
  workflow_run?: WebhookHandler<WorkflowRunPayload>
  release?: WebhookHandler<ReleasePayload>
  ping?: WebhookHandler<PingPayload>
  '*'?: WebhookHandler<WebhookPayload>
}

/**
 * Create a webhook handler from a map of event handlers
 */
export function createWebhookHandler(
  handlers: WebhookHandlers,
  options?: { secret?: string }
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Get headers
    const event = getEventName(request.headers)
    const signature = getSignature(request.headers)
    const deliveryId = getDeliveryId(request.headers)

    if (!event) {
      return new Response('Missing X-GitHub-Event header', { status: 400 })
    }

    // Get body
    const body = await request.text()

    // Verify signature if secret is provided
    if (options?.secret) {
      if (!signature) {
        return new Response('Missing X-Hub-Signature-256 header', { status: 401 })
      }

      const isValid = await verifyWebhookSignature(body, signature, options.secret)
      if (!isValid) {
        return new Response('Invalid signature', { status: 401 })
      }
    }

    // Parse payload
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return new Response('Invalid JSON payload', { status: 400 })
    }

    const webhookPayload = parseWebhookPayload(event, payload)

    // Call handler
    try {
      const handler = handlers[event as keyof WebhookHandlers]
      if (handler) {
        await (handler as WebhookHandler)(webhookPayload)
      }

      // Call wildcard handler if present
      if (handlers['*']) {
        await handlers['*'](webhookPayload)
      }

      return new Response('OK', {
        status: 200,
        headers: {
          'X-GitHub-Delivery': deliveryId || '',
        },
      })
    } catch (error) {
      console.error('Webhook handler error:', error)
      return new Response('Internal server error', { status: 500 })
    }
  }
}

// ============================================================================
// Hono Integration
// ============================================================================

import type { Hono } from 'hono'

export interface WebhookEnv {
  GITHUB_WEBHOOK_SECRET?: string
}

/**
 * Create a Hono router for GitHub webhooks
 */
export function createWebhookRouter(
  handlers: WebhookHandlers
): Hono<{ Bindings: WebhookEnv }> {
  // Dynamic import to avoid bundling Hono when not needed
  const { Hono } = require('hono') as { Hono: typeof import('hono').Hono }
  const router = new Hono<{ Bindings: WebhookEnv }>()

  router.post('/', async (c) => {
    const event = getEventName(c.req.raw.headers)
    const signature = getSignature(c.req.raw.headers)
    const deliveryId = getDeliveryId(c.req.raw.headers)
    const secret = c.env.GITHUB_WEBHOOK_SECRET

    if (!event) {
      return c.text('Missing X-GitHub-Event header', 400)
    }

    const body = await c.req.text()

    // Verify signature if secret is configured
    if (secret) {
      if (!signature) {
        return c.text('Missing X-Hub-Signature-256 header', 401)
      }

      const isValid = await verifyWebhookSignature(body, signature, secret)
      if (!isValid) {
        return c.text('Invalid signature', 401)
      }
    }

    // Parse payload
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return c.text('Invalid JSON payload', 400)
    }

    const webhookPayload = parseWebhookPayload(event, payload)

    // Call handler
    try {
      const handler = handlers[event as keyof WebhookHandlers]
      if (handler) {
        await (handler as WebhookHandler)(webhookPayload)
      }

      if (handlers['*']) {
        await handlers['*'](webhookPayload)
      }

      return c.text('OK', 200, {
        'X-GitHub-Delivery': deliveryId || '',
      })
    } catch (error) {
      console.error('Webhook handler error:', error)
      return c.text('Internal server error', 500)
    }
  })

  return router
}
