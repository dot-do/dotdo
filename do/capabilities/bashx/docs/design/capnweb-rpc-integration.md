# Cap'n Web RPC Integration Design

**Issue:** bashx-wtoq
**Status:** Design Document
**Date:** 2026-01-11

## Overview

This document describes how to integrate Cap'n Web RPC into the @dotdo/bashx core library to enable zero-dependency, SSH-like streaming RPC for shell execution.

### Goals

1. **Zero Cloudflare Dependencies**: All RPC code lives in `core/rpc/` with no Workers-specific imports
2. **Pass-by-Reference Streams**: Use RpcTarget pattern for streaming stdout/stderr
3. **Promise Pipelining**: Batch multiple shell operations in single round trips
4. **Bidirectional Callbacks**: Server can call client callbacks (progress, prompts)
5. **Disposal Semantics**: Clean up streams and processes when stubs are disposed
6. **Workers RPC Compatible**: Transport layer works with Workers RPC

### Non-Goals

- Full SSH protocol implementation (use existing SSH libraries)
- PTY allocation (handled by platform-specific backends)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client                                   │
├─────────────────────────────────────────────────────────────────┤
│  RpcSession<ShellApi>                                           │
│    ├── stub.exec("ls", ["-la"])                                │
│    ├── stub.spawn("npm", ["run", "dev"])                       │
│    │     └── returns RpcStub<ShellStream>                      │
│    └── stub.run("set -e; cd /app; npm install")               │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket / HTTP / stdio
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Server                                   │
├─────────────────────────────────────────────────────────────────┤
│  ShellApiImpl extends RpcTarget                                 │
│    ├── exec() → ShellResult                                    │
│    ├── spawn() → ShellStream (pass-by-reference)              │
│    └── run() → ShellResult                                     │
├─────────────────────────────────────────────────────────────────┤
│  ShellStream extends RpcTarget                                  │
│    ├── write(data) → void                                      │
│    ├── onData(callback) → void                                 │
│    ├── onExit(callback) → void                                 │
│    ├── kill(signal) → void                                     │
│    └── [Symbol.dispose]() → cleanup                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Type Definitions

### core/rpc/types.ts

```typescript
/**
 * Cap'n Web RPC Types for @dotdo/bashx
 *
 * These types define the RPC interface for shell execution.
 * They are designed to work with Cap'n Web's pass-by-reference
 * semantics for streaming operations.
 */

// Re-export Cap'n Web types for convenience
export type { RpcTarget, RpcStub, RpcPromise, RpcSession } from 'capnweb'

/**
 * Shell execution result (pass-by-value).
 * Returned from exec() and run() methods.
 */
export interface ShellResult {
  exitCode: number
  stdout: string
  stderr: string
  success: boolean
  duration?: number
  signal?: string
}

/**
 * Options for shell execution.
 */
export interface ShellExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  maxOutput?: number
  shell?: string
  stdin?: string
}

/**
 * Signal types for process termination.
 */
export type Signal = 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP'

/**
 * Callback for stream data events.
 * Functions are pass-by-reference in Cap'n Web.
 */
export type DataCallback = (chunk: Uint8Array) => void

/**
 * Callback for exit events.
 */
export type ExitCallback = (exitCode: number, signal?: string) => void

/**
 * ShellStream interface - pass-by-reference streaming.
 *
 * This interface extends RpcTarget for pass-by-reference semantics.
 * When spawn() returns a ShellStream, the client receives an RpcStub<ShellStream>
 * that proxies all method calls back to the server.
 *
 * @example
 * ```typescript
 * // Client side
 * using stream = await api.spawn('npm', ['run', 'dev'])
 *
 * // Register callbacks (bidirectional RPC)
 * stream.onData((chunk) => console.log(new TextDecoder().decode(chunk)))
 * stream.onExit((code) => console.log('Exit:', code))
 *
 * // Write to stdin
 * stream.write(new TextEncoder().encode('input\n'))
 *
 * // Kill the process
 * stream.kill('SIGTERM')
 *
 * // Automatic cleanup when `using` scope ends
 * ```
 */
export interface ShellStream {
  /** Process ID of the spawned process */
  readonly pid: number

  /** Write data to the process stdin */
  write(data: Uint8Array): void

  /** Close stdin to signal end of input */
  closeStdin(): void

  /** Register callback for stdout/stderr data */
  onData(callback: DataCallback): void

  /** Register callback for stderr only */
  onStderr(callback: DataCallback): void

  /** Register callback for process exit */
  onExit(callback: ExitCallback): void

  /** Kill the process with signal */
  kill(signal?: Signal): void

  /** Wait for process to complete */
  wait(): Promise<ShellResult>
}

/**
 * Main Shell API interface.
 *
 * This is the server-side interface that clients call.
 * Methods returning RpcTarget subclasses (like ShellStream)
 * are automatically passed by reference.
 */
export interface ShellApi {
  /**
   * Execute a command and wait for completion.
   * Returns pass-by-value result.
   */
  exec(
    command: string,
    args?: string[],
    options?: ShellExecOptions
  ): Promise<ShellResult>

  /**
   * Spawn a command for streaming execution.
   * Returns pass-by-reference stream.
   */
  spawn(
    command: string,
    args?: string[],
    options?: ShellExecOptions
  ): Promise<ShellStream>

  /**
   * Run a shell script.
   * Returns pass-by-value result.
   */
  run(
    script: string,
    options?: ShellExecOptions
  ): Promise<ShellResult>

  /**
   * Get current working directory.
   */
  cwd(): Promise<string>

  /**
   * Change working directory.
   */
  cd(path: string): Promise<void>

  /**
   * Get environment variables.
   */
  env(): Promise<Record<string, string>>

  /**
   * Set environment variable.
   */
  setEnv(key: string, value: string): Promise<void>
}

/**
 * Client-side stub type.
 * This is what callers actually interact with.
 */
export type ShellApiStub = RpcStub<ShellApi>

/**
 * Stream stub type.
 * This is what callers get from spawn().
 */
export type ShellStreamStub = RpcStub<ShellStream>
```

---

## Transport Abstraction

### core/rpc/transport.ts

```typescript
/**
 * Transport Abstraction Layer
 *
 * Defines abstract interfaces for RPC transport that can be
 * implemented for different environments (WebSocket, stdio, HTTP).
 */

/**
 * Low-level transport interface compatible with Cap'n Web.
 *
 * Cap'n Web's RpcSession accepts any transport that implements
 * these methods. This allows us to create custom transports
 * for stdio, WebSocket, etc.
 */
export interface RpcTransport {
  /**
   * Send a message through the transport.
   * Messages are JSON-encoded by Cap'n Web.
   */
  send(message: string): Promise<void>

  /**
   * Receive the next message from the transport.
   * Should block until a message is available.
   */
  receive(): Promise<string>

  /**
   * Abort the transport with an error.
   * Called when the RPC session encounters an error.
   */
  abort?(reason: unknown): void

  /**
   * Close the transport gracefully.
   */
  close?(): Promise<void>
}

/**
 * Transport factory options.
 */
export interface TransportOptions {
  /** Connection timeout in ms */
  timeout?: number
  /** Reconnection options */
  reconnect?: {
    enabled: boolean
    maxAttempts?: number
    backoff?: number
  }
}

/**
 * Abstract transport factory.
 * Implementations create transports for specific protocols.
 */
export interface TransportFactory {
  /**
   * Create a transport to the given endpoint.
   */
  connect(endpoint: string, options?: TransportOptions): Promise<RpcTransport>

  /**
   * Check if this factory handles the given endpoint.
   */
  canHandle(endpoint: string): boolean
}
```

### core/rpc/transports/websocket.ts

```typescript
/**
 * WebSocket Transport Implementation
 *
 * Uses standard WebSocket API available in browsers,
 * Node.js, Deno, Bun, and Cloudflare Workers.
 */

import type { RpcTransport, TransportOptions } from '../transport.js'

export class WebSocketTransport implements RpcTransport {
  #socket: WebSocket
  #messageQueue: string[] = []
  #waiters: Array<(message: string) => void> = []
  #closed = false
  #error: unknown = null

  constructor(socket: WebSocket) {
    this.#socket = socket

    socket.addEventListener('message', (event) => {
      const message = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data)

      const waiter = this.#waiters.shift()
      if (waiter) {
        waiter(message)
      } else {
        this.#messageQueue.push(message)
      }
    })

    socket.addEventListener('close', () => {
      this.#closed = true
      // Reject all pending waiters
      for (const waiter of this.#waiters) {
        // This will cause receive() to throw
      }
    })

    socket.addEventListener('error', (event) => {
      this.#error = event
    })
  }

  async send(message: string): Promise<void> {
    if (this.#closed) {
      throw new Error('WebSocket is closed')
    }
    this.#socket.send(message)
  }

  async receive(): Promise<string> {
    // Return queued message if available
    const queued = this.#messageQueue.shift()
    if (queued) return queued

    if (this.#closed) {
      throw new Error('WebSocket is closed')
    }

    // Wait for next message
    return new Promise((resolve, reject) => {
      this.#waiters.push(resolve)
    })
  }

  abort(reason: unknown): void {
    this.#error = reason
    this.#socket.close(1000, String(reason))
  }

  async close(): Promise<void> {
    this.#socket.close(1000, 'Client closed')
    this.#closed = true
  }
}

/**
 * Create WebSocket transport to endpoint.
 */
export async function createWebSocketTransport(
  url: string,
  options?: TransportOptions
): Promise<WebSocketTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)

    const timeout = options?.timeout ?? 30000
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`WebSocket connection timeout after ${timeout}ms`))
    }, timeout)

    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(new WebSocketTransport(socket))
    })

    socket.addEventListener('error', (event) => {
      clearTimeout(timer)
      reject(new Error('WebSocket connection failed'))
    })
  })
}
```

### core/rpc/transports/stdio.ts

```typescript
/**
 * Stdio Transport Implementation
 *
 * Uses standard input/output for RPC communication.
 * Ideal for MCP (Model Context Protocol) and CLI tools.
 *
 * Protocol: JSON-RPC over newline-delimited JSON (NDJSON)
 */

import type { RpcTransport } from '../transport.js'

/**
 * Abstract stream interfaces for stdio.
 * These are implemented differently in Node.js, Deno, and Bun.
 */
export interface ReadableStream {
  on(event: 'data', callback: (chunk: Buffer | Uint8Array) => void): void
  on(event: 'end', callback: () => void): void
  on(event: 'error', callback: (error: Error) => void): void
}

export interface WritableStream {
  write(data: string | Uint8Array): boolean
  end(): void
}

export class StdioTransport implements RpcTransport {
  #stdin: ReadableStream
  #stdout: WritableStream
  #messageQueue: string[] = []
  #waiters: Array<(message: string) => void> = []
  #buffer = ''
  #closed = false

  constructor(stdin: ReadableStream, stdout: WritableStream) {
    this.#stdin = stdin
    this.#stdout = stdout

    // Parse NDJSON from stdin
    stdin.on('data', (chunk) => {
      const text = typeof chunk === 'string'
        ? chunk
        : new TextDecoder().decode(chunk)

      this.#buffer += text

      // Process complete lines
      let newlineIndex: number
      while ((newlineIndex = this.#buffer.indexOf('\n')) !== -1) {
        const line = this.#buffer.slice(0, newlineIndex)
        this.#buffer = this.#buffer.slice(newlineIndex + 1)

        if (line.trim()) {
          const waiter = this.#waiters.shift()
          if (waiter) {
            waiter(line)
          } else {
            this.#messageQueue.push(line)
          }
        }
      }
    })

    stdin.on('end', () => {
      this.#closed = true
    })
  }

  async send(message: string): Promise<void> {
    if (this.#closed) {
      throw new Error('Stdio transport is closed')
    }
    // Write as NDJSON
    this.#stdout.write(message + '\n')
  }

  async receive(): Promise<string> {
    const queued = this.#messageQueue.shift()
    if (queued) return queued

    if (this.#closed) {
      throw new Error('Stdio transport is closed')
    }

    return new Promise((resolve) => {
      this.#waiters.push(resolve)
    })
  }

  abort(reason: unknown): void {
    this.#closed = true
    this.#stdout.end()
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#stdout.end()
  }
}
```

---

## Server Implementation

### core/rpc/server/shell-stream.ts

```typescript
/**
 * ShellStream Implementation
 *
 * Extends RpcTarget for pass-by-reference streaming.
 * Wraps platform-specific process execution.
 */

import { RpcTarget } from 'capnweb'
import type {
  ShellStream,
  ShellResult,
  Signal,
  DataCallback,
  ExitCallback
} from '../types.js'

/**
 * Platform-specific process interface.
 * Implemented by Node.js ChildProcess, Bun subprocess, etc.
 */
export interface ProcessHandle {
  pid: number
  stdin: { write(data: Uint8Array): void; end(): void }
  stdout: { on(event: 'data', cb: (data: Uint8Array) => void): void }
  stderr: { on(event: 'data', cb: (data: Uint8Array) => void): void }
  on(event: 'exit', cb: (code: number, signal: string | null) => void): void
  kill(signal?: string): boolean
}

export class ShellStreamImpl extends RpcTarget implements ShellStream {
  #process: ProcessHandle
  #dataCallbacks: DataCallback[] = []
  #stderrCallbacks: DataCallback[] = []
  #exitCallbacks: ExitCallback[] = []
  #exitResult: { code: number; signal?: string } | null = null
  #stdout: Uint8Array[] = []
  #stderr: Uint8Array[] = []
  #startTime: number

  constructor(process: ProcessHandle) {
    super()
    this.#process = process
    this.#startTime = Date.now()

    // Wire up stdout
    process.stdout.on('data', (chunk) => {
      this.#stdout.push(chunk)
      for (const cb of this.#dataCallbacks) {
        cb(chunk)
      }
    })

    // Wire up stderr
    process.stderr.on('data', (chunk) => {
      this.#stderr.push(chunk)
      for (const cb of this.#stderrCallbacks) {
        cb(chunk)
      }
      // Also send to general data callbacks
      for (const cb of this.#dataCallbacks) {
        cb(chunk)
      }
    })

    // Wire up exit
    process.on('exit', (code, signal) => {
      this.#exitResult = {
        code: code ?? 1,
        signal: signal ?? undefined
      }
      for (const cb of this.#exitCallbacks) {
        cb(this.#exitResult.code, this.#exitResult.signal)
      }
    })
  }

  get pid(): number {
    return this.#process.pid
  }

  write(data: Uint8Array): void {
    this.#process.stdin.write(data)
  }

  closeStdin(): void {
    this.#process.stdin.end()
  }

  onData(callback: DataCallback): void {
    this.#dataCallbacks.push(callback)
    // Send any buffered data
    for (const chunk of this.#stdout) {
      callback(chunk)
    }
    for (const chunk of this.#stderr) {
      callback(chunk)
    }
  }

  onStderr(callback: DataCallback): void {
    this.#stderrCallbacks.push(callback)
    // Send any buffered stderr
    for (const chunk of this.#stderr) {
      callback(chunk)
    }
  }

  onExit(callback: ExitCallback): void {
    if (this.#exitResult) {
      // Already exited, call immediately
      callback(this.#exitResult.code, this.#exitResult.signal)
    } else {
      this.#exitCallbacks.push(callback)
    }
  }

  kill(signal: Signal = 'SIGTERM'): void {
    this.#process.kill(signal)
  }

  async wait(): Promise<ShellResult> {
    if (this.#exitResult) {
      return this.#buildResult()
    }

    return new Promise((resolve) => {
      this.onExit(() => {
        resolve(this.#buildResult())
      })
    })
  }

  #buildResult(): ShellResult {
    const decoder = new TextDecoder()
    return {
      exitCode: this.#exitResult?.code ?? 1,
      stdout: decoder.decode(this.#concat(this.#stdout)),
      stderr: decoder.decode(this.#concat(this.#stderr)),
      success: this.#exitResult?.code === 0,
      duration: Date.now() - this.#startTime,
      signal: this.#exitResult?.signal
    }
  }

  #concat(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * Cleanup when the remote stub is disposed.
   * Cap'n Web calls this automatically when the client
   * disposes their stub or the connection closes.
   */
  [Symbol.dispose](): void {
    // Kill process if still running
    if (!this.#exitResult) {
      this.kill('SIGTERM')
    }
    // Clear callback references
    this.#dataCallbacks = []
    this.#stderrCallbacks = []
    this.#exitCallbacks = []
  }
}
```

### core/rpc/server/shell-api.ts

```typescript
/**
 * ShellApi Implementation
 *
 * Main RPC server interface for shell execution.
 * Extends RpcTarget so clients get pass-by-reference access.
 */

import { RpcTarget } from 'capnweb'
import type {
  ShellApi,
  ShellResult,
  ShellStream,
  ShellExecOptions
} from '../types.js'
import type { ShellBackend } from '../../backend.js'
import { ShellStreamImpl, type ProcessHandle } from './shell-stream.js'

/**
 * Platform-specific spawn function.
 * Different implementations for Node.js, Bun, Deno, etc.
 */
export type SpawnFunction = (
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    shell?: boolean | string
  }
) => ProcessHandle

export class ShellApiImpl extends RpcTarget implements ShellApi {
  #cwd: string
  #env: Record<string, string>
  #backend: ShellBackend
  #spawn: SpawnFunction

  constructor(options: {
    cwd?: string
    env?: Record<string, string>
    backend: ShellBackend
    spawn: SpawnFunction
  }) {
    super()
    this.#cwd = options.cwd ?? process.cwd?.() ?? '/'
    this.#env = { ...process.env, ...options.env } as Record<string, string>
    this.#backend = options.backend
    this.#spawn = options.spawn
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ShellExecOptions
  ): Promise<ShellResult> {
    // Use backend for simple execution
    const fullCommand = [command, ...args].join(' ')
    const result = await this.#backend.execute(fullCommand, {
      cwd: options?.cwd ?? this.#cwd,
      env: { ...this.#env, ...options?.env },
      timeout: options?.timeout,
      maxOutput: options?.maxOutput,
      shell: options?.shell,
    })

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.success,
      duration: result.duration,
      signal: result.signal,
    }
  }

  async spawn(
    command: string,
    args: string[] = [],
    options?: ShellExecOptions
  ): Promise<ShellStream> {
    const process = this.#spawn(command, args, {
      cwd: options?.cwd ?? this.#cwd,
      env: { ...this.#env, ...options?.env },
      shell: options?.shell ? options.shell : false,
    })

    // Return ShellStreamImpl which extends RpcTarget
    // Cap'n Web will pass this by reference to the client
    return new ShellStreamImpl(process)
  }

  async run(
    script: string,
    options?: ShellExecOptions
  ): Promise<ShellResult> {
    // Execute script via backend
    const result = await this.#backend.execute(script, {
      cwd: options?.cwd ?? this.#cwd,
      env: { ...this.#env, ...options?.env },
      timeout: options?.timeout,
      maxOutput: options?.maxOutput,
      shell: options?.shell ?? '/bin/bash',
    })

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.success,
      duration: result.duration,
      signal: result.signal,
    }
  }

  async cwd(): Promise<string> {
    return this.#cwd
  }

  async cd(path: string): Promise<void> {
    // Resolve relative paths
    if (!path.startsWith('/')) {
      path = `${this.#cwd}/${path}`
    }
    // Normalize path (remove . and ..)
    const parts = path.split('/').filter(Boolean)
    const normalized: string[] = []
    for (const part of parts) {
      if (part === '..') {
        normalized.pop()
      } else if (part !== '.') {
        normalized.push(part)
      }
    }
    this.#cwd = '/' + normalized.join('/')
  }

  async env(): Promise<Record<string, string>> {
    return { ...this.#env }
  }

  async setEnv(key: string, value: string): Promise<void> {
    this.#env[key] = value
  }

  /**
   * Cleanup when the API stub is disposed.
   */
  [Symbol.dispose](): void {
    // Nothing to clean up at the API level
    // Individual ShellStreams handle their own cleanup
  }
}
```

---

## Client Usage Examples

### Basic Execution

```typescript
import { newWebSocketRpcSession } from 'capnweb'
import type { ShellApi } from '@dotdo/bashx/rpc'

// Connect to shell server
using api = newWebSocketRpcSession<ShellApi>('wss://bashx.do/api')

// Execute command (returns pass-by-value result)
const result = await api.exec('ls', ['-la'])
console.log(result.stdout)

// Run script
const build = await api.run(`
  set -e
  cd /app
  npm install
  npm run build
`)

if (!build.success) {
  throw new Error('Build failed: ' + build.stderr)
}
```

### Streaming with Callbacks

```typescript
import { newWebSocketRpcSession } from 'capnweb'
import type { ShellApi, ShellStream } from '@dotdo/bashx/rpc'

using api = newWebSocketRpcSession<ShellApi>('wss://bashx.do/api')

// Spawn returns pass-by-reference stream
using stream = await api.spawn('npm', ['run', 'dev'])

// Register callbacks (these call back to our client!)
stream.onData((chunk) => {
  process.stdout.write(chunk)
})

stream.onExit((code, signal) => {
  console.log(`Process exited with code ${code}`)
})

// Wait for Ctrl+C, then cleanup
process.on('SIGINT', () => {
  stream.kill('SIGTERM')
})

// `using` automatically disposes when scope ends
```

### Promise Pipelining

```typescript
import { newHttpBatchRpcSession } from 'capnweb'
import type { ShellApi } from '@dotdo/bashx/rpc'

using api = newHttpBatchRpcSession<ShellApi>('https://bashx.do/api')

// These are pipelined - single network round trip!
const gitStatus = api.exec('git', ['status', '--short'])
const nodeVersion = api.exec('node', ['--version'])
const npmVersion = api.exec('npm', ['--version'])

// All execute in parallel, await results
const [status, node, npm] = await Promise.all([
  gitStatus,
  nodeVersion,
  npmVersion
])

console.log('Git:', status.stdout)
console.log('Node:', node.stdout)
console.log('npm:', npm.stdout)
```

### MCP Integration via Stdio

```typescript
import { RpcSession } from 'capnweb'
import { StdioTransport } from '@dotdo/bashx/rpc/transports/stdio'
import { ShellApiImpl } from '@dotdo/bashx/rpc/server/shell-api'
import type { ShellApi } from '@dotdo/bashx/rpc'

// Server side (MCP tool provider)
const transport = new StdioTransport(process.stdin, process.stdout)
const session = new RpcSession<never>(transport, new ShellApiImpl({
  backend: myBackend,
  spawn: nodeSpawn,
}))

// Client side (MCP client)
const transport = new StdioTransport(stdin, stdout)
const session = new RpcSession<ShellApi>(transport, null)
const api = session.getRemoteMain()

await api.exec('ls', ['-la'])
```

---

## Integration with Existing bashx

### Extending ShellBackend

The existing `ShellBackend` interface from `core/backend.ts` provides `execute()` for simple command execution. The RPC layer wraps this and adds streaming via `spawn()`.

```typescript
// Existing backend interface (unchanged)
export interface ShellBackend {
  execute(command: string, options?: ShellOptions): Promise<ShellResult>
  isReady(): Promise<boolean>
  getInfo(): Promise<BackendInfo>
}

// RPC layer adds streaming on top
export interface ShellApi extends ShellBackend {
  spawn(command: string, args?: string[], options?: ShellExecOptions): Promise<ShellStream>
  // ... other methods
}
```

### Module Structure

```
core/
  rpc/
    index.ts           # Main exports
    types.ts           # Type definitions
    transport.ts       # Transport abstraction
    transports/
      websocket.ts     # WebSocket transport
      stdio.ts         # Stdio transport
      http.ts          # HTTP batch transport
    server/
      shell-api.ts     # ShellApi implementation
      shell-stream.ts  # ShellStream implementation
    client/
      index.ts         # Client helpers
```

### Package.json Updates

```json
{
  "name": "@dotdo/bashx",
  "exports": {
    ".": "./index.ts",
    "./rpc": "./rpc/index.ts",
    "./rpc/transports/websocket": "./rpc/transports/websocket.ts",
    "./rpc/transports/stdio": "./rpc/transports/stdio.ts",
    // ... existing exports
  },
  "dependencies": {
    "capnweb": "^0.4.0"
  }
}
```

---

## Security Considerations

### Authentication

Cap'n Web recommends in-band authentication since WebSocket doesn't support custom headers:

```typescript
interface AuthenticatedShellApi extends ShellApi {
  authenticate(token: string): Promise<ShellApi>
}

// Server
class AuthenticatedShellApiImpl extends RpcTarget implements AuthenticatedShellApi {
  authenticate(token: string): ShellApi {
    if (!validateToken(token)) {
      throw new Error('Invalid token')
    }
    return new ShellApiImpl({ /* ... */ })
  }

  // Other methods throw if not authenticated
  async exec() { throw new Error('Not authenticated') }
}

// Client
using publicApi = newWebSocketRpcSession<AuthenticatedShellApi>('wss://bashx.do/api')
using api = await publicApi.authenticate(myToken)
await api.exec('ls')
```

### Runtime Type Checking

Cap'n Web doesn't perform runtime type checking. Use Zod or similar for input validation:

```typescript
import { z } from 'zod'

const ExecOptionsSchema = z.object({
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
})

class ShellApiImpl extends RpcTarget {
  async exec(command: string, args?: string[], options?: unknown) {
    // Validate inputs
    const validatedOptions = options ? ExecOptionsSchema.parse(options) : undefined
    // ... rest of implementation
  }
}
```

### Rate Limiting

Pipelining can enable denial of service. Implement rate limiting:

```typescript
class RateLimitedShellApi extends RpcTarget {
  #requestCount = 0
  #lastReset = Date.now()
  #limit = 100 // requests per second

  async exec(command: string, args?: string[], options?: ShellExecOptions) {
    this.#checkRateLimit()
    // ... implementation
  }

  #checkRateLimit() {
    const now = Date.now()
    if (now - this.#lastReset > 1000) {
      this.#requestCount = 0
      this.#lastReset = now
    }
    if (++this.#requestCount > this.#limit) {
      throw new Error('Rate limit exceeded')
    }
  }
}
```

---

## Workers RPC Compatibility

Cap'n Web is designed to be compatible with Cloudflare Workers RPC. The `src/` directory (platform-specific code) can use Workers RPC directly while `core/` uses the portable Cap'n Web API.

```typescript
// src/do/worker.ts (Cloudflare-specific)
import { newWorkersRpcResponse } from 'capnweb'
import { ShellApiImpl } from '@dotdo/bashx/rpc/server/shell-api'

export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname === '/api') {
      return newWorkersRpcResponse(request, new ShellApiImpl({
        backend: new DurableObjectBackend(env.SHELL_DO),
        spawn: containerSpawn,
      }))
    }
    return new Response('Not found', { status: 404 })
  }
}
```

---

## Implementation Roadmap

### Phase 1: Types and Transport (Week 1)
- [ ] Create `core/rpc/types.ts` with all type definitions
- [ ] Create `core/rpc/transport.ts` with transport abstraction
- [ ] Implement `core/rpc/transports/websocket.ts`
- [ ] Add capnweb dependency to core/package.json

### Phase 2: Server Implementation (Week 2)
- [ ] Implement `ShellStreamImpl` extending RpcTarget
- [ ] Implement `ShellApiImpl` extending RpcTarget
- [ ] Add disposal handling
- [ ] Write unit tests

### Phase 3: Client Helpers (Week 3)
- [ ] Create client connection helpers
- [ ] Implement stdio transport for MCP
- [ ] Write integration tests

### Phase 4: Workers Integration (Week 4)
- [ ] Update `src/do/worker.ts` to use Cap'n Web
- [ ] Add authentication layer
- [ ] Deploy and test

---

## Acceptance Criteria Mapping

| Criteria | Solution |
|----------|----------|
| RpcTarget pattern works for streams | `ShellStreamImpl extends RpcTarget` |
| Callbacks work bidirectionally | Functions passed to `onData()`, `onExit()` are called by server |
| Promise pipelining batches calls | Use `newHttpBatchRpcSession` or parallel WebSocket calls |
| Disposal cleans up resources | `[Symbol.dispose]()` kills process and clears callbacks |
| Zero Cloudflare dependencies | All code in `core/rpc/`, only capnweb dependency |

---

## References

- [Cap'n Web GitHub](https://github.com/cloudflare/capnweb)
- [Cap'n Web Documentation](https://github.com/cloudflare/capnweb/blob/main/README.md)
- [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
