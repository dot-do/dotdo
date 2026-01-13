/**
 * TerminalEmbed Component
 *
 * Provides WebSocket-connected terminal rendering using xterm.js for sandbox terminal sessions.
 * Renders terminal output on an xterm.js terminal in real-time.
 *
 * Features:
 * - WebSocket connection to sandbox terminal endpoint
 * - xterm.js-based terminal rendering
 * - Connection status display with color coding
 * - Fullscreen toggle support
 * - Terminal input/output handling
 * - Resize handling with FitAddon
 * - Graceful error handling and cleanup
 * - Scrollback buffer limits for memory management
 * - Theme synchronization with app theme
 * - Auto-reconnection with exponential backoff
 * - Keyboard shortcuts (documented in aria-describedby)
 *
 * SSR Compatibility:
 * - xterm.js is browser-only and requires dynamic import
 * - Terminal initialization is deferred to useEffect (client-side only)
 * - CSS is imported dynamically alongside the library
 *
 * @see api/routes/sandboxes.ts - Sandbox terminal WebSocket endpoint
 * @see objects/Sandbox.ts - Sandbox Durable Object
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useThemeStore } from '@mdxui/themes'

// ============================================================================
// Constants
// ============================================================================

/** Maximum scrollback lines to prevent memory issues in long sessions */
const SCROLLBACK_LIMIT = 5000

/** Maximum reconnection attempts before giving up */
const MAX_RECONNECT_ATTEMPTS = 5

/** Base delay for exponential backoff (ms) */
const RECONNECT_BASE_DELAY = 1000

/** Terminal themes for light and dark modes */
const TERMINAL_THEMES = {
  dark: {
    background: '#1a1a1a',
    foreground: '#f0f0f0',
    cursor: '#f0f0f0',
    cursorAccent: '#1a1a1a',
    selectionBackground: 'rgba(255, 255, 255, 0.3)',
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(0, 0, 0, 0.2)',
  },
} as const

// ============================================================================
// Types
// ============================================================================

export interface TerminalEmbedProps {
  sandboxId: string
  className?: string
  /** Maximum scrollback lines (default: 5000) */
  scrollbackLimit?: number
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// ============================================================================
// TerminalEmbed Component
// ============================================================================

export function TerminalEmbed({
  sandboxId,
  className,
  scrollbackLimit = SCROLLBACK_LIMIT,
  autoReconnect = true,
  onConnected,
  onDisconnected,
  onError,
}: TerminalEmbedProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [isTerminalReady, setIsTerminalReady] = useState(false)

  // Get resolved theme mode from app theme store
  const { resolvedMode } = useThemeStore()

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    const container = terminalRef.current?.parentElement
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true)
        // Refit terminal after fullscreen change
        fitAddonRef.current?.fit()
      }).catch((err) => {
        console.error('Failed to enter fullscreen:', err)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
        // Refit terminal after fullscreen change
        fitAddonRef.current?.fit()
      }).catch((err) => {
        console.error('Failed to exit fullscreen:', err)
      })
    }
  }, [])

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      // Refit terminal when fullscreen changes
      fitAddonRef.current?.fit()
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Sync terminal theme with app theme
  useEffect(() => {
    const terminal = xtermRef.current
    if (!terminal) return

    const themeMode = resolvedMode === 'dark' ? 'dark' : 'light'
    terminal.options.theme = TERMINAL_THEMES[themeMode]
  }, [resolvedMode])

  // Connect to WebSocket with reconnection support
  const connectWebSocket = useCallback(() => {
    const terminal = xtermRef.current
    if (!terminal) return null

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/sandboxes/${sandboxId}/terminal`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      reconnectAttemptRef.current = 0
      setReconnectAttempt(0)
      onConnected?.()

      // Send initial resize message
      const { cols, rows } = terminal
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output') {
          terminal.write(msg.data)
        } else if (msg.type === 'error') {
          terminal.write(msg.data)
        } else if (msg.type === 'connected') {
          // Session connected, can handle sessionId if needed
        } else if (msg.type === 'exit') {
          // Process exited, can handle exit code if needed
        }
      } catch (e) {
        console.error('Failed to parse message:', e)
      }
    }

    ws.onerror = () => {
      setStatus('error')
      onError?.(new Error('WebSocket connection error'))
    }

    ws.onclose = () => {
      setStatus('disconnected')
      onDisconnected?.()

      // Auto-reconnect with exponential backoff
      if (autoReconnect && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current)
        reconnectAttemptRef.current++
        setReconnectAttempt(reconnectAttemptRef.current)
        setStatus('connecting')

        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket()
        }, delay)
      }
    }

    // Send terminal input to WebSocket
    const inputDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Handle terminal resize
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    return { inputDisposable, resizeDisposable }
  }, [sandboxId, autoReconnect, onConnected, onDisconnected, onError])

  // Manual reconnect handler
  const handleReconnect = useCallback(() => {
    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Reset reconnect attempts and connect
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    setStatus('connecting')
    connectWebSocket()
  }, [connectWebSocket])

  // Initialize xterm and WebSocket connection
  // Uses dynamic imports for SSR compatibility - xterm.js is browser-only
  useEffect(() => {
    // SSR guard - only run in browser
    if (typeof window === 'undefined') return

    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let disposables: { inputDisposable?: { dispose(): void }; resizeDisposable?: { dispose(): void } } | null = null
    let handleWindowResize: (() => void) | null = null
    let mounted = true

    // Dynamically import xterm.js (browser-only library)
    const initTerminal = async () => {
      try {
        // Import xterm modules dynamically
        const [{ Terminal: TerminalClass }, { FitAddon: FitAddonClass }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ])

        // Import CSS - Vite handles this correctly
        await import('@xterm/xterm/css/xterm.css')

        // Check if component is still mounted
        if (!mounted) return

        // Get initial theme
        const themeMode = resolvedMode === 'dark' ? 'dark' : 'light'

        // Initialize xterm with scrollback limit and theme
        terminal = new TerminalClass({
          cursorBlink: true,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 14,
          scrollback: scrollbackLimit,
          theme: TERMINAL_THEMES[themeMode],
          // Accessibility options
          screenReaderMode: false, // Can be enabled via prop if needed
        })
        fitAddon = new FitAddonClass()
        terminal.loadAddon(fitAddon)

        xtermRef.current = terminal
        fitAddonRef.current = fitAddon

        if (terminalRef.current) {
          terminal.open(terminalRef.current)
          fitAddon.fit()
        }

        // Connect WebSocket
        disposables = connectWebSocket()

        // Handle window resize
        handleWindowResize = () => {
          fitAddon?.fit()
        }
        window.addEventListener('resize', handleWindowResize)

        // Mark terminal as ready
        setIsTerminalReady(true)
      } catch (err) {
        console.error('Failed to initialize terminal:', err)
        onError?.(err instanceof Error ? err : new Error('Failed to initialize terminal'))
      }
    }

    initTerminal()

    // Cleanup on unmount
    return () => {
      mounted = false
      setIsTerminalReady(false)

      if (handleWindowResize) {
        window.removeEventListener('resize', handleWindowResize)
      }

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close()
      }

      // Dispose terminal event handlers
      disposables?.inputDisposable?.dispose()
      disposables?.resizeDisposable?.dispose()

      // Dispose terminal (cleans up DOM and memory)
      terminal?.dispose()
    }
  }, [sandboxId, scrollbackLimit, resolvedMode, connectWebSocket, onError])

  // Get status message with reconnect info
  const getStatusMessage = () => {
    switch (status) {
      case 'connecting':
        return reconnectAttempt > 0
          ? `Reconnecting (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`
          : 'Connecting...'
      case 'connected':
        return 'Connected'
      case 'disconnected':
        return reconnectAttempt >= MAX_RECONNECT_ATTEMPTS
          ? 'Connection failed'
          : 'Disconnected'
      case 'error':
        return 'Error'
      default:
        return ''
    }
  }

  // Show reconnect button when disconnected and auto-reconnect exhausted
  const showReconnectButton = status === 'disconnected' && reconnectAttempt >= MAX_RECONNECT_ATTEMPTS

  return (
    <div className={`relative ${className || ''}`}>
      {/* Hidden keyboard shortcuts description for screen readers */}
      <div id="terminal-shortcuts-description" className="sr-only">
        Terminal keyboard shortcuts: Ctrl+C to interrupt, Ctrl+D to send EOF,
        Ctrl+L to clear screen, Up/Down arrows for command history.
      </div>

      {/* Status indicator */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            status === 'connected'
              ? 'bg-green-500'
              : status === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : status === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-500'
          }`}
          role="status"
          aria-label={`Terminal ${status}`}
        />
        <span
          data-testid="terminal-status"
          className="text-xs text-white bg-black/50 px-2 py-1 rounded"
          role="status"
          aria-live="polite"
        >
          {getStatusMessage()}
        </span>
      </div>

      {/* Control buttons */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {/* Reconnect button (shown when disconnected) */}
        {showReconnectButton && (
          <button
            type="button"
            onClick={handleReconnect}
            className="p-2 bg-blue-600/80 text-white rounded hover:bg-blue-700/80 text-xs"
            aria-label="Reconnect to terminal"
          >
            Reconnect
          </button>
        )}

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2 bg-black/50 text-white rounded hover:bg-black/70"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Terminal container */}
      <div className="relative">
        <div
          ref={terminalRef}
          data-testid="terminal-container"
          className="w-full h-96 border rounded bg-gray-900 overflow-hidden"
          role="application"
          aria-label="Terminal"
          aria-describedby="terminal-shortcuts-description"
          tabIndex={0}
        />
        {/* Loading overlay - shown during SSR and while terminal initializes */}
        {!isTerminalReady && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-gray-900 border rounded"
            data-testid="terminal-loading"
          >
            <div className="text-gray-400 text-sm animate-pulse">
              Loading terminal...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TerminalEmbed
