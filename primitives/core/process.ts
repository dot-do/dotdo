/**
 * Process polyfill for Cloudflare Workers
 *
 * Provides a Node.js-compatible process object that works in the Workers runtime.
 * This is a stub file for the RED phase - implementations will be added in GREEN phase.
 *
 * @module primitives-core/process
 */

/**
 * Error thrown when process.exit() is called.
 * Since Workers can't actually exit, we throw this error to be caught
 * by the calling code.
 */
export class ProcessExitError extends Error {
  public readonly code: number

  constructor(code: number = 0) {
    super(`Process exited with code ${code}`)
    this.name = 'ProcessExitError'
    this.code = code
  }
}

/**
 * Process environment type
 */
export type ProcessEnv = Record<string, string | undefined>

/**
 * High-resolution time tuple [seconds, nanoseconds]
 */
export type HRTime = [number, number]

/**
 * Memory usage info
 */
export interface MemoryUsage {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

/**
 * Writable stream interface (for stdout/stderr)
 */
export interface WritableStream {
  write(chunk: string | Buffer): boolean
  isTTY: boolean
}

/**
 * Readable stream interface (for stdin)
 */
export interface ReadableStream {
  read(): string | null
  isTTY: boolean
}

/**
 * Process release info
 */
export interface ProcessRelease {
  name: string
  sourceUrl?: string
  headersUrl?: string
  libUrl?: string
  lts?: string
}

/**
 * Process config
 */
export interface ProcessConfig {
  target_defaults: Record<string, unknown>
  variables: Record<string, unknown>
}

/**
 * Process versions
 */
export interface ProcessVersions {
  node: string
  v8: string
  [key: string]: string
}

/**
 * Process features
 */
export interface ProcessFeatures {
  inspector: boolean
  debug: boolean
  uv: boolean
  ipv6: boolean
  tls_alpn: boolean
  tls_sni: boolean
  tls_ocsp: boolean
  tls: boolean
}

/**
 * HRTime function with bigint method
 */
export interface HRTimeFunction {
  (time?: HRTime): HRTime
  bigint(): bigint
}

/**
 * Event handler type
 */
type EventHandler = (...args: unknown[]) => void

/**
 * Full Process interface compatible with Node.js
 */
export interface Process {
  // Properties
  env: ProcessEnv
  argv: readonly string[]
  argv0: string
  platform: string
  arch: string
  version: string
  versions: ProcessVersions
  pid: number
  ppid: number
  title: string
  execPath: string
  execArgv: readonly string[]
  config: ProcessConfig
  release: ProcessRelease
  features: ProcessFeatures

  // Streams
  stdout: WritableStream
  stderr: WritableStream
  stdin: ReadableStream | null

  // Methods
  cwd(): string
  chdir(directory: string): void
  exit(code?: number): never
  abort(): never
  kill(pid: number, signal?: string | number): boolean
  nextTick<T extends unknown[]>(
    callback: (...args: T) => void,
    ...args: T
  ): void
  hrtime: HRTimeFunction
  memoryUsage(): MemoryUsage
  uptime(): number
  umask(mask?: number): number

  // Event emitter methods
  on(event: string, handler: EventHandler): this
  off(event: string, handler: EventHandler): this
  once(event: string, handler: EventHandler): this
  emit(event: string, ...args: unknown[]): boolean
  removeAllListeners(event?: string): this
}

/**
 * Create a new process polyfill instance.
 *
 * This is a stub that throws errors for the RED phase.
 * Actual implementation will come in the GREEN phase.
 */
export function createProcess(): Process {
  // RED phase: throw to make tests fail
  throw new Error('createProcess() not implemented - RED phase stub')
}
