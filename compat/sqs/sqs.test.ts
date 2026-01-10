/**
 * @dotdo/sqs - Package export tests
 *
 * Verifies that the @dotdo/sqs package correctly re-exports
 * all functionality from the streaming/compat/sqs implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Client
  SQSClient,

  // Queue Commands
  CreateQueueCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,

  // Message Commands
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityBatchCommand,
  PurgeQueueCommand,

  // Tag Commands
  TagQueueCommand,
  UntagQueueCommand,
  ListQueueTagsCommand,

  // Errors
  SQSServiceException,
  QueueDoesNotExist,
  QueueNameExists,
  InvalidAttributeName,
  InvalidAttributeValue,
  ReceiptHandleIsInvalid,
  MessageNotInflight,
  InvalidIdFormat,
  TooManyEntriesInBatchRequest,
  EmptyBatchRequest,
  BatchEntryIdsNotDistinct,
  PurgeQueueInProgress,
  InvalidBatchEntryId,
  InvalidMessageContents,
  OverLimit,

  // Test utilities
  _clearAll,
  _getQueues,

  // Default export
  default as DefaultSQSClient,
} from './index'

import type {
  SQSClientConfig,
  Message,
  CreateQueueCommandOutput,
  SendMessageCommandOutput,
  ReceiveMessageCommandOutput,
} from './index'

describe('@dotdo/sqs package exports', () => {
  beforeEach(() => {
    _clearAll()
  })

  describe('Client exports', () => {
    it('should export SQSClient', () => {
      expect(SQSClient).toBeDefined()
      expect(typeof SQSClient).toBe('function')
    })

    it('should export default as SQSClient', () => {
      expect(DefaultSQSClient).toBeDefined()
      expect(DefaultSQSClient).toBe(SQSClient)
    })

    it('should create client instance', () => {
      const client = new SQSClient({ region: 'us-east-1' })
      expect(client).toBeInstanceOf(SQSClient)
    })
  })

  describe('Command exports', () => {
    it('should export all queue commands', () => {
      expect(CreateQueueCommand).toBeDefined()
      expect(DeleteQueueCommand).toBeDefined()
      expect(ListQueuesCommand).toBeDefined()
      expect(GetQueueUrlCommand).toBeDefined()
      expect(GetQueueAttributesCommand).toBeDefined()
      expect(SetQueueAttributesCommand).toBeDefined()
    })

    it('should export all message commands', () => {
      expect(SendMessageCommand).toBeDefined()
      expect(SendMessageBatchCommand).toBeDefined()
      expect(ReceiveMessageCommand).toBeDefined()
      expect(DeleteMessageCommand).toBeDefined()
      expect(DeleteMessageBatchCommand).toBeDefined()
      expect(ChangeMessageVisibilityCommand).toBeDefined()
      expect(ChangeMessageVisibilityBatchCommand).toBeDefined()
      expect(PurgeQueueCommand).toBeDefined()
    })

    it('should export all tag commands', () => {
      expect(TagQueueCommand).toBeDefined()
      expect(UntagQueueCommand).toBeDefined()
      expect(ListQueueTagsCommand).toBeDefined()
    })
  })

  describe('Error exports', () => {
    it('should export all error classes', () => {
      expect(SQSServiceException).toBeDefined()
      expect(QueueDoesNotExist).toBeDefined()
      expect(QueueNameExists).toBeDefined()
      expect(InvalidAttributeName).toBeDefined()
      expect(InvalidAttributeValue).toBeDefined()
      expect(ReceiptHandleIsInvalid).toBeDefined()
      expect(MessageNotInflight).toBeDefined()
      expect(InvalidIdFormat).toBeDefined()
      expect(TooManyEntriesInBatchRequest).toBeDefined()
      expect(EmptyBatchRequest).toBeDefined()
      expect(BatchEntryIdsNotDistinct).toBeDefined()
      expect(PurgeQueueInProgress).toBeDefined()
      expect(InvalidBatchEntryId).toBeDefined()
      expect(InvalidMessageContents).toBeDefined()
      expect(OverLimit).toBeDefined()
    })

    it('should create error instances', () => {
      const error = new QueueDoesNotExist()
      expect(error).toBeInstanceOf(SQSServiceException)
      expect(error.name).toBe('QueueDoesNotExist')
    })
  })

  describe('Test utility exports', () => {
    it('should export _clearAll', () => {
      expect(_clearAll).toBeDefined()
      expect(typeof _clearAll).toBe('function')
    })

    it('should export _getQueues', () => {
      expect(_getQueues).toBeDefined()
      expect(typeof _getQueues).toBe('function')
    })
  })

  describe('Functional integration', () => {
    let client: InstanceType<typeof SQSClient>

    beforeEach(() => {
      client = new SQSClient({ region: 'us-east-1' })
    })

    it('should create and use a queue', async () => {
      // Create queue
      const createResult: CreateQueueCommandOutput = await client.send(
        new CreateQueueCommand({ QueueName: 'test-queue' })
      )
      expect(createResult.QueueUrl).toBeDefined()

      // Send message
      const sendResult: SendMessageCommandOutput = await client.send(
        new SendMessageCommand({
          QueueUrl: createResult.QueueUrl!,
          MessageBody: 'Hello from @dotdo/sqs',
        })
      )
      expect(sendResult.MessageId).toBeDefined()
      expect(sendResult.MD5OfMessageBody).toBeDefined()

      // Receive message
      const receiveResult: ReceiveMessageCommandOutput = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: createResult.QueueUrl!,
          MaxNumberOfMessages: 1,
        })
      )
      expect(receiveResult.Messages).toBeDefined()
      expect(receiveResult.Messages).toHaveLength(1)
      expect(receiveResult.Messages![0].Body).toBe('Hello from @dotdo/sqs')

      // Delete message
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: createResult.QueueUrl!,
          ReceiptHandle: receiveResult.Messages![0].ReceiptHandle!,
        })
      )

      // Verify queue is empty
      const finalReceive = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: createResult.QueueUrl!,
          MaxNumberOfMessages: 1,
        })
      )
      expect(finalReceive.Messages).toBeUndefined()
    })

    it('should handle FIFO queue', async () => {
      const { QueueUrl } = await client.send(
        new CreateQueueCommand({
          QueueName: 'test.fifo',
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
          },
        })
      )

      const sendResult = await client.send(
        new SendMessageCommand({
          QueueUrl: QueueUrl!,
          MessageBody: 'FIFO message',
          MessageGroupId: 'group-1',
        })
      )

      expect(sendResult.SequenceNumber).toBeDefined()
    })

    it('should handle batch operations', async () => {
      const { QueueUrl } = await client.send(
        new CreateQueueCommand({ QueueName: 'batch-queue' })
      )

      // Batch send
      const batchSend = await client.send(
        new SendMessageBatchCommand({
          QueueUrl: QueueUrl!,
          Entries: [
            { Id: '1', MessageBody: 'Message 1' },
            { Id: '2', MessageBody: 'Message 2' },
          ],
        })
      )

      expect(batchSend.Successful).toHaveLength(2)

      // Receive all
      const receiveResult = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: QueueUrl!,
          MaxNumberOfMessages: 10,
        })
      )

      // Batch delete
      const batchDelete = await client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: QueueUrl!,
          Entries: receiveResult.Messages!.map((m, i) => ({
            Id: `${i}`,
            ReceiptHandle: m.ReceiptHandle!,
          })),
        })
      )

      expect(batchDelete.Successful).toHaveLength(2)
    })

    it('should handle errors correctly', async () => {
      await expect(
        client.send(
          new SendMessageCommand({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/nonexistent',
            MessageBody: 'test',
          })
        )
      ).rejects.toThrow(QueueDoesNotExist)
    })
  })
})
