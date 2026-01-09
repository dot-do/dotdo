/**
 * @dotdo/sqs - SQS SDK compat tests
 *
 * Tests for @aws-sdk/client-sqs API compatibility backed by in-memory storage:
 * - SQS client creation
 * - Queue operations (create, delete, list, get URL, attributes)
 * - Message operations (send, receive, delete, visibility)
 * - Batch operations
 * - FIFO queue support
 * - Error handling
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityBatchCommand,
  PurgeQueueCommand,
  TagQueueCommand,
  UntagQueueCommand,
  ListQueueTagsCommand,
  _clearAll,
  QueueDoesNotExist,
  QueueNameExists,
  ReceiptHandleIsInvalid,
  EmptyBatchRequest,
  TooManyEntriesInBatchRequest,
  BatchEntryIdsNotDistinct,
} from './index'
import type {
  Message,
  CreateQueueCommandOutput,
  SendMessageCommandOutput,
} from './types'

// ============================================================================
// SQS CLIENT TESTS
// ============================================================================

describe('SQSClient', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should create client with default config', () => {
    const client = new SQSClient()
    expect(client).toBeDefined()
  })

  it('should create client with region', () => {
    const client = new SQSClient({ region: 'us-west-2' })
    expect(client).toBeDefined()
  })

  it('should create client with credentials', () => {
    const client = new SQSClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    })
    expect(client).toBeDefined()
  })

  it('should destroy client', () => {
    const client = new SQSClient()
    client.destroy()
    // Should not throw
  })
})

// ============================================================================
// QUEUE OPERATIONS TESTS
// ============================================================================

describe('Queue Operations', () => {
  let client: SQSClient

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
  })

  describe('CreateQueueCommand', () => {
    it('should create a queue', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'test-queue',
      }))

      expect(result.QueueUrl).toBeDefined()
      expect(result.QueueUrl).toContain('test-queue')
      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should create queue with attributes', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'configured-queue',
        Attributes: {
          VisibilityTimeout: '60',
          MessageRetentionPeriod: '86400',
          DelaySeconds: '5',
        },
      }))

      expect(result.QueueUrl).toBeDefined()

      // Verify attributes
      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: result.QueueUrl!,
        AttributeNames: ['All'],
      }))

      expect(attrs.Attributes?.VisibilityTimeout).toBe('60')
      expect(attrs.Attributes?.MessageRetentionPeriod).toBe('86400')
      expect(attrs.Attributes?.DelaySeconds).toBe('5')
    })

    it('should create FIFO queue', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'test-queue.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        },
      }))

      expect(result.QueueUrl).toContain('.fifo')

      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: result.QueueUrl!,
        AttributeNames: ['FifoQueue', 'ContentBasedDeduplication'],
      }))

      expect(attrs.Attributes?.FifoQueue).toBe('true')
      expect(attrs.Attributes?.ContentBasedDeduplication).toBe('true')
    })

    it('should throw error for duplicate queue name', async () => {
      await client.send(new CreateQueueCommand({
        QueueName: 'duplicate-queue',
      }))

      await expect(
        client.send(new CreateQueueCommand({
          QueueName: 'duplicate-queue',
        }))
      ).rejects.toThrow(QueueNameExists)
    })

    it('should create queue with tags', async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'tagged-queue',
        tags: {
          Environment: 'test',
          Project: 'dotdo',
        },
      }))

      const tags = await client.send(new ListQueueTagsCommand({
        QueueUrl: result.QueueUrl!,
      }))

      expect(tags.Tags?.Environment).toBe('test')
      expect(tags.Tags?.Project).toBe('dotdo')
    })
  })

  describe('DeleteQueueCommand', () => {
    it('should delete a queue', async () => {
      const createResult = await client.send(new CreateQueueCommand({
        QueueName: 'delete-me',
      }))

      await client.send(new DeleteQueueCommand({
        QueueUrl: createResult.QueueUrl!,
      }))

      await expect(
        client.send(new GetQueueUrlCommand({
          QueueName: 'delete-me',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })

    it('should throw error for non-existent queue', async () => {
      await expect(
        client.send(new DeleteQueueCommand({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/non-existent',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })

  describe('ListQueuesCommand', () => {
    beforeEach(async () => {
      await client.send(new CreateQueueCommand({ QueueName: 'queue-1' }))
      await client.send(new CreateQueueCommand({ QueueName: 'queue-2' }))
      await client.send(new CreateQueueCommand({ QueueName: 'other-queue' }))
    })

    it('should list all queues', async () => {
      const result = await client.send(new ListQueuesCommand({}))

      expect(result.QueueUrls).toHaveLength(3)
    })

    it('should filter by prefix', async () => {
      const result = await client.send(new ListQueuesCommand({
        QueueNamePrefix: 'queue-',
      }))

      expect(result.QueueUrls).toHaveLength(2)
      expect(result.QueueUrls?.every(url => url.includes('queue-'))).toBe(true)
    })

    it('should limit results', async () => {
      const result = await client.send(new ListQueuesCommand({
        MaxResults: 2,
      }))

      expect(result.QueueUrls).toHaveLength(2)
    })

    it('should return undefined for empty list', async () => {
      _clearAll()
      const result = await client.send(new ListQueuesCommand({}))

      expect(result.QueueUrls).toBeUndefined()
    })
  })

  describe('GetQueueUrlCommand', () => {
    it('should get queue URL by name', async () => {
      await client.send(new CreateQueueCommand({ QueueName: 'find-me' }))

      const result = await client.send(new GetQueueUrlCommand({
        QueueName: 'find-me',
      }))

      expect(result.QueueUrl).toContain('find-me')
    })

    it('should throw error for non-existent queue', async () => {
      await expect(
        client.send(new GetQueueUrlCommand({
          QueueName: 'non-existent',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })

  describe('GetQueueAttributesCommand', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'attrs-queue',
        Attributes: {
          VisibilityTimeout: '45',
          DelaySeconds: '10',
        },
      }))
      queueUrl = result.QueueUrl!
    })

    it('should get all attributes', async () => {
      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['All'],
      }))

      expect(result.Attributes).toBeDefined()
      expect(result.Attributes?.QueueArn).toBeDefined()
      expect(result.Attributes?.VisibilityTimeout).toBe('45')
      expect(result.Attributes?.DelaySeconds).toBe('10')
      expect(result.Attributes?.ApproximateNumberOfMessages).toBe('0')
    })

    it('should get specific attributes', async () => {
      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['VisibilityTimeout', 'DelaySeconds'],
      }))

      expect(result.Attributes?.VisibilityTimeout).toBe('45')
      expect(result.Attributes?.DelaySeconds).toBe('10')
      expect(result.Attributes?.QueueArn).toBeUndefined()
    })

    it('should return ApproximateNumberOfMessages for visible messages', async () => {
      // Send a message with no delay (override queue's default delay)
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'test message',
        DelaySeconds: 0,
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }))

      expect(result.Attributes?.ApproximateNumberOfMessages).toBe('1')
    })

    it('should return ApproximateNumberOfMessagesDelayed for delayed messages', async () => {
      // Send a message with queue's default 10 second delay
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'delayed message',
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessagesDelayed', 'ApproximateNumberOfMessages'],
      }))

      // Message is delayed, so it should be in delayed count, not visible count
      expect(result.Attributes?.ApproximateNumberOfMessagesDelayed).toBe('1')
      expect(result.Attributes?.ApproximateNumberOfMessages).toBe('0')
    })

    it('should return ApproximateNumberOfMessagesNotVisible for in-flight messages', async () => {
      // Send a message with no delay
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'inflight message',
        DelaySeconds: 0,
      }))

      // Receive the message (puts it in-flight)
      await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesDelayed',
        ],
      }))

      // Message was received and is now in-flight (not visible)
      expect(result.Attributes?.ApproximateNumberOfMessagesNotVisible).toBe('1')
      expect(result.Attributes?.ApproximateNumberOfMessages).toBe('0')
      expect(result.Attributes?.ApproximateNumberOfMessagesDelayed).toBe('0')
    })

    it('should return all message counts together', async () => {
      // Create a fresh queue with no default delay for cleaner test
      const freshQueue = await client.send(new CreateQueueCommand({
        QueueName: 'count-test-queue',
      }))
      const freshQueueUrl = freshQueue.QueueUrl!

      // Send messages in different states
      // 1. A visible message (no delay)
      await client.send(new SendMessageCommand({
        QueueUrl: freshQueueUrl,
        MessageBody: 'visible message',
        DelaySeconds: 0,
      }))

      // 2. A delayed message
      await client.send(new SendMessageCommand({
        QueueUrl: freshQueueUrl,
        MessageBody: 'delayed message',
        DelaySeconds: 60,
      }))

      // 3. An in-flight message (receive but don't delete)
      await client.send(new SendMessageCommand({
        QueueUrl: freshQueueUrl,
        MessageBody: 'inflight message',
        DelaySeconds: 0,
      }))
      await client.send(new ReceiveMessageCommand({
        QueueUrl: freshQueueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: freshQueueUrl,
        AttributeNames: ['All'],
      }))

      // Check all three message count types
      expect(result.Attributes?.ApproximateNumberOfMessages).toBe('1')
      expect(result.Attributes?.ApproximateNumberOfMessagesDelayed).toBe('1')
      expect(result.Attributes?.ApproximateNumberOfMessagesNotVisible).toBe('1')
    })
  })

  describe('SetQueueAttributesCommand', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'update-attrs-queue',
      }))
      queueUrl = result.QueueUrl!
    })

    it('should update queue attributes', async () => {
      await client.send(new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: {
          VisibilityTimeout: '120',
          DelaySeconds: '30',
        },
      }))

      const result = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['VisibilityTimeout', 'DelaySeconds'],
      }))

      expect(result.Attributes?.VisibilityTimeout).toBe('120')
      expect(result.Attributes?.DelaySeconds).toBe('30')
    })

    it('should throw error for non-existent queue', async () => {
      await expect(
        client.send(new SetQueueAttributesCommand({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/non-existent',
          Attributes: { VisibilityTimeout: '60' },
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })
})

// ============================================================================
// MESSAGE OPERATIONS TESTS
// ============================================================================

describe('Message Operations', () => {
  let client: SQSClient
  let queueUrl: string

  beforeEach(async () => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
    const result = await client.send(new CreateQueueCommand({
      QueueName: 'message-queue',
    }))
    queueUrl = result.QueueUrl!
  })

  describe('SendMessageCommand', () => {
    it('should send a message', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Hello World',
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageBody).toBeDefined()
      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should send message with delay', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Delayed message',
        DelaySeconds: 5,
      }))

      expect(result.MessageId).toBeDefined()

      // Message should not be immediately visible
      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(receiveResult.Messages).toBeUndefined()
    })

    it('should send message with attributes', async () => {
      const result = await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Message with attributes',
        MessageAttributes: {
          'Content-Type': {
            DataType: 'String',
            StringValue: 'application/json',
          },
          'Priority': {
            DataType: 'Number',
            StringValue: '1',
          },
        },
      }))

      expect(result.MessageId).toBeDefined()
      expect(result.MD5OfMessageAttributes).toBeDefined()
    })

    it('should throw error for non-existent queue', async () => {
      await expect(
        client.send(new SendMessageCommand({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/non-existent',
          MessageBody: 'test',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })

  describe('SendMessageBatchCommand', () => {
    it('should send batch of messages', async () => {
      const result = await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Message 1' },
          { Id: '2', MessageBody: 'Message 2' },
          { Id: '3', MessageBody: 'Message 3' },
        ],
      }))

      expect(result.Successful).toHaveLength(3)
      expect(result.Failed).toBeUndefined()
    })

    it('should handle partial failures', async () => {
      // Create a queue with small message size
      const smallQueue = await client.send(new CreateQueueCommand({
        QueueName: 'small-queue',
        Attributes: {
          MaximumMessageSize: '10', // 10 bytes max
        },
      }))

      const result = await client.send(new SendMessageBatchCommand({
        QueueUrl: smallQueue.QueueUrl!,
        Entries: [
          { Id: '1', MessageBody: 'ok' },
          { Id: '2', MessageBody: 'this message is way too long for the queue' },
        ],
      }))

      expect(result.Successful?.length).toBe(1)
      expect(result.Failed?.length).toBe(1)
      expect(result.Failed?.[0].Id).toBe('2')
    })

    it('should throw error for empty batch', async () => {
      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: [],
        }))
      ).rejects.toThrow(EmptyBatchRequest)
    })

    it('should throw error for too many entries', async () => {
      const entries = Array.from({ length: 11 }, (_, i) => ({
        Id: `${i}`,
        MessageBody: `Message ${i}`,
      }))

      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries,
        }))
      ).rejects.toThrow(TooManyEntriesInBatchRequest)
    })

    it('should throw error for duplicate IDs', async () => {
      await expect(
        client.send(new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: [
            { Id: '1', MessageBody: 'Message 1' },
            { Id: '1', MessageBody: 'Message 2' },
          ],
        }))
      ).rejects.toThrow(BatchEntryIdsNotDistinct)
    })
  })

  describe('ReceiveMessageCommand', () => {
    beforeEach(async () => {
      // Send some messages
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Message 1',
      }))
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Message 2',
      }))
    })

    it('should receive messages', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      expect(result.Messages).toBeDefined()
      expect(result.Messages?.length).toBe(2)
      expect(result.Messages?.[0].Body).toBeDefined()
      expect(result.Messages?.[0].ReceiptHandle).toBeDefined()
      expect(result.Messages?.[0].MessageId).toBeDefined()
    })

    it('should limit number of messages', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(result.Messages).toHaveLength(1)
    })

    it('should return system attributes when requested', async () => {
      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        AttributeNames: ['All'],
      }))

      expect(result.Messages?.[0].Attributes).toBeDefined()
      expect(result.Messages?.[0].Attributes?.SenderId).toBeDefined()
      expect(result.Messages?.[0].Attributes?.SentTimestamp).toBeDefined()
      expect(result.Messages?.[0].Attributes?.ApproximateReceiveCount).toBe('1')
    })

    it('should return message attributes when requested', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'With attributes',
        MessageAttributes: {
          'CustomAttr': {
            DataType: 'String',
            StringValue: 'custom-value',
          },
        },
      }))

      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        MessageAttributeNames: ['All'],
      }))

      // Find the message with attributes
      const msgWithAttrs = result.Messages?.find(m => m.MessageAttributes)
      expect(msgWithAttrs?.MessageAttributes?.CustomAttr?.StringValue).toBe('custom-value')
    })

    it('should respect visibility timeout', async () => {
      // Receive with short visibility timeout
      const first = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 1, // 1 second
      }))

      expect(first.Messages).toHaveLength(1)

      // Immediately try to receive again - message should be invisible
      const second = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      // Should only get the second message
      expect(second.Messages?.length).toBe(1)
    })

    it('should return empty when no messages', async () => {
      _clearAll()
      const queue = await client.send(new CreateQueueCommand({
        QueueName: 'empty-queue',
      }))

      const result = await client.send(new ReceiveMessageCommand({
        QueueUrl: queue.QueueUrl!,
        MaxNumberOfMessages: 10,
      }))

      expect(result.Messages).toBeUndefined()
    })

    it('should increment receive count on each receive', async () => {
      // First receive
      const first = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 0, // Immediately visible again
        AttributeNames: ['ApproximateReceiveCount'],
      }))

      expect(first.Messages?.[0].Attributes?.ApproximateReceiveCount).toBe('1')

      // Second receive
      const second = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 0,
        AttributeNames: ['ApproximateReceiveCount'],
      }))

      expect(second.Messages?.[0].Attributes?.ApproximateReceiveCount).toBe('2')
    })
  })

  describe('DeleteMessageCommand', () => {
    it('should delete a message', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Delete me',
      }))

      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      await client.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiveResult.Messages![0].ReceiptHandle!,
      }))

      // Verify message is gone
      const afterDelete = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 0,
      }))

      expect(afterDelete.Messages).toBeUndefined()
    })

    it('should throw error for invalid receipt handle', async () => {
      await expect(
        client.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: 'invalid-handle',
        }))
      ).rejects.toThrow(ReceiptHandleIsInvalid)
    })
  })

  describe('DeleteMessageBatchCommand', () => {
    it('should delete batch of messages', async () => {
      // Send messages
      await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Message 1' },
          { Id: '2', MessageBody: 'Message 2' },
        ],
      }))

      // Receive messages
      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      // Delete batch
      const deleteResult = await client.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: receiveResult.Messages!.map((m, i) => ({
          Id: `${i}`,
          ReceiptHandle: m.ReceiptHandle!,
        })),
      }))

      expect(deleteResult.Successful).toHaveLength(2)

      // Verify messages are gone
      const afterDelete = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      }))

      expect(afterDelete.Messages).toBeUndefined()
    })

    it('should handle partial failures', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'test',
      }))

      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      const result = await client.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', ReceiptHandle: receiveResult.Messages![0].ReceiptHandle! },
          { Id: '2', ReceiptHandle: 'invalid-handle' },
        ],
      }))

      expect(result.Successful?.length).toBe(1)
      expect(result.Failed?.length).toBe(1)
    })
  })

  describe('ChangeMessageVisibilityCommand', () => {
    it('should change message visibility', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'test',
      }))

      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      }))

      // Extend visibility
      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiveResult.Messages![0].ReceiptHandle!,
        VisibilityTimeout: 60,
      }))

      // Message should still be invisible
      const afterChange = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(afterChange.Messages).toBeUndefined()
    })

    it('should make message immediately visible with timeout 0', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'test',
      }))

      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      }))

      // Make immediately visible
      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiveResult.Messages![0].ReceiptHandle!,
        VisibilityTimeout: 0,
      }))

      // Message should be visible again
      const afterChange = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(afterChange.Messages).toHaveLength(1)
    })

    it('should throw error for invalid receipt handle', async () => {
      await expect(
        client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: 'invalid-handle',
          VisibilityTimeout: 60,
        }))
      ).rejects.toThrow(ReceiptHandleIsInvalid)
    })
  })

  describe('ChangeMessageVisibilityBatchCommand', () => {
    it('should change visibility for batch', async () => {
      await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Message 1' },
          { Id: '2', MessageBody: 'Message 2' },
        ],
      }))

      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30,
      }))

      const result = await client.send(new ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: receiveResult.Messages!.map((m, i) => ({
          Id: `${i}`,
          ReceiptHandle: m.ReceiptHandle!,
          VisibilityTimeout: 60,
        })),
      }))

      expect(result.Successful).toHaveLength(2)
    })
  })

  describe('PurgeQueueCommand', () => {
    it('should purge all messages', async () => {
      // Send messages
      await client.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: [
          { Id: '1', MessageBody: 'Message 1' },
          { Id: '2', MessageBody: 'Message 2' },
          { Id: '3', MessageBody: 'Message 3' },
        ],
      }))

      // Purge queue
      await client.send(new PurgeQueueCommand({
        QueueUrl: queueUrl,
      }))

      // Verify queue is empty
      const attrs = await client.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }))

      expect(attrs.Attributes?.ApproximateNumberOfMessages).toBe('0')
    })

    it('should throw error for non-existent queue', async () => {
      await expect(
        client.send(new PurgeQueueCommand({
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/non-existent',
        }))
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })
})

// ============================================================================
// TAG OPERATIONS TESTS
// ============================================================================

describe('Tag Operations', () => {
  let client: SQSClient
  let queueUrl: string

  beforeEach(async () => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
    const result = await client.send(new CreateQueueCommand({
      QueueName: 'tag-queue',
    }))
    queueUrl = result.QueueUrl!
  })

  describe('TagQueueCommand', () => {
    it('should add tags to queue', async () => {
      await client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: {
          Environment: 'test',
          Team: 'platform',
        },
      }))

      const result = await client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }))

      expect(result.Tags?.Environment).toBe('test')
      expect(result.Tags?.Team).toBe('platform')
    })

    it('should merge with existing tags', async () => {
      await client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: { Key1: 'value1' },
      }))

      await client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: { Key2: 'value2' },
      }))

      const result = await client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }))

      expect(result.Tags?.Key1).toBe('value1')
      expect(result.Tags?.Key2).toBe('value2')
    })
  })

  describe('UntagQueueCommand', () => {
    beforeEach(async () => {
      await client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: {
          Key1: 'value1',
          Key2: 'value2',
          Key3: 'value3',
        },
      }))
    })

    it('should remove tags', async () => {
      await client.send(new UntagQueueCommand({
        QueueUrl: queueUrl,
        TagKeys: ['Key1', 'Key2'],
      }))

      const result = await client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }))

      expect(result.Tags?.Key1).toBeUndefined()
      expect(result.Tags?.Key2).toBeUndefined()
      expect(result.Tags?.Key3).toBe('value3')
    })
  })

  describe('ListQueueTagsCommand', () => {
    it('should return undefined for no tags', async () => {
      const result = await client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }))

      expect(result.Tags).toBeUndefined()
    })

    it('should return all tags', async () => {
      await client.send(new TagQueueCommand({
        QueueUrl: queueUrl,
        Tags: {
          Key1: 'value1',
          Key2: 'value2',
        },
      }))

      const result = await client.send(new ListQueueTagsCommand({
        QueueUrl: queueUrl,
      }))

      expect(result.Tags).toEqual({
        Key1: 'value1',
        Key2: 'value2',
      })
    })
  })
})

// ============================================================================
// FIFO QUEUE TESTS
// ============================================================================

describe('FIFO Queue', () => {
  let client: SQSClient
  let queueUrl: string

  beforeEach(async () => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
    const result = await client.send(new CreateQueueCommand({
      QueueName: 'test-queue.fifo',
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'true',
      },
    }))
    queueUrl = result.QueueUrl!
  })

  it('should send message with group ID', async () => {
    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: 'FIFO message',
      MessageGroupId: 'group-1',
    }))

    expect(result.MessageId).toBeDefined()
    expect(result.SequenceNumber).toBeDefined()
  })

  it('should return FIFO attributes in receive', async () => {
    await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: 'FIFO message',
      MessageGroupId: 'group-1',
      MessageDeduplicationId: 'dedup-1',
    }))

    const result = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      AttributeNames: ['All'],
    }))

    expect(result.Messages?.[0].Attributes?.MessageGroupId).toBe('group-1')
    expect(result.Messages?.[0].Attributes?.MessageDeduplicationId).toBe('dedup-1')
    expect(result.Messages?.[0].Attributes?.SequenceNumber).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let client: SQSClient

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
  })

  it('should handle complete message lifecycle', async () => {
    // Create queue
    const createResult = await client.send(new CreateQueueCommand({
      QueueName: 'lifecycle-queue',
      Attributes: {
        VisibilityTimeout: '30',
      },
    }))
    const queueUrl = createResult.QueueUrl!

    // Send messages
    for (let i = 0; i < 5; i++) {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ index: i }),
      }))
    }

    // Verify message count
    const attrs = await client.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }))
    expect(attrs.Attributes?.ApproximateNumberOfMessages).toBe('5')

    // Receive and process messages
    let processed = 0
    while (processed < 5) {
      const receiveResult = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 5,
      }))

      if (receiveResult.Messages) {
        for (const msg of receiveResult.Messages) {
          // Process message
          const body = JSON.parse(msg.Body!)
          expect(body.index).toBeDefined()

          // Delete message
          await client.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }))
          processed++
        }
      }
    }

    expect(processed).toBe(5)

    // Verify queue is empty
    const finalAttrs = await client.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }))
    expect(finalAttrs.Attributes?.ApproximateNumberOfMessages).toBe('0')

    // Delete queue
    await client.send(new DeleteQueueCommand({
      QueueUrl: queueUrl,
    }))

    // Verify queue is deleted
    await expect(
      client.send(new GetQueueUrlCommand({
        QueueName: 'lifecycle-queue',
      }))
    ).rejects.toThrow(QueueDoesNotExist)
  })

  it('should handle multiple queues', async () => {
    // Create multiple queues
    const queue1 = await client.send(new CreateQueueCommand({
      QueueName: 'multi-queue-1',
    }))
    const queue2 = await client.send(new CreateQueueCommand({
      QueueName: 'multi-queue-2',
    }))

    // Send to different queues
    await client.send(new SendMessageCommand({
      QueueUrl: queue1.QueueUrl!,
      MessageBody: 'Queue 1 message',
    }))
    await client.send(new SendMessageCommand({
      QueueUrl: queue2.QueueUrl!,
      MessageBody: 'Queue 2 message',
    }))

    // Receive from each queue
    const result1 = await client.send(new ReceiveMessageCommand({
      QueueUrl: queue1.QueueUrl!,
      MaxNumberOfMessages: 1,
    }))
    const result2 = await client.send(new ReceiveMessageCommand({
      QueueUrl: queue2.QueueUrl!,
      MaxNumberOfMessages: 1,
    }))

    expect(result1.Messages?.[0].Body).toBe('Queue 1 message')
    expect(result2.Messages?.[0].Body).toBe('Queue 2 message')
  })

  it('should handle batch operations efficiently', async () => {
    const queueUrl = (await client.send(new CreateQueueCommand({
      QueueName: 'batch-queue',
    }))).QueueUrl!

    // Send batch
    const sendResult = await client.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: Array.from({ length: 10 }, (_, i) => ({
        Id: `msg-${i}`,
        MessageBody: `Batch message ${i}`,
      })),
    }))

    expect(sendResult.Successful).toHaveLength(10)

    // Receive all
    const receiveResult = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
    }))

    expect(receiveResult.Messages).toHaveLength(10)

    // Delete batch
    const deleteResult = await client.send(new DeleteMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: receiveResult.Messages!.map((m, i) => ({
        Id: `del-${i}`,
        ReceiptHandle: m.ReceiptHandle!,
      })),
    }))

    expect(deleteResult.Successful).toHaveLength(10)

    // Verify empty
    const finalReceive = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
    }))

    expect(finalReceive.Messages).toBeUndefined()
  })
})

// ============================================================================
// MD5 HASH TESTS
// ============================================================================

describe('MD5 Hash Verification', () => {
  let client: SQSClient
  let queueUrl: string

  beforeEach(async () => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
    const result = await client.send(new CreateQueueCommand({
      QueueName: 'md5-test-queue',
    }))
    queueUrl = result.QueueUrl!
  })

  it('should compute correct MD5 hash for message body', async () => {
    // Known MD5 values:
    // MD5("Hello World") = b10a8db164e0754105b7a99be72e3fe5
    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: 'Hello World',
    }))

    expect(result.MD5OfMessageBody).toBe('b10a8db164e0754105b7a99be72e3fe5')
  })

  it('should compute correct MD5 hash for empty string', async () => {
    // MD5("") = d41d8cd98f00b204e9800998ecf8427e
    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: '',
    }))

    expect(result.MD5OfMessageBody).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('should compute correct MD5 hash for JSON content', async () => {
    // MD5('{"key":"value"}') = a7353f7cddce808de0032747a0b7be50
    const body = '{"key":"value"}'
    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
    }))

    expect(result.MD5OfMessageBody).toBe('a7353f7cddce808de0032747a0b7be50')
  })

  it('should return matching MD5 in received message', async () => {
    const body = 'Test message for MD5 verification'
    // MD5 of this string = e503fc68353af23a25703c966fbc1693

    const sendResult = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
    }))

    const receiveResult = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
    }))

    expect(receiveResult.Messages).toBeDefined()
    expect(receiveResult.Messages![0].MD5OfBody).toBe(sendResult.MD5OfMessageBody)
    expect(receiveResult.Messages![0].MD5OfBody).toBe('e503fc68353af23a25703c966fbc1693')
  })

  it('should compute correct MD5 for batch messages', async () => {
    const result = await client.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: [
        { Id: '1', MessageBody: 'Hello World' },
        { Id: '2', MessageBody: '' },
        { Id: '3', MessageBody: '{"key":"value"}' },
      ],
    }))

    expect(result.Successful).toBeDefined()
    expect(result.Successful).toHaveLength(3)

    const msg1 = result.Successful!.find(m => m.Id === '1')
    const msg2 = result.Successful!.find(m => m.Id === '2')
    const msg3 = result.Successful!.find(m => m.Id === '3')

    expect(msg1?.MD5OfMessageBody).toBe('b10a8db164e0754105b7a99be72e3fe5')
    expect(msg2?.MD5OfMessageBody).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(msg3?.MD5OfMessageBody).toBe('a7353f7cddce808de0032747a0b7be50')
  })

  it('should compute correct MD5 for unicode content', async () => {
    // MD5 of "Hello 世界" (UTF-8 encoded) = af91c2603879085df0cb545dd0366dcd
    const body = 'Hello 世界'
    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
    }))

    expect(result.MD5OfMessageBody).toBe('af91c2603879085df0cb545dd0366dcd')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let client: SQSClient

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
  })

  it('should throw QueueDoesNotExist for non-existent queue operations', async () => {
    const fakeUrl = 'https://sqs.us-east-1.amazonaws.com/000000000000/fake'

    await expect(client.send(new SendMessageCommand({
      QueueUrl: fakeUrl,
      MessageBody: 'test',
    }))).rejects.toThrow(QueueDoesNotExist)

    await expect(client.send(new ReceiveMessageCommand({
      QueueUrl: fakeUrl,
    }))).rejects.toThrow(QueueDoesNotExist)

    await expect(client.send(new GetQueueAttributesCommand({
      QueueUrl: fakeUrl,
      AttributeNames: ['All'],
    }))).rejects.toThrow(QueueDoesNotExist)
  })

  it('should throw ReceiptHandleIsInvalid for invalid handles', async () => {
    const queue = await client.send(new CreateQueueCommand({
      QueueName: 'error-test',
    }))

    await expect(client.send(new DeleteMessageCommand({
      QueueUrl: queue.QueueUrl!,
      ReceiptHandle: 'invalid',
    }))).rejects.toThrow(ReceiptHandleIsInvalid)

    await expect(client.send(new ChangeMessageVisibilityCommand({
      QueueUrl: queue.QueueUrl!,
      ReceiptHandle: 'invalid',
      VisibilityTimeout: 60,
    }))).rejects.toThrow(ReceiptHandleIsInvalid)
  })

  it('should throw batch errors appropriately', async () => {
    const queue = await client.send(new CreateQueueCommand({
      QueueName: 'batch-error-test',
    }))

    // Empty batch
    await expect(client.send(new SendMessageBatchCommand({
      QueueUrl: queue.QueueUrl!,
      Entries: [],
    }))).rejects.toThrow(EmptyBatchRequest)

    // Too many entries
    await expect(client.send(new SendMessageBatchCommand({
      QueueUrl: queue.QueueUrl!,
      Entries: Array.from({ length: 11 }, (_, i) => ({
        Id: `${i}`,
        MessageBody: 'test',
      })),
    }))).rejects.toThrow(TooManyEntriesInBatchRequest)

    // Duplicate IDs
    await expect(client.send(new SendMessageBatchCommand({
      QueueUrl: queue.QueueUrl!,
      Entries: [
        { Id: 'dup', MessageBody: 'test1' },
        { Id: 'dup', MessageBody: 'test2' },
      ],
    }))).rejects.toThrow(BatchEntryIdsNotDistinct)
  })
})
