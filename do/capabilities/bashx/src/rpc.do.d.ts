/**
 * Type declarations for rpc.do module
 * This is an optional peer dependency for RPC functionality
 */
declare module 'rpc.do' {
  export interface RpcTransport {
    endpoint: string
    token?: string
  }

  export function RPC<T = unknown>(transport: RpcTransport): T
  export function http(baseUrl: string, token?: string): RpcTransport
}
