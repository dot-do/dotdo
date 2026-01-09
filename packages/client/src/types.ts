/**
 * Shared types for @dotdo/client SDK
 */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'

export interface ReconnectConfig {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
  jitter?: number
}

export interface AuthConfig {
  token?: string
}

export interface ClientConfig {
  timeout?: number
  batchWindow?: number
  maxBatchSize?: number
  batching?: boolean
  offlineQueueLimit?: number
  reconnect?: ReconnectConfig
  auth?: AuthConfig
}

export interface RPCError {
  code: string
  message: string
  stage?: number
}

export interface SubscriptionHandle {
  unsubscribe(): void
}

export interface PipelineStep {
  method: string
  params: unknown[]
}

export interface RPCMessage {
  id: string
  method?: string
  params?: unknown[]
  pipeline?: PipelineStep[]
  batch?: RPCMessage[]
  type?: 'subscribe' | 'unsubscribe'
  channel?: string
}

export interface RPCResponse {
  id: string
  result?: unknown
  error?: RPCError
  batch?: RPCResponse[]
  type?: 'event'
  channel?: string
  data?: unknown
}

export interface PendingCall {
  id: string
  resolve: (value: unknown) => void
  reject: (error: RPCError) => void
  message: RPCMessage
  timeoutId?: ReturnType<typeof setTimeout>
}

export interface Subscription {
  channel: string
  callbacks: Set<(data: unknown) => void>
}

export type EventCallback<T = unknown> = (data: T) => void
export type ConnectionStateCallback = (state: ConnectionState) => void
export type QueueChangeCallback = (count: number) => void
export type CloseCallback = (reason: string) => void

export interface ClientEvents {
  connectionStateChange: ConnectionStateCallback
  queueChange: QueueChangeCallback
  close: CloseCallback
  error: EventCallback<Error>
}


/**
 * Full client interface with all features
 */
export type DOClient<TMethods, TEvents = Record<string, unknown>> = MethodProxy<TMethods> & {
  connectionState: ConnectionState
  config: ClientConfig
  queuedCallCount: number
  on<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void
  off<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void
  subscribe<K extends keyof TEvents>(
    channel: K & string,
    callback: (data: TEvents[K]) => void
  ): SubscriptionHandle
  configure(config: Partial<ClientConfig>): void
  clearQueue(): void
  disconnect(): void
}

type MethodProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R> & MethodProxy<R>
    : never
}
