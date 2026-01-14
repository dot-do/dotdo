# [SPIKE] Response Waiting Mechanism for Multi-Channel Notifications

**Issue:** dotdo-q7v3m
**Date:** 2026-01-13
**Author:** Claude
**Status:** Complete

## Executive Summary

This spike investigates how to wait for human responses across multiple notification channels (Slack, Email, SMS). The current implementation uses polling for client-side waiting, but the channel-level response capture relies on webhooks. This document proposes a unified architecture that combines webhook-based response capture with DO-backed state management and multiple client notification patterns.

## Current Architecture Analysis

### Existing Response Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │     │  Human DO   │     │  Channels   │
│  (Agent)    │     │  (Storage)  │     │ (Slack/SMS) │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │ 1. Submit Request │                   │
       │──────────────────>│                   │
       │                   │ 2. Send Notif     │
       │                   │──────────────────>│
       │                   │                   │
       │ 3. Poll Status    │                   │
       │──────────────────>│                   │
       │                   │                   │
       │     (waiting)     │                   │
       │                   │   4. User clicks  │
       │                   │<──────────────────│
       │                   │                   │
       │ 5. Poll returns   │                   │
       │<──────────────────│                   │
```

### Code References

1. **`lib/humans/templates.ts`** - Polling-based client waiting
   - `HumanClient.requestApproval()` submits and polls
   - Poll interval: `Math.min(1000, timeout / 10)`
   - Timeout handled via `HumanTimeoutError`

2. **`lib/executors/HumanFunctionExecutor.ts`** - Channel `waitForResponse` abstraction
   - Multi-channel: `Promise.race()` across channels
   - Escalation chains for timeout scenarios
   - Graph-based state persistence via `GraphHumanStore`

3. **`objects/Human.ts`** - DO-backed request storage
   - ApprovalRequest Things stored in graph model
   - Alarm-based expiration via `ctx.storage.setAlarm()`
   - HTTP endpoints: `/request`, `/request/:id`, `/request/:id/respond`

## Webhook-Based Response Capture

### Channel-Specific Webhooks

Each channel has a different response mechanism:

#### Slack Interactive Components

```typescript
// lib/human/channels/slack.ts
handleInteraction(interactionPayload: {
  user: { id: string }
  actions: Array<{ action_id: string; value: string }>
}): HumanResponse {
  // Parse action_id: `{action}_{requestId}`
  const [action, ...requestIdParts] = actions[0].action_id.split('_')
  return {
    action,
    userId: user.id,
    requestId: requestIdParts.join('_'),
    timestamp: new Date(),
  }
}
```

**Webhook Setup:**
- Configure Slack App's Interactivity Request URL
- Endpoint receives POST with `payload` form field (JSON)
- Must respond with 200 within 3 seconds

#### Email Click Tracking (SendGrid/Resend)

```typescript
// lib/human/channels/email.ts
handleWebhook(webhook: { url: string; email: string }): {
  action: string
  requestId: string
  userId: string
} {
  // Parse action link: /approve/{requestId}?action={action}
  const parsedUrl = new URL(webhook.url)
  const action = parsedUrl.searchParams.get('action')
  const pathParts = parsedUrl.pathname.split('/')
  const requestId = pathParts[pathParts.indexOf('approve') + 1]
  return { action, requestId, userId: webhook.email }
}
```

**Webhook Setup:**
- SendGrid Event Webhook for click tracking
- Resend Webhooks for email events
- Action links route through tracking → callback URL

#### SMS Inbound (Twilio)

```typescript
// lib/human/channels/sms.ts
handleWebhook(payload: {
  From: string
  Body: string
}): HumanResponse | null {
  const body = payload.Body.toLowerCase().trim()

  // Parse reply keywords
  if (['yes', 'approve', 'y', '1'].includes(body)) {
    return { action: 'approve', userId: payload.From, timestamp: new Date() }
  } else if (['no', 'reject', 'n', '0'].includes(body)) {
    return { action: 'reject', userId: payload.From, timestamp: new Date() }
  }
  return null
}
```

**Webhook Setup:**
- Twilio Messaging Webhook for inbound SMS
- Configure "A MESSAGE COMES IN" webhook URL
- Parse reply text for action keywords

### Response Correlation

The key challenge is correlating incoming webhook responses to the original request:

| Channel | Correlation Method |
|---------|-------------------|
| Slack | `action_id` contains `{action}_{requestId}` |
| Email | Action link URL contains `/approve/{requestId}?action={action}` |
| SMS | Stateful: must track `{phoneNumber} -> {pendingRequestId}` |
| Webhook | Callback includes `requestId` in payload |

**SMS Correlation Challenge:**
SMS replies don't include context - the user just texts "yes" or "no". Solutions:

1. **Recent Request Mapping:** Map phone numbers to most recent pending request
2. **Session-Based Replies:** Send unique session codes in SMS
3. **Keyword + ID:** Require "APPROVE REQ123" format

Recommended: Option 1 with a `phoneNumber -> pendingRequestIds[]` map in DO storage.

## Waiting Patterns

### Pattern 1: Polling (Current)

```typescript
// lib/humans/templates.ts - HumanClient.requestApproval()
async requestApproval(params): Promise<ApprovalResult> {
  // Submit request
  await this.fetch(`${baseUrl}/request`, {
    method: 'POST',
    body: JSON.stringify(params)
  })

  // Poll until resolved or timeout
  while (Date.now() - startTime < timeout) {
    const response = await this.fetch(`${baseUrl}/request/${params.requestId}`)
    const record = await response.json()

    if (record.status === 'approved' || record.status === 'rejected') {
      return { approved: record.status === 'approved', ... }
    }

    if (record.status === 'expired') {
      throw new HumanTimeoutError(timeout, params.requestId)
    }

    await sleep(pollInterval)
  }

  throw new HumanTimeoutError(timeout, params.requestId)
}
```

**Pros:**
- Simple implementation
- Works across all environments
- No connection state to manage

**Cons:**
- Latency (up to pollInterval delay)
- Resource-intensive for long waits
- Not suitable for hours/days waits

**When to Use:** Short waits (< 5 minutes), simple integrations

### Pattern 2: WebSocket Subscription

```typescript
// Proposed: lib/humans/realtime-client.ts
class RealtimeHumanClient {
  private ws: WebSocket
  private pending: Map<string, { resolve, reject }>

  async requestApproval(params): Promise<ApprovalResult> {
    return new Promise((resolve, reject) => {
      // Store resolver
      this.pending.set(params.requestId, { resolve, reject })

      // Submit request
      this.ws.send(JSON.stringify({
        type: 'submit',
        ...params
      }))

      // Timeout handling
      setTimeout(() => {
        if (this.pending.has(params.requestId)) {
          this.pending.delete(params.requestId)
          reject(new HumanTimeoutError(params.sla, params.requestId))
        }
      }, params.sla)
    })
  }

  handleMessage(msg) {
    if (msg.type === 'response' && this.pending.has(msg.requestId)) {
      const { resolve } = this.pending.get(msg.requestId)
      this.pending.delete(msg.requestId)
      resolve(msg.result)
    }
  }
}
```

**Pros:**
- Instant notification on response
- Lower resource usage than polling
- Bi-directional communication

**Cons:**
- Connection management complexity
- Not suitable for very long waits (connection drops)
- Requires WebSocket infrastructure

**When to Use:** Medium waits (5 min - 1 hour), interactive applications

### Pattern 3: DO Hibernation + Alarm

```typescript
// objects/Human.ts - Extended for hibernation-aware waiting
class Human extends Worker {
  async submitBlockingRequest(params): Promise<BlockingApprovalRequest> {
    // Store request in graph
    await this.createApprovalRequestThing(record)

    // Schedule expiration alarm
    if (params.sla) {
      await this.scheduleExpiration(params.requestId, params.sla)
    }

    // DO can now hibernate - alarm will wake it
    return record
  }

  async alarm(): Promise<void> {
    // Called when alarm fires - check for expired requests
    const expirations = await this.ctx.storage.get('pending_expirations')
    // ... handle expirations
  }

  // Webhook handler wakes DO to process response
  async handleWebhookResponse(response: HumanResponse): Promise<void> {
    await this.respondToBlockingRequest({
      requestId: response.requestId,
      approved: response.action === 'approve',
      approver: response.userId,
    })

    // Notify waiting clients via callback/webhook
    await this.notifyResponseReady(response.requestId)
  }
}
```

**Pros:**
- Efficient for long waits (hours/days)
- DO hibernates - no resources used while waiting
- Alarm-based expiration is reliable

**Cons:**
- Client still needs notification mechanism
- Webhook infrastructure required

**When to Use:** Long waits (> 1 hour), background approvals

### Pattern 4: Callback URL (Webhook-to-Webhook)

```typescript
// Proposed: lib/humans/callback-client.ts
interface CallbackApprovalParams {
  requestId: string
  message: string
  sla?: number
  callbackUrl: string  // Where to POST when response received
}

class CallbackHumanClient {
  async requestApproval(params: CallbackApprovalParams): Promise<void> {
    // Fire-and-forget submission
    await fetch(`${baseUrl}/request`, {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        callbackUrl: params.callbackUrl
      })
    })

    // No waiting - response delivered via callback
  }
}

// Server-side: When response received
async handleResponse(response: HumanResponse) {
  const request = await this.getApprovalRequestThing(response.requestId)
  const callbackUrl = request.data?.callbackUrl

  if (callbackUrl) {
    await fetch(callbackUrl, {
      method: 'POST',
      body: JSON.stringify({
        requestId: response.requestId,
        approved: response.action === 'approve',
        approver: response.userId,
        timestamp: new Date().toISOString()
      })
    })
  }
}
```

**Pros:**
- No connection to maintain
- Efficient for async workflows
- Works well with serverless

**Cons:**
- Requires callback endpoint
- Not suitable for synchronous code flow

**When to Use:** Async workflows, system-to-system integrations

## Multi-Channel First Response Wins

When notifications are sent to multiple channels, the first response should win:

```typescript
// lib/executors/HumanFunctionExecutor.ts - executeMultiChannel()
private async executeMultiChannel(task, taskId, ...): Promise<HumanResult> {
  const channels = task.channel as string[]

  // Send to all channels in parallel
  await Promise.all(channels.map(async (channelName) => {
    const channel = this.channels[channelName]
    await channel.send(payload)
  }))

  // Race for first response
  const responsePromises = channels.map(async (channelName) => {
    const channel = this.channels[channelName]
    const response = await channel.waitForResponse({ timeout: task.timeout })
    return { channelName, response }
  })

  const { channelName: respondingChannel, response } = await Promise.race(responsePromises)

  // Cancel pending notifications on other channels
  await this.notificationService.cancelPending()

  return {
    success: true,
    response,
    channel: respondingChannel,
    ...
  }
}
```

### Race Condition Handling

When responses arrive nearly simultaneously:

```typescript
// Proposed: atomic response handling
class Human extends Worker {
  async respondToBlockingRequest(params): Promise<BlockingApprovalRequest> {
    // Atomic check-and-update using DO transactional storage
    const thing = await this.getApprovalRequestThing(params.requestId)
    const record = this.thingToBlockingRequest(thing)

    // Optimistic locking - check status before update
    if (record.status !== 'pending') {
      // Already responded - ignore duplicate
      throw new Error(`Request already ${record.status}: ${params.requestId}`)
    }

    // DO storage operations are atomic within a single request
    record.status = params.approved ? 'approved' : 'rejected'
    record.result = { ... }
    await this.updateApprovalRequestThing(record)

    return record
  }
}
```

The DO's single-threaded execution model ensures atomicity - no two webhook handlers can process the same request simultaneously.

## Recommended Architecture

### Unified Response Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Response Waiting Architecture                       │
└──────────────────────────────────────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────┐
                  │              Human DO                    │
                  │  - Graph-backed request storage          │
                  │  - Alarm-based expiration                │
                  │  - Single-threaded atomicity             │
                  └─────────────────────────────────────────┘
                              │           ▲
                              │           │
          ┌───────────────────┼───────────┼───────────────────┐
          │                   │           │                   │
          ▼                   ▼           │                   ▼
    ┌──────────┐        ┌──────────┐      │            ┌──────────┐
    │  Slack   │        │  Email   │      │            │   SMS    │
    │ Webhook  │        │ Webhook  │      │            │ Webhook  │
    └──────────┘        └──────────┘      │            └──────────┘
          │                   │           │                   │
          │                   │           │                   │
          └───────────────────┴───────────┴───────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │   Response Router      │
                              │  - Correlate to req   │
                              │  - Update DO state    │
                              │  - Notify waiters     │
                              └───────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
             ┌──────────┐          ┌──────────┐          ┌──────────┐
             │ Polling  │          │WebSocket │          │ Callback │
             │ Client   │          │ Client   │          │   URL    │
             └──────────┘          └──────────┘          └──────────┘
```

### Implementation Layers

#### Layer 1: Channel Webhook Handlers

```typescript
// api/routes/webhooks/slack.ts
export async function handleSlackInteraction(request: Request, env: Env) {
  const payload = await request.formData()
  const interaction = JSON.parse(payload.get('payload'))

  // Parse interaction
  const slackChannel = new SlackHumanChannel({ webhookUrl: env.SLACK_WEBHOOK_URL })
  const response = slackChannel.handleInteraction(interaction)

  // Route to Human DO
  const humanDO = env.HUMAN.get(env.HUMAN.idFromName(response.requestId.split(':')[0]))
  await humanDO.respondToBlockingRequest({
    requestId: response.requestId,
    approved: response.action === 'approve',
    approver: response.userId,
  })

  // Acknowledge to Slack
  return new Response('', { status: 200 })
}
```

#### Layer 2: Response Router (Unified Webhook Endpoint)

```typescript
// api/routes/webhooks/response.ts
export async function handleResponseWebhook(request: Request, env: Env) {
  const body = await request.json()

  // Determine channel from request path or body
  const channel = request.headers.get('x-channel-type') || body.channel

  // Parse response based on channel
  let humanResponse: HumanResponse
  switch (channel) {
    case 'slack':
      humanResponse = parseSlackResponse(body)
      break
    case 'email':
      humanResponse = parseEmailClickResponse(body)
      break
    case 'sms':
      humanResponse = parseSMSInboundResponse(body, env)
      break
    default:
      humanResponse = body as HumanResponse
  }

  // Route to Human DO
  const humanDO = getHumanDO(humanResponse.requestId, env)
  const result = await humanDO.respondToBlockingRequest({
    requestId: humanResponse.requestId,
    approved: humanResponse.action === 'approve',
    approver: humanResponse.userId,
  })

  // Notify connected clients
  await notifyWaiters(humanResponse.requestId, result, env)

  return Response.json({ success: true })
}
```

#### Layer 3: Client Notification

```typescript
// api/routes/webhooks/response.ts - notifyWaiters()
async function notifyWaiters(requestId: string, result: any, env: Env) {
  // 1. Callback URL (if registered)
  const callbackUrl = result.callbackUrl
  if (callbackUrl) {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, result })
    })
  }

  // 2. WebSocket broadcast (if connected)
  const connections = await env.WS_CONNECTIONS.list({ prefix: requestId })
  for (const conn of connections.keys) {
    await env.WS_DO.get(env.WS_DO.idFromName(conn.name)).send({
      type: 'response',
      requestId,
      result
    })
  }

  // 3. Polling clients will pick up on next poll (state already updated)
}
```

## DO State Management During Wait

### Graph-Based State Model

Requests are stored as Things in the graph model:

```typescript
// From lib/human/graph-store.ts
interface HumanRequestThing {
  $id: string           // Request ID
  $type: 'TaskRequest'  // Thing type
  name: string          // Message/title
  data: {
    verbForm: 'approve' | 'approving' | 'approved' | 'rejected'
    status: 'pending' | 'completed' | 'timeout' | 'cancelled' | 'escalated'
    channel: string
    timeout: number
    createdAt: string
    expiresAt?: string
    result?: {
      approved: boolean
      approver: string
      reason?: string
      respondedAt: string
    }
  }
}
```

### Verb Form State Encoding

State transitions follow verb form patterns:

| State | Verb Form | Description |
|-------|-----------|-------------|
| Pending | `approve` | Action form - awaiting response |
| In Progress | `approving` | Activity form - being processed |
| Completed | `approved` | Event form - approved |
| Rejected | `rejected` | Event form - rejected |
| Escalated | `escalated` | Event form - escalated to backup |

### Alarm-Based Expiration

```typescript
// objects/Human.ts
async scheduleExpiration(requestId: string, delayMs: number): Promise<void> {
  // Store pending expiration
  const expirations = await this.ctx.storage.get('pending_expirations') || {}
  expirations[requestId] = Date.now() + delayMs
  await this.ctx.storage.put('pending_expirations', expirations)

  // Schedule alarm for nearest expiration
  const nextExpiration = Math.min(...Object.values(expirations))
  await this.ctx.storage.setAlarm(nextExpiration)
}

async alarm(): Promise<void> {
  const expirations = await this.ctx.storage.get('pending_expirations') || {}
  const now = Date.now()
  let nextAlarm: number | null = null

  for (const [requestId, expiresAt] of Object.entries(expirations)) {
    if (expiresAt <= now) {
      // Expire this request
      const thing = await this.getApprovalRequestThing(requestId)
      if (thing && thing.data?.status === 'pending') {
        await this.updateApprovalRequestThing({
          ...thing,
          data: { ...thing.data, status: 'expired' }
        })
        await this.emit('blocking.request.expired', { requestId })
      }
      delete expirations[requestId]
    } else {
      nextAlarm = nextAlarm ? Math.min(nextAlarm, expiresAt) : expiresAt
    }
  }

  await this.ctx.storage.put('pending_expirations', expirations)

  if (nextAlarm) {
    await this.ctx.storage.setAlarm(nextAlarm)
  }
}
```

## Timeout Handling

### Strategy 1: Immediate Failure

```typescript
if (error instanceof HumanTimeoutError) {
  return {
    success: false,
    error,
    taskId,
    channel: channelName,
    metrics
  }
}
```

### Strategy 2: Default Response

```typescript
// Task configuration
const task = {
  prompt: 'Approve the release',
  timeout: 86400000, // 24 hours
  defaultOnTimeout: {
    action: 'approve',
    reason: 'Auto-approved due to no response within SLA'
  }
}

// Handling
if (task.defaultOnTimeout) {
  const defaultResponse: HumanResponse = {
    action: task.defaultOnTimeout.action,
    userId: 'system',
    timestamp: new Date(),
    data: { reason: task.defaultOnTimeout.reason },
    isDefault: true,
  }
  return { success: true, response: defaultResponse, ... }
}
```

### Strategy 3: Escalation Chain

```typescript
// Task configuration
const task = {
  prompt: 'Urgent: Approve deployment',
  timeout: 1800000, // 30 minutes
  escalation: {
    timeout: 1800000,
    to: '@tech-lead',
    next: {
      timeout: 900000, // 15 minutes
      to: '@vp-engineering',
      next: {
        timeout: 300000, // 5 minutes
        to: '@cto'
      }
    }
  }
}

// Handling
if (task.escalation) {
  await this.emit('human.escalated', {
    fromChannel: channelName,
    toChannel: task.escalation.to,
    level: escalationLevel + 1,
  })

  const escalatedTask = buildEscalatedTask(task, { escalation: task.escalation, ... })
  return this.executeSingleChannel(escalatedTask, taskId, startTime, metrics, context, escalationLevel + 1)
}
```

## Recommendations

### Short-Term (Immediate)

1. **Keep Polling for Simple Cases**
   - Current implementation is solid for < 5 minute waits
   - Reduce poll interval dynamically based on expected wait time

2. **Standardize Webhook Handlers**
   - Create unified `/api/webhooks/human-response` endpoint
   - Register channel-specific parsers

3. **Add SMS Correlation**
   - Implement phone number -> pending request mapping
   - Store in DO with TTL matching request SLA

### Medium-Term (Next Sprint)

1. **Add WebSocket Option**
   - Optional `HumanClient.connectRealtime()` for instant notifications
   - Graceful fallback to polling if connection drops

2. **Callback URL Support**
   - Add `callbackUrl` parameter to request submission
   - Useful for workflow engines and async integrations

### Long-Term (Future)

1. **SSE for Browser Clients**
   - Server-Sent Events for dashboard/admin UIs
   - Lower overhead than WebSocket for one-way notifications

2. **Push Notifications**
   - Mobile push for urgent approvals
   - Integrate with FCM/APNs via existing notification infrastructure

## Conclusion

The existing architecture is well-designed for multi-channel notifications with webhook-based response capture. The main gaps are:

1. **SMS Correlation** - Needs phone-to-request mapping
2. **Real-time Client Updates** - Polling works but WebSocket would improve UX
3. **Long-Wait Efficiency** - DO hibernation + alarms are in place; client-side needs callback URL option

The recommended approach is incremental: keep polling as the default, add callback URLs for async workflows, and optionally introduce WebSocket for real-time UIs. The core DO-based architecture with Graph storage and alarm-based expiration is solid and should not change.
