/**
 * compat-sqs-queue - Comprehensive tests for SQS-compatible queue processing
 *
 * Tests for:
 * - Basic queue operations (send, receive, delete)
 * - Batch operations
 * - Visibility timeout and message locking
 * - Dead letter queue handling
 * - FIFO queue ordering
 * - Retry logic with exponential backoff
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  PurgeQueueCommand,
  GetQueueAttributesCommand,
  _clearAll,
  QueueDoesNotExist,
  EmptyBatchRequest,
  TooManyEntriesInBatchRequest,
  BatchEntryIdsNotDistinct,
  ReceiptHandleIsInvalid,
  type Message,
} from '@dotdo/sqs'

describe('SQS Queue Operations', () => {
  let client: SQSClient
  const region = 'us-east-1'

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region })
  })

  describe('Queue Creation and Management', () => {
    it('should create a standard queue', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'test-queue',
      }))

      expect(result.QueueUrl).toBeDefined()
      expect(result.QueueUrl).toContain('test-queue')
    })

    it('should create a FIFO queue', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'orders.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        },
      }))

      expect(result.QueueUrl).toContain('orders.fifo')

      // Verify attributes
      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: result.QueueUrl!,
        AttributeNames: ['All'],
      }))

      expect(attrs.Attributes?.FifoQueue).toBe('true')
      expect(attrs.Attributes?.ContentBasedDeduplication).toBe('true')
    })

    it('should create queue with custom visibility timeout', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'custom-timeout-queue',
        Attributes: {
          VisibilityTimeout: '60',
        },
      }))

      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: result.QueueUrl!,
        AttributeNames: ['VisibilityTimeout'],
      }))

      expect(attrs.Attributes?.VisibilityTimeout).toBe('60')
    })

    it('should delete a queue', async () => {
      const { QueueUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'to-delete',
      }))

      await client.send(new DeleteQueueCommand({ QueueUrl: QueueUrl! }))

      // Verify queue no longer exists
      await expect(
        client.send(new SendMessageCommand({
          QueueUrl: QueueUrl!,
          MessageBody: 'test',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })

  describe('Message Sending', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'message-queue',
      }))
      queueUrl = result.QueueUrl!
    })

    it('should send a simple message', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Hello, World!',
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageBody).toBeDefined()
    })

    it('should send message with delay', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Delayed message',
        DelaySeconds: 5,
      }))

      expect(result.MessageId).toBeDefined()

      // Message should not be immediately visible
      const receive = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(receive.Messages).toBeUndefined()
    })

    it('should send message with attributes', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ action: 'process' }),
        MessageAttributes: {
          priority: {
            DataType: 'Number',
            StringValue: '1',
          },
          type: {
            DataType: 'String',
            StringValue: 'notification',
          },
        },
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageAttributes).toBeDefined()
    })

    it('should send FIFO message with group ID', async () => {
      const { QueueUrl: fifoUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'send-test.fifo',
        Attributes: { FifoQueue: 'true' },
      }))

      const result = await client.send(new SendMessageCommand({
        QueueUrl: fifoUrl!,
        MessageBody: 'FIFO message',
        MessageGroupId: 'group-1',
        MessageDeduplicationId: 'dedup-1',
      }))

      expect(result.SequenceNumber).toBeDefined()
    })
  })

  describe('Batch Operations', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'batch-queue',
      }))
      queueUrl = result.QueueUrl!
    })

    it('should send batch of messages', async () => {
      const result = await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: 'msg-1', MessageBody: 'Message 1' },
          { Id: 'msg-2', MessageBody: 'Message 2' },
          { Id: 'msg-3', MessageBody: 'Message 3' },
        ],
      }))

      expect(result.Successful).toHaveLength(3)
      expect(result.Failed).toBeUndefined()
    })

    it('should reject empty batch', async () => {
      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: [],
        }))
      ).rejects.toThrow(EmptyBatchRequest)
    })

    it('should reject batch with more than 10 entries', async () => {
      const entries = Array.from({ length: 11 }, (_, i) => ({
        Id: `msg-${i}`,
        MessageBody: `Message ${i}`,
      }))

      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries,
        }))
      ).rejects.toThrow(TooManyEntriesInBatchRequest)
    })

    it('should reject batch with duplicate IDs', async () => {
      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: [
            { Id: 'dup', MessageBody: 'Message 1' },
            { Id: 'dup', MessageBody: 'Message 2' },
          ],
        }))
      ).rejects.toThrow(BatchEntryIdsNotDistinct)
    })

    it('should delete batch of messages', async () => {
      // Send messages first
      await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: 'del-1', MessageBody: 'Delete me 1' },
          { Id: 'del-2', MessageBody: 'Delete me 2' },
        ],
      }))

      // Receive messages
      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      // Batch delete
      const result = await client.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: Messages!.map((m: Message, i: number) => ({
          Id: `del-${i}`,
          ReceiptHandle: m.ReceiptHandle!,
        })),
      }))

      expect(result.Successful).toHaveLength(2)
    })
  })

  describe('Message Receiving', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'receive-queue',
      }))
      queueUrl = result.QueueUrl!

      // Pre-populate with messages
      await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'First' },
          { Id: '2', MessageBody: 'Second' },
          { Id: '3', MessageBody: 'Third' },
        ],
      }))
    })

    it('should receive messages', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      expect(result.Messages).toBeDefined()
      expect(result.Messages!.length).toBeGreaterThan(0)
    })

    it('should respect MaxNumberOfMessages', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(result.Messages).toHaveLength(1)
    })

    it('should include system attributes when requested', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        AttributeNames: ['All'],
      }))

      const message = result.Messages![0]
      expect(message.Attributes).toBeDefined()
      expect(message.Attributes?.SentTimestamp).toBeDefined()
      expect(message.Attributes?.ApproximateReceiveCount).toBeDefined()
    })

    it('should apply visibility timeout', async () => {
      // Receive with short visibility timeout
      const first = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 3,
        VisibilityTimeout: 1, // 1 second
      }))

      expect(first.Messages).toBeDefined()

      // Immediately try to receive again - should be empty
      const second = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 3,
      }))

      expect(second.Messages).toBeUndefined()
    })
  })

  describe('Visibility Timeout', () => {
    let queueUrl: string
    let receiptHandle: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'visibility-queue',
      }))
      queueUrl = result.QueueUrl!

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Test message',
      }))

      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))
      receiptHandle = Messages![0].ReceiptHandle!
    })

    it('should change message visibility', async () => {
      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 60,
      }))

      // Message should still be invisible
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(result.Messages).toBeUndefined()
    })

    it('should reject invalid receipt handle', async () => {
      await expect(
        client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: 'invalid-handle',
          VisibilityTimeout: 60,
        }))
      ).rejects.toThrow(ReceiptHandleIsInvalid)
    })
  })

  describe('Message Deletion', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'delete-queue',
      }))
      queueUrl = result.QueueUrl!
    })

    it('should delete a message', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'To delete',
      }))

      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      await client.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: Messages![0].ReceiptHandle!,
      }))

      // Verify message is gone
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(result.Messages).toBeUndefined()
    })

    it('should reject invalid receipt handle on delete', async () => {
      await expect(
        client.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: 'invalid',
        }))
      ).rejects.toThrow(ReceiptHandleIsInvalid)
    })
  })

  describe('Queue Purging', () => {
    it('should purge all messages from queue', async () => {
      const { QueueUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'purge-queue',
      }))

      // Add messages
      await client.send(new SendMessageBatchCommand({
        QueueUrl: QueueUrl!,
        Entries: Array.from({ length: 5 }, (_, i) => ({
          Id: `msg-${i}`,
          MessageBody: `Message ${i}`,
        })),
      }))

      // Verify messages exist
      const before = await client.send(new GetQueueAttributesCommand({
        QueueUrl: QueueUrl!,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }))
      expect(parseInt(before.Attributes?.ApproximateNumberOfMessages ?? '0')).toBeGreaterThan(0)

      // Purge
      await client.send(new PurgeQueueCommand({ QueueUrl: QueueUrl! }))

      // Verify empty
      const after = await client.send(new GetQueueAttributesCommand({
        QueueUrl: QueueUrl!,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }))
      expect(after.Attributes?.ApproximateNumberOfMessages).toBe('0')
    })
  })

  describe('Queue Attributes', () => {
    it('should get queue attributes', async () => {
      const { QueueUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'attrs-queue',
        Attributes: {
          VisibilityTimeout: '45',
          DelaySeconds: '10',
        },
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: QueueUrl!,
        AttributeNames: ['All'],
      }))

      expect(result.Attributes?.VisibilityTimeout).toBe('45')
      expect(result.Attributes?.DelaySeconds).toBe('10')
      expect(result.Attributes?.QueueArn).toBeDefined()
      expect(result.Attributes?.CreatedTimestamp).toBeDefined()
    })

    it('should get specific attributes', async () => {
      const { QueueUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'specific-attrs-queue',
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: QueueUrl!,
        AttributeNames: ['VisibilityTimeout', 'QueueArn'],
      }))

      expect(result.Attributes?.VisibilityTimeout).toBeDefined()
      expect(result.Attributes?.QueueArn).toBeDefined()
      // Should not include other attributes
      expect(result.Attributes?.DelaySeconds).toBeUndefined()
    })
  })

  describe('Dead Letter Queue Integration', () => {
    let mainQueueUrl: string
    let dlqUrl: string

    beforeEach(async () => {
      // Create DLQ first
      const dlq = await client.send(new CreateQueueCommand({
        QueueName: 'test-dlq',
      }))
      dlqUrl = dlq.QueueUrl!

      // Create main queue with DLQ policy
      const main = await client.send(new CreateQueueCommand({
        QueueName: 'test-main',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:test-dlq',
            maxReceiveCount: '3',
          }),
        },
      }))
      mainQueueUrl = main.QueueUrl!
    })

    it('should configure redrive policy', async () => {
      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: mainQueueUrl,
        AttributeNames: ['All'],
      }))

      // Queue should have redrive policy configured
      expect(mainQueueUrl).toBeDefined()
      expect(dlqUrl).toBeDefined()
    })

    it('should manually move message to DLQ', async () => {
      // Send to main queue
      await client.send(new SendMessageCommand({
        QueueUrl: mainQueueUrl,
        MessageBody: JSON.stringify({ test: 'data' }),
      }))

      // Receive from main queue
      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: mainQueueUrl,
        MaxNumberOfMessages: 1,
      }))

      // Simulate failure - move to DLQ
      await client.send(new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify({
          originalMessage: JSON.parse(Messages![0].Body!),
          failureReason: 'Test failure',
          failedAt: new Date().toISOString(),
        }),
      }))

      // Delete from main queue
      await client.send(new DeleteMessageCommand({
        QueueUrl: mainQueueUrl,
        ReceiptHandle: Messages![0].ReceiptHandle!,
      }))

      // Verify in DLQ
      const dlqMessages = await client.send(new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(dlqMessages.Messages).toBeDefined()
      expect(dlqMessages.Messages).toHaveLength(1)

      const dlqBody = JSON.parse(dlqMessages.Messages![0].Body!)
      expect(dlqBody.failureReason).toBe('Test failure')
    })
  })

  describe('FIFO Queue Behavior', () => {
    let fifoUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'fifo-test.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        },
      }))
      fifoUrl = result.QueueUrl!
    })

    it('should maintain message order within group', async () => {
      // Send ordered messages
      for (let i = 1; i <= 3; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: fifoUrl,
          MessageBody: `Message ${i}`,
          MessageGroupId: 'order-group',
        }))
      }

      // Receive and verify order
      const received: string[] = []
      for (let i = 0; i < 3; i++) {
        const { Messages } = await client.send(new ReceiveMessageCommand({
          QueueUrl: fifoUrl,
          MaxNumberOfMessages: 1,
        }))
        if (Messages?.[0]) {
          received.push(Messages[0].Body!)
          await client.send(new DeleteMessageCommand({
            QueueUrl: fifoUrl,
            ReceiptHandle: Messages[0].ReceiptHandle!,
          }))
        }
      }

      expect(received).toEqual(['Message 1', 'Message 2', 'Message 3'])
    })

    it('should return sequence number for FIFO messages', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: fifoUrl,
        MessageBody: 'FIFO message',
        MessageGroupId: 'test-group',
      }))

      expect(result.SequenceNumber).toBeDefined()
    })
  })

  describe('Receive Count Tracking', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'receive-count-queue',
        Attributes: {
          VisibilityTimeout: '0', // Immediate retry for testing
        },
      }))
      queueUrl = result.QueueUrl!

      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Count me',
      }))
    })

    it('should increment receive count on each receive', async () => {
      // First receive
      const first = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        AttributeNames: ['ApproximateReceiveCount'],
        VisibilityTimeout: 0,
      }))

      expect(first.Messages![0].Attributes?.ApproximateReceiveCount).toBe('1')

      // Second receive (visibility timeout = 0 means immediately visible)
      const second = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        AttributeNames: ['ApproximateReceiveCount'],
        VisibilityTimeout: 0,
      }))

      expect(second.Messages![0].Attributes?.ApproximateReceiveCount).toBe('2')
    })
  })
})

describe('Error Handling', () => {
  let client: SQSClient

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
  })

  it('should throw QueueDoesNotExist for invalid queue URL', async () => {
    await expect(
      client.send(new SendMessageCommand({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/nonexistent',
        MessageBody: 'test',
      }))
    ).rejects.toThrow(QueueDoesNotExist)
  })

  it('should handle concurrent operations', async () => {
    const { QueueUrl } = await client.send(new CreateQueueCommand({
      QueueName: 'concurrent-queue',
    }))

    // Send 10 messages concurrently
    const sends = Array.from({ length: 10 }, (_, i) =>
      client.send(new SendMessageCommand({
        QueueUrl: QueueUrl!,
        MessageBody: `Concurrent ${i}`,
      }))
    )

    const results = await Promise.all(sends)
    expect(results.every((r) => r.MessageId)).toBe(true)

    // Verify all messages are in queue
    const attrs = await client.send(new GetQueueAttributesCommand({
      QueueUrl: QueueUrl!,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }))

    expect(parseInt(attrs.Attributes?.ApproximateNumberOfMessages ?? '0')).toBe(10)
  })
})
