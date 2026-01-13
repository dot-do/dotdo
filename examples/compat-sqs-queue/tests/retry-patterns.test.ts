/**
 * Retry Patterns and Dead Letter Queue Tests
 *
 * Tests for:
 * - Exponential backoff retry logic
 * - Dead letter queue patterns
 * - Message reprocessing
 * - Visibility timeout extension
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  _clearAll,
  type Message,
} from '@dotdo/sqs'

describe('Retry Patterns', () => {
  let client: SQSClient

  beforeEach(() => {
    _clearAll()
    client = new SQSClient({ region: 'us-east-1' })
  })

  describe('Exponential Backoff Implementation', () => {
    it('should calculate correct backoff delays', () => {
      // Exponential backoff: 2^(attempt-1) seconds
      // Attempt 1: 2^0 = 1s
      // Attempt 2: 2^1 = 2s
      // Attempt 3: 2^2 = 4s
      // Attempt 4: 2^3 = 8s
      // Attempt 5: 2^4 = 16s
      const backoffDelays = [1, 2, 3, 4, 5].map(attempt => Math.pow(2, attempt - 1))
      expect(backoffDelays).toEqual([1, 2, 4, 8, 16])
    })

    it('should implement retry with visibility timeout', async () => {
      const { QueueUrl } = await client.send(new CreateQueueCommand({
        QueueName: 'retry-queue',
        Attributes: { VisibilityTimeout: '30' },
      }))

      // Send message
      await client.send(new SendMessageCommand({
        QueueUrl: QueueUrl!,
        MessageBody: JSON.stringify({ task: 'process', id: '123' }),
      }))

      // Receive message
      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: QueueUrl!,
        MaxNumberOfMessages: 1,
        AttributeNames: ['ApproximateReceiveCount'],
      }))

      expect(Messages).toHaveLength(1)
      const message = Messages![0]
      const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount ?? '1')

      // Simulate retry with exponential backoff
      const backoffSeconds = Math.pow(2, receiveCount - 1)

      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: QueueUrl!,
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: backoffSeconds,
      }))

      // Message should be invisible
      const retryReceive = await client.send(new ReceiveMessageCommand({
        QueueUrl: QueueUrl!,
        MaxNumberOfMessages: 1,
      }))

      expect(retryReceive.Messages).toBeUndefined()
    })
  })

  describe('Dead Letter Queue Pattern', () => {
    let mainQueueUrl: string
    let dlqUrl: string
    const maxRetries = 3

    beforeEach(async () => {
      // Create DLQ
      const dlqResult = await client.send(new CreateQueueCommand({
        QueueName: 'orders-dlq',
      }))
      dlqUrl = dlqResult.QueueUrl!

      // Create main queue
      const mainResult = await client.send(new CreateQueueCommand({
        QueueName: 'orders',
        Attributes: {
          VisibilityTimeout: '0', // Immediate for testing
        },
      }))
      mainQueueUrl = mainResult.QueueUrl!
    })

    it('should move message to DLQ after max retries', async () => {
      // Send message
      await client.send(new SendMessageCommand({
        QueueUrl: mainQueueUrl,
        MessageBody: JSON.stringify({ orderId: '456', action: 'process' }),
      }))

      // Simulate multiple failed processing attempts
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { Messages } = await client.send(new ReceiveMessageCommand({
          QueueUrl: mainQueueUrl,
          MaxNumberOfMessages: 1,
          AttributeNames: ['ApproximateReceiveCount'],
          VisibilityTimeout: 0,
        }))

        expect(Messages).toHaveLength(1)
        const message = Messages![0]
        const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount ?? '1')

        if (receiveCount >= maxRetries) {
          // Move to DLQ
          await client.send(new SendMessageCommand({
            QueueUrl: dlqUrl,
            MessageBody: JSON.stringify({
              originalBody: JSON.parse(message.Body!),
              failureReason: 'Max retries exceeded',
              receiveCount,
              failedAt: new Date().toISOString(),
            }),
          }))

          // Delete from main queue
          await client.send(new DeleteMessageCommand({
            QueueUrl: mainQueueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }))
        }
      }

      // Verify message is in DLQ
      const dlqMessages = await client.send(new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(dlqMessages.Messages).toHaveLength(1)
      const dlqBody = JSON.parse(dlqMessages.Messages![0].Body!)
      expect(dlqBody.failureReason).toBe('Max retries exceeded')
      expect(dlqBody.originalBody.orderId).toBe('456')
    })

    it('should track failure metadata in DLQ', async () => {
      // Send to DLQ with metadata
      const originalMessage = { task: 'send-email', email: 'user@example.com' }
      const failureMetadata = {
        originalBody: originalMessage,
        failureReason: 'SMTP connection timeout',
        receiveCount: 5,
        failedAt: new Date().toISOString(),
        lastError: 'Error: Connection refused',
        retryHistory: [
          { attempt: 1, error: 'Timeout', timestamp: new Date(Date.now() - 16000).toISOString() },
          { attempt: 2, error: 'Timeout', timestamp: new Date(Date.now() - 12000).toISOString() },
          { attempt: 3, error: 'Connection refused', timestamp: new Date(Date.now() - 4000).toISOString() },
        ],
      }

      await client.send(new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify(failureMetadata),
        MessageAttributes: {
          failureReason: {
            DataType: 'String',
            StringValue: failureMetadata.failureReason,
          },
        },
      }))

      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
        MessageAttributeNames: ['All'],
      }))

      const body = JSON.parse(Messages![0].Body!)
      expect(body.retryHistory).toHaveLength(3)
      expect(body.failureReason).toBe('SMTP connection timeout')
    })

    it('should reprocess message from DLQ', async () => {
      // Add message to DLQ
      const originalMessage = { jobId: '789', type: 'notification' }
      await client.send(new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify({
          originalBody: originalMessage,
          failureReason: 'Temporary failure',
        }),
      }))

      // Receive from DLQ
      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
      }))

      const dlqMessage = JSON.parse(Messages![0].Body!)

      // Reprocess - send back to main queue
      await client.send(new SendMessageCommand({
        QueueUrl: mainQueueUrl,
        MessageBody: JSON.stringify(dlqMessage.originalBody),
        MessageAttributes: {
          reprocessedFrom: {
            DataType: 'String',
            StringValue: 'dlq',
          },
        },
      }))

      // Delete from DLQ
      await client.send(new DeleteMessageCommand({
        QueueUrl: dlqUrl,
        ReceiptHandle: Messages![0].ReceiptHandle!,
      }))

      // Verify in main queue
      const mainMessages = await client.send(new ReceiveMessageCommand({
        QueueUrl: mainQueueUrl,
        MaxNumberOfMessages: 1,
        MessageAttributeNames: ['All'],
      }))

      expect(mainMessages.Messages).toHaveLength(1)
      const body = JSON.parse(mainMessages.Messages![0].Body!)
      expect(body.jobId).toBe('789')
      expect(mainMessages.Messages![0].MessageAttributes?.reprocessedFrom?.StringValue).toBe('dlq')
    })
  })

  describe('Visibility Timeout Extension', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'long-running-tasks',
        Attributes: { VisibilityTimeout: '30' },
      }))
      queueUrl = result.QueueUrl!
    })

    it('should extend visibility for long-running tasks', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ task: 'heavy-processing' }),
      }))

      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      }))

      const receiptHandle = Messages![0].ReceiptHandle!

      // Simulate long-running processing - extend visibility twice
      for (let i = 0; i < 2; i++) {
        await client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: 60, // Extend by 60 seconds
        }))
      }

      // Verify message is still invisible
      const checkReceive = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(checkReceive.Messages).toBeUndefined()

      // Complete the task
      await client.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }))
    })

    it('should release message by setting visibility to 0', async () => {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: 'Release me',
      }))

      const { Messages } = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 300, // 5 minutes
      }))

      // Release message back to queue immediately
      await client.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: Messages![0].ReceiptHandle!,
        VisibilityTimeout: 0,
      }))

      // Message should be immediately available
      const reReceive = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }))

      expect(reReceive.Messages).toHaveLength(1)
      expect(reReceive.Messages![0].Body).toBe('Release me')
    })
  })

  describe('Batch Processing Patterns', () => {
    let queueUrl: string

    beforeEach(async () => {
      const result = await client.send(new CreateQueueCommand({
        QueueName: 'batch-processing',
      }))
      queueUrl = result.QueueUrl!
    })

    it('should process messages in batches', async () => {
      // Send 25 messages
      for (let i = 0; i < 25; i++) {
        await client.send(new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ id: i, data: `item-${i}` }),
        }))
      }

      // Process in batches of 10
      const processed: number[] = []
      let totalProcessed = 0

      while (totalProcessed < 25) {
        const { Messages } = await client.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
        }))

        if (!Messages || Messages.length === 0) break

        for (const message of Messages) {
          const body = JSON.parse(message.Body!)
          processed.push(body.id)
          totalProcessed++

          await client.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }))
        }
      }

      expect(processed).toHaveLength(25)
      // Verify all IDs were processed (order may vary)
      expect(new Set(processed)).toEqual(new Set([...Array(25).keys()]))
    })
  })
})
