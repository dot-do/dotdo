/**
 * Global Type Declarations for PTY Module
 *
 * These declarations allow the PTY module to work in any JavaScript
 * environment (Node.js, browsers, Cloudflare Workers, Deno, etc.)
 * without requiring specific type libraries.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// TextEncoder/TextDecoder are available in all modern JS environments
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  decode(input?: BufferSource): string
}

// WritableStream is available in modern browsers, Node.js 18+, and Workers
interface WritableStreamDefaultController<W = any> {
  error(e?: any): void
}

interface UnderlyingSink<W = any> {
  abort?(reason?: any): void | Promise<void>
  close?(): void | Promise<void>
  start?(controller: WritableStreamDefaultController<W>): void | Promise<void>
  write?(chunk: W, controller: WritableStreamDefaultController<W>): void | Promise<void>
}

interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<undefined>
  readonly desiredSize: number | null
  readonly ready: Promise<undefined>
  abort(reason?: any): Promise<void>
  close(): Promise<void>
  releaseLock(): void
  write(chunk?: W): Promise<void>
}

declare class WritableStream<W = any> {
  constructor(underlyingSink?: UnderlyingSink<W>)
  readonly locked: boolean
  abort(reason?: any): Promise<void>
  close(): Promise<void>
  getWriter(): WritableStreamDefaultWriter<W>
}
