/**
 * Browser Terminal Client using xterm.js
 *
 * Connects to bashx.do via WebSocket for full terminal emulation.
 * Supports multiple addons: fit, web-links, search.
 *
 * @packageDocumentation
 */

// Type declarations for xterm.js and addons
// These are declared as interfaces so consumers can import from @xterm/xterm
declare class Terminal {
  constructor(options?: TerminalOptions)
  open(container: HTMLElement): void
  write(data: string | Uint8Array): void
  onData(handler: (data: string) => void): { dispose: () => void }
  onResize(handler: (size: { cols: number; rows: number }) => void): { dispose: () => void }
  loadAddon(addon: ITerminalAddon): void
  dispose(): void
  readonly cols: number
  readonly rows: number
  focus(): void
  clear(): void
  reset(): void
  scrollToBottom(): void
}

interface TerminalOptions {
  cols?: number
  rows?: number
  cursorBlink?: boolean
  cursorStyle?: 'block' | 'underline' | 'bar'
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  theme?: TerminalTheme
  allowTransparency?: boolean
  scrollback?: number
  convertEol?: boolean
}

interface TerminalTheme {
  background?: string
  foreground?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

interface ITerminalAddon {
  activate(terminal: Terminal): void
  dispose(): void
}

declare class FitAddon implements ITerminalAddon {
  activate(terminal: Terminal): void
  dispose(): void
  fit(): void
  proposeDimensions(): { cols: number; rows: number } | undefined
}

declare class WebLinksAddon implements ITerminalAddon {
  constructor(handler?: (event: MouseEvent, uri: string) => void)
  activate(terminal: Terminal): void
  dispose(): void
}

declare class SearchAddon implements ITerminalAddon {
  activate(terminal: Terminal): void
  dispose(): void
  findNext(term: string, options?: SearchOptions): boolean
  findPrevious(term: string, options?: SearchOptions): boolean
  clearDecorations(): void
}

interface SearchOptions {
  regex?: boolean
  wholeWord?: boolean
  caseSensitive?: boolean
  incremental?: boolean
}

// ============================================================================
// Terminal Message Protocol
// ============================================================================

/**
 * Message types for WebSocket communication with bashx.do
 */
export type TerminalMessageType = 'data' | 'resize' | 'signal' | 'end' | 'error' | 'auth' | 'ping' | 'pong'

/**
 * Terminal message structure for WebSocket protocol
 */
export interface TerminalMessage {
  /** Message type discriminator */
  type: TerminalMessageType
  /** Message payload - varies by type */
  payload?: TerminalPayload
  /** Session ID for multi-client support */
  sessionId?: string
  /** Timestamp for message ordering */
  timestamp?: number
}

/**
 * Union type for all possible payloads
 */
export type TerminalPayload =
  | string // data, error, auth
  | TerminalSize // resize
  | SignalType // signal
  | undefined // end, ping, pong

/**
 * Terminal dimensions
 */
export interface TerminalSize {
  cols: number
  rows: number
}

/**
 * Signal types that can be sent to the server
 */
export type SignalType = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGCONT'

// ============================================================================
// Configuration Options
// ============================================================================

/**
 * Options for creating a BrowserTerminal instance
 */
export interface TerminalClientOptions {
  /** WebSocket URL for bashx.do connection */
  url: string

  /** Session ID for reconnection/multi-client viewing */
  sessionId?: string

  /** Enable the fit addon for automatic resizing */
  fitAddon?: boolean

  /** Enable the web-links addon for clickable URLs */
  webLinksAddon?: boolean

  /** Enable the search addon for terminal text search */
  searchAddon?: boolean

  /** Custom terminal options */
  terminalOptions?: TerminalOptions

  /** Authentication token */
  authToken?: string

  /** Reconnect on disconnect */
  autoReconnect?: boolean

  /** Reconnect delay in milliseconds */
  reconnectDelay?: number

  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number

  /** Handler for clickable URLs */
  onLinkClick?: (event: MouseEvent, uri: string) => void

  /** Handler for connection state changes */
  onConnectionChange?: (connected: boolean) => void

  /** Handler for errors */
  onError?: (error: Error) => void
}

/**
 * Connection state enumeration
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * Event types emitted by BrowserTerminal
 */
export type TerminalEventType = 'connected' | 'disconnected' | 'error' | 'data' | 'resize' | 'end'

/**
 * Event listener function type
 */
export type TerminalEventListener = (event: TerminalEvent) => void

/**
 * Event object passed to listeners
 */
export interface TerminalEvent {
  type: TerminalEventType
  data?: unknown
  error?: Error
}

// ============================================================================
// BrowserTerminal Class
// ============================================================================

/**
 * Browser-based terminal client using xterm.js with WebSocket connection to bashx.do.
 *
 * Features:
 * - Full terminal emulation with colors, cursor positioning, and ANSI escape codes
 * - WebSocket connection with JSON message protocol
 * - Automatic terminal resizing with fit addon
 * - Clickable URLs with web-links addon
 * - Terminal search with search addon
 * - Multiple clients can view the same session
 * - Automatic reconnection on disconnect
 *
 * @example
 * ```typescript
 * import { BrowserTerminal } from 'bashx.do/web/terminal'
 *
 * const terminal = new BrowserTerminal({
 *   url: 'wss://bashx.do/terminal',
 *   sessionId: 'my-session',
 *   fitAddon: true,
 *   webLinksAddon: true
 * })
 *
 * // Mount to a DOM element
 * terminal.mount(document.getElementById('terminal')!)
 *
 * // Connect to the server
 * await terminal.connect()
 *
 * // Later, disconnect
 * terminal.disconnect()
 * ```
 */
export class BrowserTerminal {
  // Private state
  private term: Terminal | null = null
  private ws: WebSocket | null = null
  private fitAddon: FitAddon | null = null
  private webLinksAddon: WebLinksAddon | null = null
  private searchAddon: SearchAddon | null = null
  private container: HTMLElement | null = null
  private disposables: Array<{ dispose: () => void }> = []
  private resizeObserver: ResizeObserver | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<TerminalEventType, Set<TerminalEventListener>> = new Map()

  // Public state
  public connectionState: ConnectionState = 'disconnected'
  public readonly sessionId: string

  /**
   * Create a new BrowserTerminal instance.
   *
   * @param options - Configuration options
   */
  constructor(private options: TerminalClientOptions) {
    this.sessionId = options.sessionId || this.generateSessionId()
  }

  /**
   * Generate a random session ID.
   */
  private generateSessionId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Mount the terminal to a DOM element.
   *
   * @param container - The DOM element to mount the terminal to
   */
  mount(container: HTMLElement): void {
    if (this.term) {
      throw new Error('Terminal already mounted')
    }

    this.container = container

    // Default terminal options
    const defaultOptions: TerminalOptions = {
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
    }

    // Merge with user options
    const termOptions = { ...defaultOptions, ...this.options.terminalOptions }

    // Create terminal instance
    // @ts-expect-error - Terminal constructor is declared above
    this.term = new Terminal(termOptions)

    // Load addons
    if (this.options.fitAddon !== false) {
      // @ts-expect-error - FitAddon is declared above
      this.fitAddon = new FitAddon()
      this.term.loadAddon(this.fitAddon)
    }

    if (this.options.webLinksAddon !== false) {
      const handler = this.options.onLinkClick || ((event, uri) => {
        event.preventDefault()
        window.open(uri, '_blank')
      })
      // @ts-expect-error - WebLinksAddon is declared above
      this.webLinksAddon = new WebLinksAddon(handler)
      this.term.loadAddon(this.webLinksAddon)
    }

    if (this.options.searchAddon) {
      // @ts-expect-error - SearchAddon is declared above
      this.searchAddon = new SearchAddon()
      this.term.loadAddon(this.searchAddon)
    }

    // Open terminal in container
    this.term.open(container)

    // Fit to container
    if (this.fitAddon) {
      this.fitAddon.fit()
    }

    // Set up resize observer for automatic fitting
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon) {
        this.fitAddon.fit()
      }
    })
    this.resizeObserver.observe(container)

    // Handle user input
    const dataDisposable = this.term.onData((data) => {
      this.sendData(data)
    })
    this.disposables.push(dataDisposable)

    // Handle terminal resize
    const resizeDisposable = this.term.onResize((size) => {
      this.handleResize(size)
    })
    this.disposables.push(resizeDisposable)

    // Focus the terminal
    this.term.focus()
  }

  /**
   * Connect WebSocket to bashx.do.
   *
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    this.connectionState = 'connecting'
    this.emit('connecting', undefined)

    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL with session ID
        const url = new URL(this.options.url)
        url.searchParams.set('sessionId', this.sessionId)

        this.ws = new WebSocket(url.toString())

        this.ws.onopen = () => {
          this.connectionState = 'connected'
          this.reconnectAttempts = 0
          this.options.onConnectionChange?.(true)
          this.emit('connected', undefined)

          // Send auth token if provided
          if (this.options.authToken) {
            this.send({
              type: 'auth',
              payload: this.options.authToken,
              sessionId: this.sessionId,
            })
          }

          // Send initial terminal size
          if (this.term) {
            this.send({
              type: 'resize',
              payload: { cols: this.term.cols, rows: this.term.rows },
              sessionId: this.sessionId,
            })
          }

          resolve()
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }

        this.ws.onerror = (event) => {
          const error = new Error('WebSocket error')
          this.options.onError?.(error)
          this.emit('error', error)
          reject(error)
        }

        this.ws.onclose = (event) => {
          this.connectionState = 'disconnected'
          this.options.onConnectionChange?.(false)
          this.emit('disconnected', { code: event.code, reason: event.reason })

          // Attempt reconnection if enabled
          if (this.options.autoReconnect && this.shouldReconnect()) {
            this.scheduleReconnect()
          }
        }
      } catch (error) {
        this.connectionState = 'disconnected'
        reject(error)
      }
    })
  }

  /**
   * Check if reconnection should be attempted.
   */
  private shouldReconnect(): boolean {
    const maxAttempts = this.options.maxReconnectAttempts ?? 5
    return this.reconnectAttempts < maxAttempts
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.connectionState = 'reconnecting'
    const delay = this.options.reconnectDelay ?? 2000

    // Exponential backoff
    const actualDelay = delay * Math.pow(2, this.reconnectAttempts)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      this.connect().catch((error) => {
        this.options.onError?.(error)
      })
    }, actualDelay)
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(data: string): void {
    try {
      const message: TerminalMessage = JSON.parse(data)

      switch (message.type) {
        case 'data':
          // Write data to terminal
          if (this.term && typeof message.payload === 'string') {
            this.term.write(message.payload)
            this.emit('data', message.payload)
          }
          break

        case 'error':
          // Display error in terminal
          if (this.term && typeof message.payload === 'string') {
            this.term.write(`\r\n\x1b[31mError: ${message.payload}\x1b[0m\r\n`)
            this.options.onError?.(new Error(message.payload))
            this.emit('error', new Error(message.payload))
          }
          break

        case 'end':
          // Session ended
          if (this.term) {
            this.term.write('\r\n\x1b[33mSession ended\x1b[0m\r\n')
            this.emit('end', undefined)
          }
          break

        case 'resize':
          // Server-initiated resize (for multi-client sync)
          if (this.term && this.fitAddon && typeof message.payload === 'object' && message.payload) {
            const size = message.payload as TerminalSize
            // Resize is handled by fit addon, just emit event
            this.emit('resize', size)
          }
          break

        case 'pong':
          // Heartbeat response - no action needed
          break
      }
    } catch (error) {
      // Handle non-JSON messages as raw data
      if (this.term) {
        this.term.write(data)
      }
    }
  }

  /**
   * Send a message to the server.
   */
  private send(message: TerminalMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      message.timestamp = Date.now()
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * Send terminal data (keystrokes) to the server.
   */
  private sendData(data: string): void {
    this.send({
      type: 'data',
      payload: data,
      sessionId: this.sessionId,
    })
  }

  /**
   * Handle terminal resize events.
   */
  private handleResize(size: TerminalSize): void {
    this.send({
      type: 'resize',
      payload: size,
      sessionId: this.sessionId,
    })
  }

  /**
   * Send a signal to the running process.
   *
   * @param signal - The signal to send (SIGINT, SIGTERM, SIGKILL, etc.)
   *
   * @example
   * ```typescript
   * // Send Ctrl+C
   * terminal.sendSignal('SIGINT')
   *
   * // Force kill
   * terminal.sendSignal('SIGKILL')
   * ```
   */
  sendSignal(signal: SignalType): void {
    this.send({
      type: 'signal',
      payload: signal,
      sessionId: this.sessionId,
    })
  }

  /**
   * Write data directly to the terminal (local only, not sent to server).
   *
   * @param data - The data to write
   */
  write(data: string): void {
    if (this.term) {
      this.term.write(data)
    }
  }

  /**
   * Write a line to the terminal (adds CRLF).
   *
   * @param data - The line to write
   */
  writeln(data: string): void {
    if (this.term) {
      this.term.write(data + '\r\n')
    }
  }

  /**
   * Clear the terminal screen.
   */
  clear(): void {
    if (this.term) {
      this.term.clear()
    }
  }

  /**
   * Reset the terminal to initial state.
   */
  reset(): void {
    if (this.term) {
      this.term.reset()
    }
  }

  /**
   * Focus the terminal.
   */
  focus(): void {
    if (this.term) {
      this.term.focus()
    }
  }

  /**
   * Scroll to the bottom of the terminal.
   */
  scrollToBottom(): void {
    if (this.term) {
      this.term.scrollToBottom()
    }
  }

  /**
   * Search for text in the terminal.
   *
   * @param term - The search term
   * @param options - Search options
   * @returns Whether a match was found
   */
  findNext(term: string, options?: SearchOptions): boolean {
    if (this.searchAddon) {
      return this.searchAddon.findNext(term, options)
    }
    return false
  }

  /**
   * Search backwards for text in the terminal.
   *
   * @param term - The search term
   * @param options - Search options
   * @returns Whether a match was found
   */
  findPrevious(term: string, options?: SearchOptions): boolean {
    if (this.searchAddon) {
      return this.searchAddon.findPrevious(term, options)
    }
    return false
  }

  /**
   * Clear search decorations.
   */
  clearSearch(): void {
    if (this.searchAddon) {
      this.searchAddon.clearDecorations()
    }
  }

  /**
   * Manually fit the terminal to its container.
   */
  fit(): void {
    if (this.fitAddon) {
      this.fitAddon.fit()
    }
  }

  /**
   * Get the current terminal dimensions.
   *
   * @returns Terminal size or undefined if not mounted
   */
  getSize(): TerminalSize | undefined {
    if (this.term) {
      return { cols: this.term.cols, rows: this.term.rows }
    }
    return undefined
  }

  /**
   * Send a ping to keep the connection alive.
   */
  ping(): void {
    this.send({
      type: 'ping',
      sessionId: this.sessionId,
    })
  }

  /**
   * Add an event listener.
   *
   * @param event - The event type
   * @param listener - The listener function
   */
  on(event: TerminalEventType, listener: TerminalEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  /**
   * Remove an event listener.
   *
   * @param event - The event type
   * @param listener - The listener function
   */
  off(event: TerminalEventType, listener: TerminalEventListener): void {
    this.listeners.get(event)?.delete(listener)
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(type: TerminalEventType, data: unknown): void {
    const event: TerminalEvent = { type, data }
    if (data instanceof Error) {
      event.error = data
    }
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  /**
   * Disconnect from the server and clean up resources.
   */
  disconnect(): void {
    // Cancel any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Close WebSocket
    if (this.ws) {
      // Send end message before closing
      this.send({
        type: 'end',
        sessionId: this.sessionId,
      })
      this.ws.close()
      this.ws = null
    }

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    // Dispose of terminal event handlers
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables = []

    // Dispose of addons
    if (this.fitAddon) {
      this.fitAddon.dispose()
      this.fitAddon = null
    }
    if (this.webLinksAddon) {
      this.webLinksAddon.dispose()
      this.webLinksAddon = null
    }
    if (this.searchAddon) {
      this.searchAddon.dispose()
      this.searchAddon = null
    }

    // Dispose of terminal
    if (this.term) {
      this.term.dispose()
      this.term = null
    }

    this.container = null
    this.connectionState = 'disconnected'
  }

  /**
   * Check if the terminal is connected.
   */
  get isConnected(): boolean {
    return this.connectionState === 'connected'
  }

  /**
   * Check if the terminal is mounted.
   */
  get isMounted(): boolean {
    return this.term !== null
  }
}

/**
 * Create a BrowserTerminal instance with the provided options.
 *
 * @param options - Configuration options
 * @returns A new BrowserTerminal instance
 *
 * @example
 * ```typescript
 * import { createTerminal } from 'bashx.do/web/terminal'
 *
 * const terminal = createTerminal({
 *   url: 'wss://bashx.do/terminal',
 *   fitAddon: true
 * })
 * ```
 */
export function createTerminal(options: TerminalClientOptions): BrowserTerminal {
  return new BrowserTerminal(options)
}

export default BrowserTerminal
