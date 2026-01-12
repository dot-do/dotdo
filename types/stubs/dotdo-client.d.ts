/**
 * Type stub for @dotdo/client module
 * Used during build when @dotdo/client package is not available
 */
declare module '@dotdo/client' {
  export interface ChainStep {
    method: string
    args: unknown[]
  }

  export interface RpcError {
    code: string
    message: string
  }

  export type RpcPromise<T> = Promise<T>

  export interface RpcClient {
    call<T>(method: string, ...args: unknown[]): RpcPromise<T>
  }

  export interface SdkConfig {
    baseUrl?: string
    timeout?: number
  }

  export interface DOClient {
    [key: string]: (...args: unknown[]) => RpcPromise<unknown>
  }

  export interface ClientConfig {
    baseUrl?: string
    timeout?: number
  }

  export type ConnectionState = 'connected' | 'disconnected' | 'connecting'

  export interface ReconnectConfig {
    maxRetries?: number
    backoffMs?: number
  }

  export interface AuthConfig {
    token?: string
    apiKey?: string
  }

  export interface RPCError extends Error {
    code: string
  }

  export interface SubscriptionHandle {
    unsubscribe(): void
  }

  export interface PipelineStep {
    method: string
    args: unknown[]
  }

  export const $: DOClient
  export const $Context: unknown
  export function configure(config: SdkConfig): void
  export function disposeSession(): void
  export function disposeAllSessions(): void
  export function createClient(config?: ClientConfig): DOClient

  const defaultExport: DOClient
  export default defaultExport
}
