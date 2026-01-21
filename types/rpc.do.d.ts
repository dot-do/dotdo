/**
 * Type declarations for rpc.do module
 *
 * rpc.do provides RPC client functionality including a CLI REPL.
 *
 * @module rpc.do
 */

declare module 'rpc.do/cli' {
  /**
   * Options for starting the REPL
   */
  export interface ReplOptions {
    /** TypeScript type definitions for autocompletion */
    types?: string
    /** Path to history file */
    historyPath?: string
  }

  /**
   * Transport interface for RPC communication
   */
  export interface ReplTransport {
    /** Send a request and receive a response */
    send<T = unknown>(request: { method: string; args: unknown[] }): Promise<{ result?: T; error?: unknown }>
    /** Initialize the transport */
    initialize?(): Promise<void>
    /** Close the transport */
    close?(): Promise<void>
  }

  /**
   * Configuration for ReplService
   */
  export interface ReplServiceConfig {
    /** Transport for RPC communication */
    transport: ReplTransport
    /** TypeScript type definitions for autocompletion */
    types?: string
    /** Path to history file */
    historyPath?: string
    /** Custom prompt string */
    prompt?: string
    /** Callback when REPL exits */
    onExit?: () => Promise<void> | void
    /** Callback when clear command is issued */
    onClear?: () => void
  }

  /**
   * REPL service class for interactive sessions
   */
  export class ReplService {
    constructor(config: ReplServiceConfig)
    /** Start the REPL */
    start(): Promise<void>
    /** Stop the REPL */
    stop(): void
  }

  /**
   * Start an interactive REPL session connected to an RPC endpoint
   * @param endpoint - The RPC endpoint URL to connect to
   * @param options - REPL configuration options
   */
  export function startRepl(endpoint: string, options?: ReplOptions): Promise<void>
}
