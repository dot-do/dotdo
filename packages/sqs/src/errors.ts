/**
 * @dotdo/sqs errors
 *
 * SQS-specific error classes that match @aws-sdk/client-sqs error types.
 */

import type { ResponseMetadata } from './types'

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base SQS error
 */
export class SQSServiceException extends Error {
  readonly $fault: 'client' | 'server'
  readonly $service: string
  readonly $metadata: ResponseMetadata

  constructor(
    message: string,
    options: { $fault?: 'client' | 'server'; $metadata?: ResponseMetadata } = {}
  ) {
    super(message)
    this.name = 'SQSServiceException'
    this.$fault = options.$fault ?? 'client'
    this.$service = 'sqs'
    this.$metadata = options.$metadata ?? {}
  }
}

/**
 * Queue does not exist
 */
export class QueueDoesNotExist extends SQSServiceException {
  constructor(message = 'The specified queue does not exist.') {
    super(message, { $fault: 'client' })
    this.name = 'QueueDoesNotExist'
  }
}

/**
 * Queue already exists
 */
export class QueueNameExists extends SQSServiceException {
  constructor(message = 'A queue with this name already exists.') {
    super(message, { $fault: 'client' })
    this.name = 'QueueNameExists'
  }
}

/**
 * Invalid message attribute name
 */
export class InvalidAttributeName extends SQSServiceException {
  constructor(message = 'The specified attribute does not exist.') {
    super(message, { $fault: 'client' })
    this.name = 'InvalidAttributeName'
  }
}

/**
 * Invalid message attribute value
 */
export class InvalidAttributeValue extends SQSServiceException {
  constructor(message = 'The specified attribute value is invalid.') {
    super(message, { $fault: 'client' })
    this.name = 'InvalidAttributeValue'
  }
}

/**
 * Receipt handle is invalid
 */
export class ReceiptHandleIsInvalid extends SQSServiceException {
  constructor(message = 'The specified receipt handle is not valid.') {
    super(message, { $fault: 'client' })
    this.name = 'ReceiptHandleIsInvalid'
  }
}

/**
 * Message not inflight (already deleted or visibility timeout expired)
 */
export class MessageNotInflight extends SQSServiceException {
  constructor(message = 'The specified message is not in flight.') {
    super(message, { $fault: 'client' })
    this.name = 'MessageNotInflight'
  }
}

/**
 * Invalid ID format in batch operation
 */
export class InvalidIdFormat extends SQSServiceException {
  constructor(message = 'The specified batch entry ID is invalid.') {
    super(message, { $fault: 'client' })
    this.name = 'InvalidIdFormat'
  }
}

/**
 * Too many entries in batch
 */
export class TooManyEntriesInBatchRequest extends SQSServiceException {
  constructor(message = 'The batch request contains too many entries.') {
    super(message, { $fault: 'client' })
    this.name = 'TooManyEntriesInBatchRequest'
  }
}

/**
 * Empty batch request
 */
export class EmptyBatchRequest extends SQSServiceException {
  constructor(message = 'The batch request does not contain any entries.') {
    super(message, { $fault: 'client' })
    this.name = 'EmptyBatchRequest'
  }
}

/**
 * Batch entry IDs not distinct
 */
export class BatchEntryIdsNotDistinct extends SQSServiceException {
  constructor(message = 'Batch entry IDs must be distinct.') {
    super(message, { $fault: 'client' })
    this.name = 'BatchEntryIdsNotDistinct'
  }
}

/**
 * Purge queue in progress
 */
export class PurgeQueueInProgress extends SQSServiceException {
  constructor(message = 'A purge queue operation is already in progress.') {
    super(message, { $fault: 'client' })
    this.name = 'PurgeQueueInProgress'
  }
}

/**
 * Invalid batch entry ID
 */
export class InvalidBatchEntryId extends SQSServiceException {
  constructor(message = 'The batch entry ID is invalid.') {
    super(message, { $fault: 'client' })
    this.name = 'InvalidBatchEntryId'
  }
}

/**
 * Message too long
 */
export class InvalidMessageContents extends SQSServiceException {
  constructor(message = 'The message contains invalid characters or is too long.') {
    super(message, { $fault: 'client' })
    this.name = 'InvalidMessageContents'
  }
}

/**
 * Over limit (number of messages, etc.)
 */
export class OverLimit extends SQSServiceException {
  constructor(message = 'The requested limit is exceeded.') {
    super(message, { $fault: 'client' })
    this.name = 'OverLimit'
  }
}
