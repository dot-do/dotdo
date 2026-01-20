/**
 * Extended Cloudflare Workers type wrappers
 *
 * These types extend the base @cloudflare/workers-types definitions
 * to include methods that exist in the runtime but are missing from
 * the official type definitions.
 *
 * This avoids the need for `as unknown as` patterns throughout the codebase.
 */

/**
 * Extended DurableObjectStorage with alarm methods
 *
 * The Cloudflare runtime supports alarm methods on DurableObjectStorage,
 * but they may not be fully typed in @cloudflare/workers-types.
 */
export interface DurableObjectStorageExtended extends DurableObjectStorage {
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number | Date): Promise<void>
  deleteAlarm(): Promise<void>
}

/**
 * Extended DurableObjectState with typed storage
 */
export interface DurableObjectStateExtended extends DurableObjectState {
  storage: DurableObjectStorageExtended
}

/**
 * WebSocket response for upgrade
 *
 * When a Response is created with status 101 and a webSocket property,
 * it becomes a WebSocket upgrade response.
 */
export interface WebSocketUpgradeResponse extends Response {
  webSocket: WebSocket
}

/**
 * Type guard for WebSocket upgrade response
 *
 * @param res - Response to check
 * @returns true if the response has a webSocket property
 */
export function isWebSocketResponse(res: Response): res is WebSocketUpgradeResponse {
  return 'webSocket' in res
}

/**
 * Mock-compatible WebSocket interface for testing
 *
 * Extends the base WebSocket type with additional properties
 * that may be present in mock implementations.
 */
export interface MockableWebSocket extends WebSocket {
  sentMessages?: string[]
  receivedMessages?: string[]
}

/**
 * Type helper for setInterval in Cloudflare Workers
 *
 * In the Workers runtime, setInterval returns a number,
 * but TypeScript may infer NodeJS.Timeout in some contexts.
 */
export type IntervalId = number

/**
 * Cast setInterval result to IntervalId safely
 */
export function asIntervalId(id: ReturnType<typeof setInterval>): IntervalId {
  return id as unknown as IntervalId
}
