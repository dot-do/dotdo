/**
 * @dotdo/gitlab - Webhook Handling
 *
 * Implements GitLab webhook signature verification and payload parsing.
 * @see https://docs.gitlab.com/ee/user/project/integrations/webhooks.html
 */

// ============================================================================
// Types
// ============================================================================

export type WebhookEventName =
  | 'push'
  | 'tag_push'
  | 'issue'
  | 'note'
  | 'merge_request'
  | 'wiki_page'
  | 'pipeline'
  | 'job'
  | 'deployment'
  | 'feature_flag'
  | 'release'
  | 'member'
  | 'subgroup'
  | 'emoji'

export interface WebhookPayloadBase {
  object_kind: WebhookEventName
  event_name?: string
  event_type?: string
  user?: {
    id: number
    name: string
    username: string
    avatar_url?: string
    email?: string
  }
  project?: {
    id: number
    name: string
    description?: string | null
    web_url: string
    avatar_url?: string | null
    git_ssh_url: string
    git_http_url: string
    namespace: string
    visibility_level?: number
    path_with_namespace: string
    default_branch: string
    homepage?: string
    url?: string
    ssh_url?: string
    http_url?: string
  }
}

export interface PushPayload extends WebhookPayloadBase {
  object_kind: 'push'
  event_name: 'push'
  before: string
  after: string
  ref: string
  checkout_sha?: string
  user_id: number
  user_name: string
  user_username: string
  user_email?: string
  user_avatar?: string
  project_id: number
  commits: Array<{
    id: string
    message: string
    title?: string
    timestamp: string
    url: string
    author: {
      name: string
      email: string
    }
    added?: string[]
    modified?: string[]
    removed?: string[]
  }>
  total_commits_count: number
}

export interface TagPushPayload extends WebhookPayloadBase {
  object_kind: 'tag_push'
  event_name: 'tag_push'
  before: string
  after: string
  ref: string
  checkout_sha?: string
  user_id: number
  user_name: string
  user_avatar?: string
  project_id: number
}

export interface IssuePayload extends WebhookPayloadBase {
  object_kind: 'issue'
  event_type: 'issue'
  object_attributes: {
    id: number
    iid: number
    title: string
    description?: string | null
    state: 'opened' | 'closed'
    created_at: string
    updated_at: string
    closed_at?: string | null
    due_date?: string | null
    url: string
    action: 'open' | 'close' | 'reopen' | 'update'
    assignee_ids?: number[]
    assignee_id?: number | null
    labels?: Array<{
      id: number
      title: string
      color: string
      description?: string | null
    }>
    milestone_id?: number | null
  }
  labels?: Array<{
    id: number
    title: string
    color: string
  }>
  changes?: {
    labels?: {
      previous: Array<{ id: number; title: string }>
      current: Array<{ id: number; title: string }>
    }
    title?: { previous: string; current: string }
    description?: { previous: string | null; current: string | null }
    state_id?: { previous: number; current: number }
  }
  assignees?: Array<{
    id: number
    name: string
    username: string
  }>
}

export interface MergeRequestPayload extends WebhookPayloadBase {
  object_kind: 'merge_request'
  event_type: 'merge_request'
  object_attributes: {
    id: number
    iid: number
    target_branch: string
    source_branch: string
    source_project_id: number
    target_project_id: number
    author_id: number
    assignee_id?: number | null
    assignee_ids?: number[]
    title: string
    description?: string | null
    state: 'opened' | 'closed' | 'merged' | 'locked'
    merge_status: string
    created_at: string
    updated_at: string
    url: string
    source: {
      id: number
      name: string
      web_url: string
      path_with_namespace: string
    }
    target: {
      id: number
      name: string
      web_url: string
      path_with_namespace: string
    }
    last_commit?: {
      id: string
      message: string
      title?: string
      timestamp: string
      url: string
      author: {
        name: string
        email: string
      }
    }
    work_in_progress?: boolean
    draft?: boolean
    action: 'open' | 'close' | 'reopen' | 'update' | 'approved' | 'unapproved' | 'approval' | 'unapproval' | 'merge'
    oldrev?: string
  }
  labels?: Array<{
    id: number
    title: string
    color: string
  }>
  changes?: {
    labels?: {
      previous: Array<{ id: number; title: string }>
      current: Array<{ id: number; title: string }>
    }
    title?: { previous: string; current: string }
    description?: { previous: string | null; current: string | null }
  }
  assignees?: Array<{
    id: number
    name: string
    username: string
  }>
  reviewers?: Array<{
    id: number
    name: string
    username: string
  }>
}

export interface NotePayload extends WebhookPayloadBase {
  object_kind: 'note'
  event_type: 'note'
  object_attributes: {
    id: number
    note: string
    noteable_type: 'Commit' | 'Issue' | 'MergeRequest' | 'Snippet'
    noteable_id?: number
    created_at: string
    updated_at: string
    url: string
    author_id: number
    line_code?: string | null
    commit_id?: string
    system?: boolean
    st_diff?: {
      diff: string
      new_path: string
      old_path: string
    } | null
  }
  issue?: {
    id: number
    iid: number
    title: string
    state: string
  }
  merge_request?: {
    id: number
    iid: number
    title: string
    state: string
    source_branch: string
    target_branch: string
  }
  commit?: {
    id: string
    message: string
    url: string
    author: {
      name: string
      email: string
    }
  }
  snippet?: {
    id: number
    title: string
  }
}

export interface PipelinePayload extends WebhookPayloadBase {
  object_kind: 'pipeline'
  object_attributes: {
    id: number
    iid: number
    ref: string
    tag: boolean
    sha: string
    before_sha: string
    source: string
    status: string
    detailed_status: string
    stages: string[]
    created_at: string
    finished_at?: string | null
    duration?: number | null
    queued_duration?: number | null
    variables?: Array<{
      key: string
      value: string
    }>
  }
  merge_request?: {
    id: number
    iid: number
    title: string
    source_branch: string
    target_branch: string
    state: string
    url: string
  }
  builds?: Array<{
    id: number
    stage: string
    name: string
    status: string
    created_at: string
    started_at?: string | null
    finished_at?: string | null
    duration?: number | null
    queued_duration?: number | null
    allow_failure: boolean
    when: string
    manual: boolean
    user: {
      id: number
      name: string
      username: string
      avatar_url?: string
    }
    runner?: {
      id: number
      description: string
      active: boolean
      runner_type: string
    } | null
    artifacts_file?: {
      filename: string
      size: number
    }
    environment?: {
      name: string
      action: string
      deployment_tier?: string
    } | null
  }>
}

export interface JobPayload extends WebhookPayloadBase {
  object_kind: 'job'
  ref: string
  tag: boolean
  before_sha: string
  sha: string
  build_id: number
  build_name: string
  build_stage: string
  build_status: string
  build_created_at: string
  build_started_at?: string | null
  build_finished_at?: string | null
  build_duration?: number | null
  build_queued_duration?: number | null
  build_allow_failure: boolean
  build_failure_reason?: string
  pipeline_id: number
  runner?: {
    id: number
    description: string
    active: boolean
    runner_type: string
    is_shared: boolean
    tags: string[]
  }
  environment?: {
    name: string
    action: string
    deployment_tier?: string
  } | null
}

export interface ReleasePayload extends WebhookPayloadBase {
  object_kind: 'release'
  action: 'create' | 'update' | 'delete'
  tag: string
  description?: string | null
  name?: string | null
  created_at: string
  released_at?: string | null
  url: string
  assets?: {
    count: number
    links: Array<{
      id: number
      name: string
      url: string
      link_type: string
    }>
    sources: Array<{
      format: string
      url: string
    }>
  }
  commit?: {
    id: string
    message: string
    title?: string
    timestamp: string
    url: string
    author: {
      name: string
      email: string
    }
  }
}

export type WebhookPayload =
  | PushPayload
  | TagPushPayload
  | IssuePayload
  | MergeRequestPayload
  | NotePayload
  | PipelinePayload
  | JobPayload
  | ReleasePayload
  | WebhookPayloadBase

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify GitLab webhook token
 *
 * GitLab uses a simpler token-based verification instead of HMAC signatures.
 * The token is sent in the X-Gitlab-Token header.
 *
 * @param receivedToken - X-Gitlab-Token header value
 * @param expectedToken - Your configured webhook secret token
 * @returns Whether the token is valid
 */
export function verifyWebhookToken(
  receivedToken: string | null,
  expectedToken: string
): boolean {
  if (!receivedToken || !expectedToken) {
    return false
  }

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(receivedToken, expectedToken)
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
 * Parse webhook payload and determine event type
 *
 * @param payload - The parsed JSON payload
 * @returns Typed webhook payload with object_kind
 */
export function parseWebhookPayload(payload: unknown): WebhookPayload {
  const parsed = payload as Record<string, unknown>
  return parsed as WebhookPayload
}

/**
 * Get event type from payload
 */
export function getEventType(payload: WebhookPayload): WebhookEventName {
  return payload.object_kind
}

/**
 * Extract token from headers
 */
export function getWebhookToken(headers: Headers): string | null {
  return headers.get('X-Gitlab-Token')
}

/**
 * Extract event type from headers
 */
export function getEventHeader(headers: Headers): string | null {
  return headers.get('X-Gitlab-Event')
}

// ============================================================================
// Webhook Handler Types
// ============================================================================

export type WebhookHandler<T extends WebhookPayload = WebhookPayload> = (
  payload: T
) => void | Promise<void>

export interface WebhookHandlers {
  push?: WebhookHandler<PushPayload>
  tag_push?: WebhookHandler<TagPushPayload>
  issue?: WebhookHandler<IssuePayload>
  merge_request?: WebhookHandler<MergeRequestPayload>
  note?: WebhookHandler<NotePayload>
  pipeline?: WebhookHandler<PipelinePayload>
  job?: WebhookHandler<JobPayload>
  release?: WebhookHandler<ReleasePayload>
  '*'?: WebhookHandler<WebhookPayload>
}

/**
 * Create a webhook handler from a map of event handlers
 */
export function createWebhookHandler(
  handlers: WebhookHandlers,
  options?: { token?: string }
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Get headers
    const receivedToken = getWebhookToken(request.headers)
    const eventHeader = getEventHeader(request.headers)

    // Verify token if provided
    if (options?.token) {
      if (!verifyWebhookToken(receivedToken, options.token)) {
        return new Response('Invalid token', { status: 401 })
      }
    }

    // Get body
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return new Response('Invalid JSON payload', { status: 400 })
    }

    const webhookPayload = parseWebhookPayload(payload)
    const eventType = getEventType(webhookPayload)

    if (!eventType) {
      return new Response('Missing object_kind in payload', { status: 400 })
    }

    // Call handler
    try {
      const handler = handlers[eventType as keyof WebhookHandlers]
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
          'X-Gitlab-Event': eventHeader || eventType,
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

import { Hono } from 'hono'

export interface WebhookEnv {
  GITLAB_WEBHOOK_TOKEN?: string
}

/**
 * Create a Hono router for GitLab webhooks
 */
export function createWebhookRouter(
  handlers: WebhookHandlers
): Hono<{ Bindings: WebhookEnv }> {
  const router = new Hono<{ Bindings: WebhookEnv }>()

  router.post('/', async (c) => {
    const receivedToken = getWebhookToken(c.req.raw.headers)
    const eventHeader = getEventHeader(c.req.raw.headers)
    const expectedToken = c.env.GITLAB_WEBHOOK_TOKEN

    // Verify token if configured
    if (expectedToken) {
      if (!verifyWebhookToken(receivedToken, expectedToken)) {
        return c.text('Invalid token', 401)
      }
    }

    // Parse payload
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.text('Invalid JSON payload', 400)
    }

    const webhookPayload = parseWebhookPayload(payload)
    const eventType = getEventType(webhookPayload)

    if (!eventType) {
      return c.text('Missing object_kind in payload', 400)
    }

    // Call handler
    try {
      const handler = handlers[eventType as keyof WebhookHandlers]
      if (handler) {
        await (handler as WebhookHandler)(webhookPayload)
      }

      if (handlers['*']) {
        await handlers['*'](webhookPayload)
      }

      return c.text('OK', 200, {
        'X-Gitlab-Event': eventHeader || eventType,
      })
    } catch (error) {
      console.error('Webhook handler error:', error)
      return c.text('Internal server error', 500)
    }
  })

  return router
}
