#!/usr/bin/env bun
/**
 * bashx CLI - Bun-native terminal client for bashx.do
 *
 * Usage:
 *   bun cli/bashx-client.ts connect <url>
 *   bun cli/bashx-client.ts exec <command>
 *   bun cli/bashx-client.ts
 */

import { createInterface, type Interface } from 'node:readline'
import { WriteStream } from 'node:tty'

export interface BashxClientOptions {
  url?: string
  sessionId?: string
  reconnect?: boolean
  reconnectDelay?: number
  maxReconnectAttempts?: number
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface StreamChunk {
  type: 'stdout' | 'stderr' | 'exit'
  data?: string
  exitCode?: number
}

type MessageHandler = (data: StreamChunk) => void
type ConnectionHandler = () => void
type ErrorHandler = (error: Error) => void

/**
 * BashxClient - WebSocket client for bashx.do
 *
 * Provides SSH-like experience for executing commands on remote bashx.do instances.
 */
export class BashxClient {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private connected = false
  private reconnectAttempts = 0
  private messageHandlers: Map<string, MessageHandler> = new Map()
  private pendingRequests: Map<string, {
    resolve: (result: CommandResult) => void
    reject: (error: Error) => void
    stdout: string
    stderr: string
  }> = new Map()

  private onConnectHandler: ConnectionHandler | null = null
  private onDisconnectHandler: ConnectionHandler | null = null
  private onErrorHandler: ErrorHandler | null = null
  private rawModeEnabled = false

  constructor(private options: BashxClientOptions = {}) {
    this.options = {
      reconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 5,
      ...options
    }
  }

  /**
   * Check if client is currently connected
   */
  get isConnected(): boolean {
    return this.connected
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Set connection event handler
   */
  onConnect(handler: ConnectionHandler): void {
    this.onConnectHandler = handler
  }

  /**
   * Set disconnection event handler
   */
  onDisconnect(handler: ConnectionHandler): void {
    this.onDisconnectHandler = handler
  }

  /**
   * Set error event handler
   */
  onError(handler: ErrorHandler): void {
    this.onErrorHandler = handler
  }

  /**
   * Connect to bashx.do WebSocket endpoint.
   */
  async connect(url?: string): Promise<void> {
    const wsUrl = url || this.options.url || 'wss://bashx.do/ws'

    return new Promise((resolve, reject) => {
      try {
        const connectUrl = this.options.sessionId
          ? `${wsUrl}?session=${this.options.sessionId}`
          : wsUrl

        this.ws = new WebSocket(connectUrl)

        this.ws.onopen = () => {
          this.connected = true
          this.reconnectAttempts = 0
          this.onConnectHandler?.()
          resolve()
        }

        this.ws.onclose = () => {
          const wasConnected = this.connected
          this.connected = false
          this.onDisconnectHandler?.()

          // Attempt reconnection if enabled
          if (
            wasConnected &&
            this.options.reconnect &&
            this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)
          ) {
            this.reconnectAttempts++
            setTimeout(() => {
              this.connect(url).catch(() => {
                // Reconnection failed, will retry if attempts remain
              })
            }, this.options.reconnectDelay)
          }
        }

        this.ws.onerror = (event) => {
          const error = new Error('WebSocket error')
          this.onErrorHandler?.(error)
          if (!this.connected) {
            reject(error)
          }
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as {
        type: string
        requestId?: string
        sessionId?: string
        data?: string
        exitCode?: number
        error?: string
      }

      // Handle session assignment
      if (message.type === 'session' && message.sessionId) {
        this.sessionId = message.sessionId
        return
      }

      // Handle stream chunks for specific request
      if (message.requestId) {
        const pending = this.pendingRequests.get(message.requestId)
        const handler = this.messageHandlers.get(message.requestId)

        if (message.type === 'stdout' && message.data) {
          if (pending) pending.stdout += message.data
          handler?.({ type: 'stdout', data: message.data })
        } else if (message.type === 'stderr' && message.data) {
          if (pending) pending.stderr += message.data
          handler?.({ type: 'stderr', data: message.data })
        } else if (message.type === 'exit') {
          const exitCode = message.exitCode ?? 0
          handler?.({ type: 'exit', exitCode })

          if (pending) {
            pending.resolve({
              stdout: pending.stdout,
              stderr: pending.stderr,
              exitCode
            })
            this.pendingRequests.delete(message.requestId)
          }
          this.messageHandlers.delete(message.requestId)
        } else if (message.type === 'error' && message.error) {
          if (pending) {
            pending.reject(new Error(message.error))
            this.pendingRequests.delete(message.requestId)
          }
          this.messageHandlers.delete(message.requestId)
        }
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Send a message through WebSocket
   */
  private send(message: object): void {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to bashx.do')
    }
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Execute a command and return result.
   */
  async execute(command: string): Promise<CommandResult> {
    if (!this.connected) {
      throw new Error('Not connected to bashx.do')
    }

    const requestId = this.generateRequestId()

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        stdout: '',
        stderr: ''
      })

      this.send({
        type: 'execute',
        requestId,
        command
      })
    })
  }

  /**
   * Stream command output in real-time.
   */
  async *stream(command: string): AsyncGenerator<StreamChunk, void, unknown> {
    if (!this.connected) {
      throw new Error('Not connected to bashx.do')
    }

    const requestId = this.generateRequestId()
    const chunks: StreamChunk[] = []
    let done = false
    let error: Error | null = null

    // Create a promise that resolves when we receive next chunk
    let resolveNext: (() => void) | null = null

    this.messageHandlers.set(requestId, (chunk) => {
      chunks.push(chunk)
      if (chunk.type === 'exit') {
        done = true
      }
      resolveNext?.()
    })

    // Handle errors
    const originalHandler = this.messageHandlers.get(requestId)
    this.pendingRequests.set(requestId, {
      resolve: () => { done = true },
      reject: (err) => { error = err; done = true; resolveNext?.() },
      stdout: '',
      stderr: ''
    })
    if (originalHandler) {
      this.messageHandlers.set(requestId, originalHandler)
    }

    this.send({
      type: 'execute',
      requestId,
      command,
      stream: true
    })

    while (!done) {
      if (chunks.length > 0) {
        yield chunks.shift()!
      } else {
        // Wait for next chunk
        await new Promise<void>((resolve) => {
          resolveNext = resolve
        })
      }
    }

    // Yield remaining chunks
    while (chunks.length > 0) {
      yield chunks.shift()!
    }

    if (error) {
      throw error
    }

    this.messageHandlers.delete(requestId)
    this.pendingRequests.delete(requestId)
  }

  /**
   * Enable raw mode for interactive applications.
   * This allows character-by-character input handling.
   */
  enableRawMode(): boolean {
    if (process.stdin instanceof WriteStream) {
      return false // stdin is not a TTY
    }

    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void; isRaw?: boolean }
    if (stdin.setRawMode && !stdin.isRaw) {
      stdin.setRawMode(true)
      this.rawModeEnabled = true
      return true
    }
    return false
  }

  /**
   * Disable raw mode.
   */
  disableRawMode(): void {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void; isRaw?: boolean }
    if (stdin.setRawMode && stdin.isRaw) {
      stdin.setRawMode(false)
      this.rawModeEnabled = false
    }
  }

  /**
   * Check if raw mode is enabled
   */
  isRawMode(): boolean {
    return this.rawModeEnabled
  }

  /**
   * Start interactive REPL.
   */
  async repl(): Promise<void> {
    const rl: Interface = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'bashx> ',
      terminal: true
    })

    console.log('bashx.do CLI - Interactive Shell')
    console.log('Type "exit" to quit, "help" for commands\n')

    rl.prompt()

    for await (const line of rl) {
      const trimmed = line.trim()

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('Goodbye!')
        break
      }

      if (trimmed === 'help') {
        console.log(`
Available commands:
  help          - Show this help message
  exit, quit    - Exit the shell
  session       - Show current session ID
  reconnect     - Reconnect to server
  raw           - Toggle raw mode for interactive apps
  <command>     - Execute bash command
`)
        rl.prompt()
        continue
      }

      if (trimmed === 'session') {
        console.log(`Session ID: ${this.sessionId || 'none'}`)
        rl.prompt()
        continue
      }

      if (trimmed === 'reconnect') {
        try {
          this.disconnect()
          await this.connect()
          console.log('Reconnected successfully')
        } catch (error) {
          console.error('Reconnection failed:', error)
        }
        rl.prompt()
        continue
      }

      if (trimmed === 'raw') {
        if (this.rawModeEnabled) {
          this.disableRawMode()
          console.log('Raw mode disabled')
        } else {
          if (this.enableRawMode()) {
            console.log('Raw mode enabled')
          } else {
            console.log('Raw mode not available (not a TTY)')
          }
        }
        rl.prompt()
        continue
      }

      if (!trimmed) {
        rl.prompt()
        continue
      }

      try {
        // Stream output for better UX
        for await (const chunk of this.stream(trimmed)) {
          if (chunk.type === 'stdout' && chunk.data) {
            process.stdout.write(chunk.data)
          } else if (chunk.type === 'stderr' && chunk.data) {
            process.stderr.write(chunk.data)
          }
        }
        // Ensure newline after output
        if (!trimmed.endsWith('\n')) {
          console.log()
        }
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error)
      }

      rl.prompt()
    }

    rl.close()
    this.disconnect()
  }

  /**
   * Disconnect and cleanup.
   */
  disconnect(): void {
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Disconnected'))
    }
    this.pendingRequests.clear()
    this.messageHandlers.clear()

    // Disable raw mode if enabled
    if (this.rawModeEnabled) {
      this.disableRawMode()
    }

    this.ws?.close()
    this.ws = null
    this.connected = false
    this.sessionId = null
  }
}

// CLI entry point
if (import.meta.main) {
  const client = new BashxClient()
  const [command, ...args] = Bun.argv.slice(2)

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nDisconnecting...')
    client.disconnect()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    client.disconnect()
    process.exit(0)
  })

  try {
    if (command === 'connect') {
      await client.connect(args[0])
      console.log(`Connected to ${args[0] || 'wss://bashx.do/ws'}`)
      console.log(`Session ID: ${client.getSessionId()}`)
      await client.repl()
    } else if (command === 'exec') {
      if (!args.length) {
        console.error('Usage: bashx exec <command>')
        process.exit(1)
      }
      await client.connect()
      const result = await client.execute(args.join(' '))
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      client.disconnect()
      process.exit(result.exitCode)
    } else if (command === 'help' || command === '--help' || command === '-h') {
      console.log(`
bashx.do CLI - Bun-native terminal client

Usage:
  bashx                    Start interactive REPL
  bashx connect <url>      Connect to specific server
  bashx exec <command>     Execute command and exit
  bashx help               Show this help message

Environment:
  BASHX_URL               Default WebSocket URL (default: wss://bashx.do/ws)
  BASHX_SESSION           Session ID for reconnection

Examples:
  bashx                    Start interactive shell
  bashx connect ws://localhost:8787/ws
  bashx exec "ls -la"     Execute command
`)
    } else if (command === 'version' || command === '--version' || command === '-v') {
      console.log('bashx.do CLI v0.1.0')
    } else {
      // Default: start REPL
      const url = process.env.BASHX_URL
      const sessionId = process.env.BASHX_SESSION

      const opts: BashxClientOptions = {}
      if (url) opts.url = url
      if (sessionId) opts.sessionId = sessionId

      const replClient = new BashxClient(opts)
      await replClient.connect()
      await replClient.repl()
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    client.disconnect()
    process.exit(1)
  }
}
