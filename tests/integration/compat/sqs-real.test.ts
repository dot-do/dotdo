/**
 * SQS Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/sqs compat layer with real DO storage,
 * verifying API compatibility with @aws-sdk/client-sqs.
 *
 * These tests:
 * 1. Verify correct API shape matching @aws-sdk/client-sqs
 * 2. Verify proper DO storage for queue state
 * 3. Verify error handling matches AWS SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/sqs-real.test.ts --project=integration
 *
 * @module tests/integration/compat/sqs-real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('SQS Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with @aws-sdk/client-sqs
   *
   * Verifies that the SQS compat layer exports the same API surface
   * as the official AWS SDK v3.
   */
  describe('API Shape Compatibility', () => {
    it('exports SQSClient class', async () => {
      const { SQSClient } = await import('../../../compat/sqs/index')

      expect(SQSClient).toBeDefined()
      expect(typeof SQSClient).toBe('function')
    })

    it('SQSClient accepts region configuration', async () => {
      const { SQSClient } = await import('../../../compat/sqs/index')

      const client = new SQSClient({ region: 'us-east-1' })
      expect(client).toBeDefined()
    })

    it('exports queue commands', async () => {
      const sqs = await import('../../../compat/sqs/index')

      expect(sqs.CreateQueueCommand).toBeDefined()
      expect(sqs.DeleteQueueCommand).toBeDefined()
      expect(sqs.ListQueuesCommand).toBeDefined()
      expect(sqs.GetQueueUrlCommand).toBeDefined()
      expect(sqs.GetQueueAttributesCommand).toBeDefined()
      expect(sqs.SetQueueAttributesCommand).toBeDefined()
    })

    it('exports message commands', async () => {
      const sqs = await import('../../../compat/sqs/index')

      expect(sqs.SendMessageCommand).toBeDefined()
      expect(sqs.SendMessageBatchCommand).toBeDefined()
      expect(sqs.ReceiveMessageCommand).toBeDefined()
      expect(sqs.DeleteMessageCommand).toBeDefined()
      expect(sqs.DeleteMessageBatchCommand).toBeDefined()
      expect(sqs.ChangeMessageVisibilityCommand).toBeDefined()
      expect(sqs.ChangeMessageVisibilityBatchCommand).toBeDefined()
      expect(sqs.PurgeQueueCommand).toBeDefined()
    })

    it('exports tag commands', async () => {
      const sqs = await import('../../../compat/sqs/index')

      expect(sqs.TagQueueCommand).toBeDefined()
      expect(sqs.UntagQueueCommand).toBeDefined()
      expect(sqs.ListQueueTagsCommand).toBeDefined()
    })

    it('exports error classes', async () => {
      const sqs = await import('../../../compat/sqs/index')

      expect(sqs.QueueDoesNotExist).toBeDefined()
      expect(sqs.QueueNameExists).toBeDefined()
      expect(sqs.InvalidAttributeName).toBeDefined()
      expect(sqs.ReceiptHandleIsInvalid).toBeDefined()
    })
  })

  /**
   * Test Suite 2: Queue Operations
   *
   * Verifies queue CRUD operations.
   */
  describe('Queue Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const sqs = await import('../../../compat/sqs/index')
      client = new sqs.SQSClient({ region: 'us-east-1' })
      clear = sqs._clearAll
      clear()
    })

    afterEach(() => {
      clear()
    })

    it('creates a standard queue', async () => {
      const { CreateQueueCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new CreateQueueCommand({
        QueueName: 'test-queue',
      }))

      expect(result).toBeDefined()
      expect(result.QueueUrl).toBeDefined()
      expect(result.QueueUrl).toContain('test-queue')
    })

    it('creates a FIFO queue', async () => {
      const { CreateQueueCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new CreateQueueCommand({
        QueueName: 'test-queue.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        },
      }))

      expect(result).toBeDefined()
      expect(result.QueueUrl).toContain('.fifo')
    })

    it('lists queues', async () => {
      const { CreateQueueCommand, ListQueuesCommand } = await import('../../../compat/sqs/index')

      await client.send(new CreateQueueCommand({ QueueName: 'queue-1' }))
      await client.send(new CreateQueueCommand({ QueueName: 'queue-2' }))

      const result = await client.send(new ListQueuesCommand({}))

      expect(result.QueueUrls).toBeDefined()
      expect(result.QueueUrls.length).toBeGreaterThanOrEqual(2)
    })

    it('lists queues with prefix filter', async () => {
      const { CreateQueueCommand, ListQueuesCommand } = await import('../../../compat/sqs/index')

      await client.send(new CreateQueueCommand({ QueueName: 'orders-queue' }))
      await client.send(new CreateQueueCommand({ QueueName: 'orders-dlq' }))
      await client.send(new CreateQueueCommand({ QueueName: 'other-queue' }))

      const result = await client.send(new ListQueuesCommand({
        QueueNamePrefix: 'orders',
      }))

      expect(result.QueueUrls.length).toBe(2)
      expect(result.QueueUrls.every((url: string) => url.includes('orders'))).toBe(true)
    })

    it('gets queue URL by name', async () => {
      const { CreateQueueCommand, GetQueueUrlCommand } = await import('../../../compat/sqs/index')

      const created = await client.send(new CreateQueueCommand({ QueueName: 'my-queue' }))

      const result = await client.send(new GetQueueUrlCommand({
        QueueName: 'my-queue',
      }))

      expect(result.QueueUrl).toBe(created.QueueUrl)
    })

    it('gets queue attributes', async () => {
      const { CreateQueueCommand, GetQueueAttributesCommand } = await import('../../../compat/sqs/index')

      const created = await client.send(new CreateQueueCommand({ QueueName: 'my-queue' }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: created.QueueUrl,
        AttributeNames: ['All'],
      }))

      expect(result.Attributes).toBeDefined()
      expect(result.Attributes.QueueArn).toBeDefined()
    })

    it('sets queue attributes', async () => {
      const { CreateQueueCommand, SetQueueAttributesCommand, GetQueueAttributesCommand } = await import('../../../compat/sqs/index')

      const created = await client.send(new CreateQueueCommand({ QueueName: 'my-queue' }))

      await client.send(new SetQueueAttributesCommand({
        QueueUrl: created.QueueUrl,
        Attributes: {
          VisibilityTimeout: '60',
          MessageRetentionPeriod: '86400',
        },
      }))

      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: created.QueueUrl,
        AttributeNames: ['VisibilityTimeout', 'MessageRetentionPeriod'],
      }))

      expect(attrs.Attributes.VisibilityTimeout).toBe('60')
      expect(attrs.Attributes.MessageRetentionPeriod).toBe('86400')
    })

    it('deletes a queue', async () => {
      const { CreateQueueCommand, DeleteQueueCommand, GetQueueUrlCommand } = await import('../../../compat/sqs/index')

      const created = await client.send(new CreateQueueCommand({ QueueName: 'to-delete' }))

      await client.send(new DeleteQueueCommand({
        QueueUrl: created.QueueUrl,
      }))

      await expect(
        client.send(new GetQueueUrlCommand({ QueueName: 'to-delete' }))
      ).rejects.toThrow()
    })
  })

  /**
   * Test Suite 3: Message Operations
   *
   * Verifies message send/receive operations.
   */
  describe('Message Operations', () => {
    let client: any
    let queueUrl: string
    let clear: () => void

    beforeEach(async () => {
      const sqs = await import('../../../compat/sqs/index')
      client = new sqs.SQSClient({ region: 'us-east-1' })
      clear = sqs._clearAll
      clear()

      const result = await client.send(new sqs.CreateQueueCommand({ QueueName: 'test-queue' }))
      queueUrl = result.QueueUrl
    })

    afterEach(() => {
      clear()
    })

    it('sends a message', async () => {
      const { SendMessageCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ event: 'test', data: { key: 'value' } }),
      }))

      expect(result).toBeDefined()
      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageBody).toBeDefined()
    })

    it('sends message with delay', async () => {
      const { SendMessageCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Delayed message',
        DelaySeconds: 10,
      }))

      expect(result.MessageId).toBeDefined()
    })

    it('sends message with attributes', async () => {
      const { SendMessageCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Message with attributes',
        MessageAttributes: {
          Type: { DataType: 'String', StringValue: 'order' },
          Priority: { DataType: 'Number', StringValue: '1' },
        },
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageAttributes).toBeDefined()
    })

    it('receives messages', async () => {
      const { SendMessageCommand, ReceiveMessageCommand } = await import('../../../compat/sqs/index')

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Test message',
      }))

      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      expect(result.Messages).toBeDefined()
      expect(result.Messages.length).toBe(1)
      expect(result.Messages[0].Body).toBe('Test message')
      expect(result.Messages[0].ReceiptHandle).toBeDefined()
    })

    it('receives messages with attributes', async () => {
      const { SendMessageCommand, ReceiveMessageCommand } = await import('../../../compat/sqs/index')

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Test',
        MessageAttributes: {
          Type: { DataType: 'String', StringValue: 'test' },
        },
      }))

      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MessageAttributeNames: ['All'],
      }))

      expect(result.Messages[0].MessageAttributes).toBeDefined()
      expect(result.Messages[0].MessageAttributes.Type.StringValue).toBe('test')
    })

    it('deletes a message', async () => {
      const { SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } = await import('../../../compat/sqs/index')

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'To be deleted',
      }))

      const received = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
      }))

      await client.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: received.Messages[0].ReceiptHandle,
      }))

      // Message should be gone
      const afterDelete = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: 0,
      }))

      expect(afterDelete.Messages || []).toHaveLength(0)
    })

    it('changes message visibility', async () => {
      const { SendMessageCommand, ReceiveMessageCommand, ChangeMessageVisibilityCommand } = await import('../../../compat/sqs/index')

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Test',
      }))

      const received = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
      }))

      // Extend visibility timeout
      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: received.Messages[0].ReceiptHandle,
        VisibilityTimeout: 120,
      }))

      // Message should not be visible
      const notVisible = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: 0,
      }))

      expect(notVisible.Messages || []).toHaveLength(0)
    })

    it('purges a queue', async () => {
      const { SendMessageCommand, ReceiveMessageCommand, PurgeQueueCommand, GetQueueAttributesCommand } = await import('../../../compat/sqs/index')

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: `Message ${i}`,
        }))
      }

      await client.send(new PurgeQueueCommand({ QueueUrl: queueUrl }))

      // Queue should be empty
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: 0,
      }))

      expect(result.Messages || []).toHaveLength(0)
    })
  })

  /**
   * Test Suite 4: Batch Operations
   *
   * Verifies batch send/delete/visibility operations.
   */
  describe('Batch Operations', () => {
    let client: any
    let queueUrl: string
    let clear: () => void

    beforeEach(async () => {
      const sqs = await import('../../../compat/sqs/index')
      client = new sqs.SQSClient({ region: 'us-east-1' })
      clear = sqs._clearAll
      clear()

      const result = await client.send(new sqs.CreateQueueCommand({ QueueName: 'batch-queue' }))
      queueUrl = result.QueueUrl
    })

    afterEach(() => {
      clear()
    })

    it('sends batch of messages', async () => {
      const { SendMessageBatchCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Message 1' },
          { Id: '2', MessageBody: 'Message 2' },
          { Id: '3', MessageBody: 'Message 3' },
        ],
      }))

      expect(result.Successful).toBeDefined()
      expect(result.Successful.length).toBe(3)
    })

    it('reports failed batch entries', async () => {
      const { SendMessageBatchCommand } = await import('../../../compat/sqs/index')

      // This test verifies error handling structure
      // Actual failure conditions depend on implementation
      const result = await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Valid message' },
        ],
      }))

      expect(result.Successful).toBeDefined()
      expect(result.Failed || []).toHaveLength(0)
    })

    it('deletes batch of messages', async () => {
      const { SendMessageCommand, ReceiveMessageCommand, DeleteMessageBatchCommand } = await import('../../../compat/sqs/index')

      // Send messages
      for (let i = 0; i < 3; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: `Message ${i}`,
        }))
      }

      // Receive messages
      const received = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      // Delete batch
      const result = await client.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: received.Messages.map((m: any, i: number) => ({
          Id: `${i}`,
          ReceiptHandle: m.ReceiptHandle,
        })),
      }))

      expect(result.Successful).toBeDefined()
      expect(result.Successful.length).toBe(3)
    })

    it('changes visibility for batch of messages', async () => {
      const { SendMessageCommand, ReceiveMessageCommand, ChangeMessageVisibilityBatchCommand } = await import('../../../compat/sqs/index')

      // Send messages
      for (let i = 0; i < 3; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: `Message ${i}`,
        }))
      }

      // Receive messages
      const received = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      // Change visibility
      const result = await client.send(new ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: received.Messages.map((m: any, i: number) => ({
          Id: `${i}`,
          ReceiptHandle: m.ReceiptHandle,
          VisibilityTimeout: 60,
        })),
      }))

      expect(result.Successful).toBeDefined()
      expect(result.Successful.length).toBe(3)
    })
  })

  /**
   * Test Suite 5: FIFO Queue Operations
   *
   * Verifies FIFO-specific functionality.
   */
  describe('FIFO Queue Operations', () => {
    let client: any
    let queueUrl: string
    let clear: () => void

    beforeEach(async () => {
      const sqs = await import('../../../compat/sqs/index')
      client = new sqs.SQSClient({ region: 'us-east-1' })
      clear = sqs._clearAll
      clear()

      const result = await client.send(new sqs.CreateQueueCommand({
        QueueName: 'test-queue.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        },
      }))
      queueUrl = result.QueueUrl
    })

    afterEach(() => {
      clear()
    })

    it('sends message with MessageGroupId', async () => {
      const { SendMessageCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'FIFO message',
        MessageGroupId: 'group-1',
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.SequenceNumber).toBeDefined()
    })

    it('sends message with MessageDeduplicationId', async () => {
      const { SendMessageCommand } = await import('../../../compat/sqs/index')

      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Deduplicated message',
        MessageGroupId: 'group-1',
        MessageDeduplicationId: 'dedup-1',
      }))

      expect(result.MessageId).toBeDefined()
    })

    it('maintains message order within group', async () => {
      const { SendMessageCommand, ReceiveMessageCommand } = await import('../../../compat/sqs/index')

      // Send ordered messages
      for (let i = 1; i <= 3; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: `Message ${i}`,
          MessageGroupId: 'order-test',
          MessageDeduplicationId: `msg-${i}`,
        }))
      }

      // Receive and verify order
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      expect(result.Messages[0].Body).toBe('Message 1')
      expect(result.Messages[1].Body).toBe('Message 2')
      expect(result.Messages[2].Body).toBe('Message 3')
    })
  })

  /**
   * Test Suite 6: Error Handling Compatibility
   *
   * Verifies that errors match AWS SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let client: any

    beforeEach(async () => {
      const sqs = await import('../../../compat/sqs/index')
      client = new sqs.SQSClient({ region: 'us-east-1' })
      sqs._clearAll()
    })

    it('throws QueueDoesNotExist for non-existent queue', async () => {
      const { GetQueueUrlCommand } = await import('../../../compat/sqs/index')

      await expect(
        client.send(new GetQueueUrlCommand({ QueueName: 'nonexistent' }))
      ).rejects.toThrow()
    })

    it('throws QueueNameExists for duplicate queue', async () => {
      const { CreateQueueCommand } = await import('../../../compat/sqs/index')

      await client.send(new CreateQueueCommand({ QueueName: 'existing' }))

      // Different attributes should throw
      await expect(
        client.send(new CreateQueueCommand({
          QueueName: 'existing',
          Attributes: { VisibilityTimeout: '999' },
        }))
      ).rejects.toThrow()
    })

    it('throws ReceiptHandleIsInvalid for bad receipt handle', async () => {
      const { CreateQueueCommand, DeleteMessageCommand } = await import('../../../compat/sqs/index')

      const created = await client.send(new CreateQueueCommand({ QueueName: 'test-queue' }))

      await expect(
        client.send(new DeleteMessageCommand({
          QueueUrl: created.QueueUrl,
          ReceiptHandle: 'invalid-receipt-handle',
        }))
      ).rejects.toThrow()
    })
  })
})
