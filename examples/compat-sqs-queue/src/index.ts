/**
 * compat-sqs-queue - AWS SQS-compatible queue processing on Durable Objects
 *
 * Drop-in replacement for @aws-sdk/client-sqs that runs on Cloudflare Workers.
 * No AWS account required. No per-message fees. Pay only for compute.
 *
 * Features:
 * - Full SQS SDK v3 compatibility
 * - Visibility timeout and message locking
 * - Batch send/delete/visibility operations
 * - Exponential backoff retries
 * - Dead letter queue support
 * - FIFO queue ordering
 * - Long polling
 *
 * @example
 * ```typescript
 * // Queue a job
 * POST /jobs
 * { "type": "email", "payload": { "to": "user@example.com" } }
 *
 * // Receive pending jobs
 * GET /jobs?max=10
 *
 * // Mark job complete
 * DELETE /jobs/:receiptHandle
 *
 * // View queue stats
 * GET /stats
 * ```
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { QueueDO, type Job } from './QueueDO'
import { DLQDO, type DeadLetter } from './DLQDO'
import { FifoQueueDO } from './objects/FifoQueueDO'

// Re-export all DOs for Wrangler
export { QueueDO, DLQDO, FifoQueueDO }

// Types
interface Env {
  QUEUE_DO: DurableObjectNamespace
  DLQ_DO: DurableObjectNamespace
  FIFO_DO: DurableObjectNamespace
  ENVIRONMENT?: string
  DEFAULT_VISIBILITY_TIMEOUT?: string
  MAX_RECEIVE_COUNT?: string
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', cors())

// ===========================================================================
// Job Endpoints
// ===========================================================================

/**
 * Queue a new job
 *
 * POST /jobs
 * { "type": "email", "payload": { "to": "user@example.com" } }
 */
app.post('/jobs', async (c) => {
  const { type, payload, priority } = await c.req.json<{
    type: Job['type']
    payload: Record<string, unknown>
    priority?: number
  }>()

  if (!type || !payload) {
    return c.json({ error: 'type and payload are required' }, 400)
  }

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const result = await stub.queueJob({ type, payload, priority })

  return c.json({
    success: true,
    messageId: result.messageId,
    job: result.job,
  }, 201)
})

/**
 * Queue multiple jobs in a batch
 *
 * POST /jobs/batch
 * { "jobs": [{ "type": "email", "payload": { ... } }, ...] }
 */
app.post('/jobs/batch', async (c) => {
  const { jobs } = await c.req.json<{
    jobs: Array<{
      type: Job['type']
      payload: Record<string, unknown>
      priority?: number
    }>
  }>()

  if (!jobs || !Array.isArray(jobs)) {
    return c.json({ error: 'jobs array is required' }, 400)
  }

  if (jobs.length > 10) {
    return c.json({ error: 'Maximum 10 jobs per batch' }, 400)
  }

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const result = await stub.queueJobBatch(jobs)

  return c.json({
    success: true,
    successful: result.successful,
    failed: result.failed,
  }, 201)
})

/**
 * Receive pending jobs
 *
 * GET /jobs?max=10&visibility=30&wait=0
 */
app.get('/jobs', async (c) => {
  const maxMessages = parseInt(c.req.query('max') ?? '10')
  const visibilityTimeout = parseInt(c.req.query('visibility') ?? '30')
  const waitTimeSeconds = parseInt(c.req.query('wait') ?? '0')

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const jobs = await stub.receiveJobs({
    maxMessages,
    visibilityTimeout,
    waitTimeSeconds,
  })

  return c.json({
    count: jobs.length,
    jobs: jobs.map(({ message, job }) => ({
      receiptHandle: message.ReceiptHandle,
      messageId: message.MessageId,
      receiveCount: message.Attributes?.ApproximateReceiveCount,
      job,
    })),
  })
})

/**
 * Complete a job (delete from queue)
 *
 * DELETE /jobs/:receiptHandle
 */
app.delete('/jobs/:receiptHandle', async (c) => {
  const receiptHandle = decodeURIComponent(c.req.param('receiptHandle'))

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  try {
    await stub.completeJob(receiptHandle)
    return c.json({ success: true })
  } catch (error) {
    return c.json({
      error: 'Invalid receipt handle or message already deleted',
    }, 400)
  }
})

/**
 * Complete multiple jobs in a batch
 *
 * POST /jobs/complete
 * { "receiptHandles": ["handle1", "handle2", ...] }
 */
app.post('/jobs/complete', async (c) => {
  const { receiptHandles } = await c.req.json<{
    receiptHandles: string[]
  }>()

  if (!receiptHandles || !Array.isArray(receiptHandles)) {
    return c.json({ error: 'receiptHandles array is required' }, 400)
  }

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const result = await stub.completeJobBatch(receiptHandles)

  return c.json({
    success: true,
    successful: result.successful,
    failed: result.failed,
  })
})

/**
 * Extend visibility timeout for a job
 *
 * POST /jobs/:receiptHandle/extend
 * { "seconds": 60 }
 */
app.post('/jobs/:receiptHandle/extend', async (c) => {
  const receiptHandle = decodeURIComponent(c.req.param('receiptHandle'))
  const { seconds } = await c.req.json<{ seconds: number }>()

  if (!seconds || seconds < 0 || seconds > 43200) {
    return c.json({ error: 'seconds must be between 0 and 43200' }, 400)
  }

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  try {
    await stub.extendVisibility(receiptHandle, seconds)
    return c.json({ success: true, newTimeout: seconds })
  } catch (error) {
    return c.json({
      error: 'Invalid receipt handle or message not in flight',
    }, 400)
  }
})

// ===========================================================================
// FIFO Queue Endpoints
// ===========================================================================

/**
 * Send a FIFO message with ordering guarantee
 *
 * POST /fifo/:groupId
 * { "body": { ... }, "deduplicationId": "optional-dedup-key" }
 */
app.post('/fifo/:groupId', async (c) => {
  const groupId = c.req.param('groupId')
  const { body, deduplicationId } = await c.req.json<{
    body: unknown
    deduplicationId?: string
  }>()

  if (!body) {
    return c.json({ error: 'body is required' }, 400)
  }

  const id = c.env.FIFO_DO.idFromName('default')
  const stub = c.env.FIFO_DO.get(id) as unknown as FifoQueueDO

  const result = await stub.send(groupId, body, { deduplicationId })

  return c.json({
    success: true,
    message: result,
  }, 201)
})

/**
 * Send batch of FIFO messages
 *
 * POST /fifo/batch
 * { "messages": [{ "groupId": "group-1", "body": {...} }, ...] }
 */
app.post('/fifo/batch', async (c) => {
  const { messages } = await c.req.json<{
    messages: Array<{
      groupId: string
      body: unknown
      deduplicationId?: string
    }>
  }>()

  if (!messages || !Array.isArray(messages)) {
    return c.json({ error: 'messages array is required' }, 400)
  }

  if (messages.length > 10) {
    return c.json({ error: 'Maximum 10 messages per batch' }, 400)
  }

  const id = c.env.FIFO_DO.idFromName('default')
  const stub = c.env.FIFO_DO.get(id) as unknown as FifoQueueDO

  const result = await stub.sendBatch(messages)

  return c.json({
    success: true,
    successful: result.successful,
    failed: result.failed,
  }, 201)
})

/**
 * Receive FIFO messages (ordered per message group)
 *
 * GET /fifo?max=10&visibility=30
 */
app.get('/fifo', async (c) => {
  const maxMessages = parseInt(c.req.query('max') ?? '10')
  const visibilityTimeout = parseInt(c.req.query('visibility') ?? '30')

  const id = c.env.FIFO_DO.idFromName('default')
  const stub = c.env.FIFO_DO.get(id) as unknown as FifoQueueDO

  const messages = await stub.receive({
    maxMessages,
    visibilityTimeout,
  })

  return c.json({
    count: messages.length,
    messages: messages.map(({ message, fifoMessage }) => ({
      receiptHandle: message.ReceiptHandle,
      messageId: fifoMessage.id,
      sequenceNumber: fifoMessage.sequenceNumber,
      groupId: fifoMessage.messageGroupId,
      body: fifoMessage.body,
      sentAt: fifoMessage.sentAt,
    })),
  })
})

/**
 * Complete (delete) a FIFO message
 *
 * DELETE /fifo/:receiptHandle
 */
app.delete('/fifo/:receiptHandle', async (c) => {
  const receiptHandle = decodeURIComponent(c.req.param('receiptHandle'))

  const id = c.env.FIFO_DO.idFromName('default')
  const stub = c.env.FIFO_DO.get(id) as unknown as FifoQueueDO

  try {
    await stub.complete(receiptHandle)
    return c.json({ success: true })
  } catch (error) {
    return c.json({
      error: 'Invalid receipt handle or message already deleted',
    }, 400)
  }
})

/**
 * Get FIFO queue statistics
 *
 * GET /fifo/stats
 */
app.get('/fifo/stats', async (c) => {
  const id = c.env.FIFO_DO.idFromName('default')
  const stub = c.env.FIFO_DO.get(id) as unknown as FifoQueueDO

  const stats = await stub.getStats()

  return c.json({
    queue: 'fifo-queue.fifo',
    ...stats,
    total: stats.approximateMessages + stats.approximateMessagesNotVisible + stats.approximateMessagesDelayed,
  })
})

// ===========================================================================
// Dead Letter Queue Endpoints (Dedicated DLQDO)
// ===========================================================================

/**
 * View failed jobs in the dead letter queue
 *
 * GET /dlq/:sourceQueue?max=10
 */
app.get('/dlq/:sourceQueue', async (c) => {
  const sourceQueue = c.req.param('sourceQueue')
  const maxMessages = parseInt(c.req.query('max') ?? '10')

  const id = c.env.DLQ_DO.idFromName('default')
  const stub = c.env.DLQ_DO.get(id) as unknown as DLQDO

  const deadLetters = await stub.receiveDeadLetters(sourceQueue, { maxMessages })

  return c.json({
    count: deadLetters.length,
    sourceQueue,
    deadLetters: deadLetters.map(({ message, deadLetter }) => ({
      receiptHandle: message.ReceiptHandle,
      messageId: message.MessageId,
      deadLetter,
    })),
  })
})

/**
 * Get DLQ statistics
 *
 * GET /dlq/:sourceQueue/stats
 */
app.get('/dlq/:sourceQueue/stats', async (c) => {
  const sourceQueue = c.req.param('sourceQueue')

  const id = c.env.DLQ_DO.idFromName('default')
  const stub = c.env.DLQ_DO.get(id) as unknown as DLQDO

  const stats = await stub.getStats(sourceQueue)

  return c.json({
    sourceQueue,
    ...stats,
  })
})

/**
 * Reprocess a dead letter
 *
 * POST /dlq/:sourceQueue/:receiptHandle/reprocess
 * { "targetQueue": "optional-target" }
 */
app.post('/dlq/:sourceQueue/:receiptHandle/reprocess', async (c) => {
  const sourceQueue = c.req.param('sourceQueue')
  const receiptHandle = decodeURIComponent(c.req.param('receiptHandle'))
  const { deadLetter, targetQueue } = await c.req.json<{
    deadLetter: DeadLetter
    targetQueue?: string
  }>()

  if (!deadLetter) {
    return c.json({ error: 'deadLetter is required' }, 400)
  }

  const id = c.env.DLQ_DO.idFromName('default')
  const stub = c.env.DLQ_DO.get(id) as unknown as DLQDO

  try {
    const result = await stub.reprocess(sourceQueue, receiptHandle, deadLetter, { targetQueue })
    return c.json({ success: true, ...result })
  } catch (error) {
    return c.json({ error: 'Failed to reprocess dead letter' }, 400)
  }
})

/**
 * Bulk reprocess dead letters
 *
 * POST /dlq/:sourceQueue/bulk-reprocess
 * { "reasonPattern": "timeout", "limit": 50 }
 */
app.post('/dlq/:sourceQueue/bulk-reprocess', async (c) => {
  const sourceQueue = c.req.param('sourceQueue')
  const { reasonPattern, failedAfter, failedBefore, limit, targetQueue } = await c.req.json<{
    reasonPattern?: string
    failedAfter?: string
    failedBefore?: string
    limit?: number
    targetQueue?: string
  }>()

  const id = c.env.DLQ_DO.idFromName('default')
  const stub = c.env.DLQ_DO.get(id) as unknown as DLQDO

  const result = await stub.bulkReprocess(sourceQueue, {
    reasonPattern,
    failedAfter,
    failedBefore,
    limit,
    targetQueue,
  })

  return c.json({ success: true, ...result })
})

/**
 * Purge dead letters for a source queue
 *
 * DELETE /dlq/:sourceQueue
 */
app.delete('/dlq/:sourceQueue', async (c) => {
  const sourceQueue = c.req.param('sourceQueue')

  const id = c.env.DLQ_DO.idFromName('default')
  const stub = c.env.DLQ_DO.get(id) as unknown as DLQDO

  await stub.purge(sourceQueue)

  return c.json({ success: true, message: `Dead letter queue for ${sourceQueue} purged` })
})

// ===========================================================================
// Legacy Dead Letter Queue Endpoints (QueueDO embedded DLQ)
// ===========================================================================

/**
 * View failed jobs in the dead letter queue
 *
 * GET /dlq?max=10
 */
app.get('/dlq', async (c) => {
  const maxMessages = parseInt(c.req.query('max') ?? '10')

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const deadLetters = await stub.receiveDeadLetters(maxMessages)

  return c.json({
    count: deadLetters.length,
    deadLetters: deadLetters.map(({ message, job }) => ({
      receiptHandle: message.ReceiptHandle,
      messageId: message.MessageId,
      job,
    })),
  })
})

/**
 * Reprocess a dead letter (move back to main queue)
 *
 * POST /dlq/:receiptHandle/reprocess
 */
app.post('/dlq/:receiptHandle/reprocess', async (c) => {
  const receiptHandle = decodeURIComponent(c.req.param('receiptHandle'))
  const { messageBody } = await c.req.json<{ messageBody: string }>()

  if (!messageBody) {
    return c.json({ error: 'messageBody is required' }, 400)
  }

  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  try {
    const newMessageId = await stub.reprocessDeadLetter(receiptHandle, messageBody)
    return c.json({ success: true, newMessageId })
  } catch (error) {
    return c.json({ error: 'Failed to reprocess dead letter' }, 400)
  }
})

/**
 * Purge all dead letters
 *
 * DELETE /dlq
 */
app.delete('/dlq', async (c) => {
  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  await stub.purgeDeadLetters()

  return c.json({ success: true, message: 'Dead letter queue purged' })
})

// ===========================================================================
// Stats and Admin Endpoints
// ===========================================================================

/**
 * Get queue statistics
 *
 * GET /stats
 */
app.get('/stats', async (c) => {
  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  const stats = await stub.getStats()

  return c.json({
    queue: 'jobs',
    ...stats,
    total: stats.pending + stats.inFlight + stats.delayed,
  })
})

/**
 * Purge all messages from the queue
 *
 * DELETE /queue
 */
app.delete('/queue', async (c) => {
  const id = c.env.QUEUE_DO.idFromName('default')
  const stub = c.env.QUEUE_DO.get(id) as unknown as QueueDO

  await stub.purgeQueue()

  return c.json({ success: true, message: 'Queue purged' })
})

/**
 * Health check
 *
 * GET /health
 */
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    environment: c.env.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  })
})

/**
 * API documentation
 *
 * GET /
 */
app.get('/', (c) => {
  return c.json({
    name: 'compat-sqs-queue',
    description: 'AWS SQS-compatible queue processing on Durable Objects',
    endpoints: {
      // Standard Queue
      'POST /jobs': 'Queue a new job',
      'POST /jobs/batch': 'Queue multiple jobs',
      'GET /jobs': 'Receive pending jobs',
      'DELETE /jobs/:receiptHandle': 'Complete a job',
      'POST /jobs/complete': 'Complete multiple jobs',
      'POST /jobs/:receiptHandle/extend': 'Extend visibility timeout',

      // FIFO Queue
      'POST /fifo/:groupId': 'Send ordered message to group',
      'POST /fifo/batch': 'Send batch of ordered messages',
      'GET /fifo': 'Receive FIFO messages (ordered per group)',
      'DELETE /fifo/:receiptHandle': 'Complete FIFO message',
      'GET /fifo/stats': 'FIFO queue statistics',

      // Dedicated Dead Letter Queue
      'GET /dlq/:sourceQueue': 'View DLQ for source queue',
      'GET /dlq/:sourceQueue/stats': 'DLQ statistics',
      'POST /dlq/:sourceQueue/:receiptHandle/reprocess': 'Reprocess dead letter',
      'POST /dlq/:sourceQueue/bulk-reprocess': 'Bulk reprocess with filters',
      'DELETE /dlq/:sourceQueue': 'Purge DLQ for source queue',

      // Legacy DLQ (embedded in QueueDO)
      'GET /dlq': 'View legacy dead letter queue',
      'POST /dlq/:receiptHandle/reprocess': 'Reprocess legacy dead letter',
      'DELETE /dlq': 'Purge legacy dead letters',

      // Admin
      'GET /stats': 'Queue statistics',
      'DELETE /queue': 'Purge entire queue',
      'GET /health': 'Health check',
    },
    documentation: 'https://github.com/drivly/dotdo/tree/main/examples/compat-sqs-queue',
  })
})

export default app
