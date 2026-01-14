/**
 * WSOperationRouter - Routes WebSocket messages to state manager operations
 *
 * Handles incoming WebSocket messages and routes them to the appropriate
 * state manager operation (create, read, update, delete, batch).
 *
 * Features:
 * - Message parsing (JSON strings or objects)
 * - Operation routing based on message type
 * - ACK generation with request correlation
 * - Error handling with proper response codes
 * - Batch operations with atomic mode support
 *
 * @module unified-storage/ws-operation-router
 */

import type { InMemoryStateManager, ThingData, CreateThingInput } from './in-memory-state-manager'
import type { PipelineEmitter } from './pipeline-emitter'

// ============================================================================
// Message Types
// ============================================================================

/**
 * Base message interface with type and requestId
 */
export interface WSBaseMessage {
  type: string
  requestId: string
}

/**
 * Create message
 */
export interface WSCreateMessage extends WSBaseMessage {
  type: 'create'
  payload: CreateThingInput
}

/**
 * Read message - supports multiple IDs
 */
export interface WSReadMessage extends WSBaseMessage {
  type: 'read'
  $ids: string[]
}

/**
 * Update message
 */
export interface WSUpdateMessage extends WSBaseMessage {
  type: 'update'
  $id: string
  payload: Partial<ThingData>
}

/**
 * Delete message
 */
export interface WSDeleteMessage extends WSBaseMessage {
  type: 'delete'
  $id: string
}

/**
 * Batch operation (without requestId)
 */
export interface WSBatchOperation {
  type: 'create' | 'read' | 'update' | 'delete'
  payload?: CreateThingInput | Partial<ThingData>
  $id?: string
  $ids?: string[]
}

/**
 * Batch message
 */
export interface WSBatchMessage extends WSBaseMessage {
  type: 'batch'
  operations: WSBatchOperation[]
  atomic?: boolean
}

/**
 * Union type for all message types
 */
export type WSMessage = WSCreateMessage | WSReadMessage | WSUpdateMessage | WSDeleteMessage | WSBatchMessage

// ============================================================================
// Response Types
// ============================================================================

/**
 * Base response interface
 */
export interface WSBaseResponse {
  type: string
  requestId: string
}

/**
 * ACK response for create/update/delete operations
 */
export interface WSAckResponse extends WSBaseResponse {
  type: 'ack'
  $id?: string
  $version?: number
  success?: boolean
}

/**
 * Read response with things map
 */
export interface WSReadResponse extends WSBaseResponse {
  type: 'read_response'
  things: Record<string, ThingData | null>
}

/**
 * Error response
 */
export interface WSErrorResponse extends WSBaseResponse {
  type: 'error'
  code: string
  message: string
}

/**
 * Batch operation result
 */
export interface WSBatchOperationResult {
  success: boolean
  $id?: string
  $version?: number
  error?: string
}

/**
 * Batch response
 */
export interface WSBatchResponse extends WSBaseResponse {
  type: 'batch_response'
  results: WSBatchOperationResult[]
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  PARSE_ERROR: 'PARSE_ERROR',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BATCH_FAILED: 'BATCH_FAILED',
} as const

// ============================================================================
// WSOperationRouter Class
// ============================================================================

/**
 * WSOperationRouter - Routes WebSocket messages to state manager operations
 *
 * @example
 * ```typescript
 * const router = new WSOperationRouter(stateManager, emitter)
 *
 * // Handle incoming WebSocket message
 * ws.addEventListener('message', async (event) => {
 *   await router.handleMessageString(event.data, ws)
 * })
 * ```
 */
export class WSOperationRouter {
  private stateManager: InMemoryStateManager
  private emitter?: PipelineEmitter

  constructor(stateManager: InMemoryStateManager, emitter?: PipelineEmitter) {
    this.stateManager = stateManager
    this.emitter = emitter
  }

  /**
   * Handle a JSON string message
   */
  async handleMessageString(messageString: string, ws: WebSocket): Promise<void> {
    let message: WSMessage
    try {
      message = JSON.parse(messageString)
    } catch {
      this.sendError(ws, {
        requestId: 'unknown',
        code: ErrorCodes.PARSE_ERROR,
        message: 'Invalid JSON message',
      })
      return
    }

    await this.handleMessage(message, ws)
  }

  /**
   * Main message handler - routes to appropriate handler based on type
   */
  async handleMessage(message: WSMessage, ws: WebSocket): Promise<void> {
    try {
      switch (message.type) {
        case 'create':
          await this.handleCreate(ws, message as WSCreateMessage)
          break
        case 'read':
          await this.handleRead(ws, message as WSReadMessage)
          break
        case 'update':
          await this.handleUpdate(ws, message as WSUpdateMessage)
          break
        case 'delete':
          await this.handleDelete(ws, message as WSDeleteMessage)
          break
        case 'batch':
          await this.handleBatch(ws, message as WSBatchMessage)
          break
        default:
          this.sendError(ws, {
            requestId: message.requestId,
            code: ErrorCodes.UNKNOWN_TYPE,
            message: `Unknown message type: ${message.type}`,
          })
      }
    } catch (error) {
      // Catch any unexpected errors
      this.sendError(ws, {
        requestId: message.requestId,
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Handle create operation
   */
  private async handleCreate(ws: WebSocket, message: WSCreateMessage): Promise<void> {
    // Validate payload exists
    if (!message.payload) {
      this.sendError(ws, {
        requestId: message.requestId,
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Missing payload in create message',
      })
      return
    }

    // Validate $type is provided
    if (!message.payload.$type) {
      this.sendError(ws, {
        requestId: message.requestId,
        code: ErrorCodes.VALIDATION_ERROR,
        message: '$type is required in payload',
      })
      return
    }

    try {
      const result = this.stateManager.create(message.payload)

      // Emit event if emitter is configured
      if (this.emitter) {
        this.emitter.emit('thing.created', 'things', result)
      }

      // Send ACK immediately
      this.sendAck(ws, {
        requestId: message.requestId,
        $id: result.$id,
      })
    } catch (error) {
      this.sendError(ws, {
        requestId: message.requestId,
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Handle read operation
   */
  private async handleRead(ws: WebSocket, message: WSReadMessage): Promise<void> {
    const things: Record<string, ThingData | null> = {}

    for (const $id of message.$ids) {
      things[$id] = this.stateManager.get($id)
    }

    const response: WSReadResponse = {
      type: 'read_response',
      requestId: message.requestId,
      things,
    }

    ws.send(JSON.stringify(response))
  }

  /**
   * Handle update operation
   */
  private async handleUpdate(ws: WebSocket, message: WSUpdateMessage): Promise<void> {
    try {
      const result = this.stateManager.update(message.$id, message.payload)

      // Emit event if emitter is configured
      if (this.emitter) {
        this.emitter.emit('thing.updated', 'things', result, { isDelta: true })
      }

      // Send ACK immediately
      this.sendAck(ws, {
        requestId: message.requestId,
        $version: result.$version,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if it's a not found error
      if (errorMessage.includes('not found')) {
        this.sendError(ws, {
          requestId: message.requestId,
          code: ErrorCodes.NOT_FOUND,
          message: errorMessage,
        })
      } else {
        this.sendError(ws, {
          requestId: message.requestId,
          code: ErrorCodes.INTERNAL_ERROR,
          message: errorMessage,
        })
      }
    }
  }

  /**
   * Handle delete operation
   */
  private async handleDelete(ws: WebSocket, message: WSDeleteMessage): Promise<void> {
    const result = this.stateManager.delete(message.$id)

    // Emit event if emitter is configured
    if (this.emitter && result) {
      this.emitter.emit('thing.deleted', 'things', result)
    }

    // Send ACK immediately
    this.sendAck(ws, {
      requestId: message.requestId,
      success: true,
    })
  }

  /**
   * Handle batch operations
   */
  private async handleBatch(ws: WebSocket, message: WSBatchMessage): Promise<void> {
    const results: WSBatchOperationResult[] = []
    const createdItems: Array<{ $id: string }> = []

    for (const operation of message.operations) {
      try {
        switch (operation.type) {
          case 'create': {
            const payload = operation.payload as CreateThingInput
            const result = this.stateManager.create(payload)
            createdItems.push({ $id: result.$id })
            results.push({ success: true, $id: result.$id })
            break
          }
          case 'read': {
            // Read operations in batch just return success
            results.push({ success: true })
            break
          }
          case 'update': {
            const updateResult = this.stateManager.update(operation.$id!, operation.payload as Partial<ThingData>)
            results.push({ success: true, $version: updateResult.$version })
            break
          }
          case 'delete': {
            this.stateManager.delete(operation.$id!)
            results.push({ success: true })
            break
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        if (message.atomic) {
          // Atomic batch - rollback all created items
          for (const created of createdItems) {
            this.stateManager.delete(created.$id)
          }

          // Send error response
          this.sendError(ws, {
            requestId: message.requestId,
            code: ErrorCodes.BATCH_FAILED,
            message: errorMessage,
          })
          return
        }

        // Non-atomic batch - record error and continue
        results.push({ success: false, error: errorMessage })
      }
    }

    // Send batch response
    const response: WSBatchResponse = {
      type: 'batch_response',
      requestId: message.requestId,
      results,
    }

    ws.send(JSON.stringify(response))
  }

  /**
   * Send ACK response
   */
  private sendAck(
    ws: WebSocket,
    data: { requestId: string; $id?: string; $version?: number; success?: boolean }
  ): void {
    const response: WSAckResponse = {
      type: 'ack',
      requestId: data.requestId,
      ...(data.$id && { $id: data.$id }),
      ...(data.$version !== undefined && { $version: data.$version }),
      ...(data.success !== undefined && { success: data.success }),
    }

    ws.send(JSON.stringify(response))
  }

  /**
   * Send error response
   */
  private sendError(ws: WebSocket, data: { requestId: string; code: string; message: string }): void {
    const response: WSErrorResponse = {
      type: 'error',
      requestId: data.requestId,
      code: data.code,
      message: data.message,
    }

    ws.send(JSON.stringify(response))
  }
}
