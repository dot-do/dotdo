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
 *
 * @see api/routes/sandboxes.ts - Sandbox terminal WebSocket endpoint
 * @see objects/Sandbox.ts - Sandbox Durable Object
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// ============================================================================
// Types
// ============================================================================

export interface TerminalEmbedProps {
  sandboxId: string
  className?: string
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
  onConnected,
  onDisconnected,
  onError,
}: TerminalEmbedProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isFullscreen, setIsFullscreen] = useState(false)

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

  // Initialize xterm and WebSocket connection
  useEffect(() => {
    // Initialize xterm
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#1a1a1a',
        foreground: '#f0f0f0',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    xtermRef.current = terminal
    fitAddonRef.current = fitAddon

    if (terminalRef.current) {
      terminal.open(terminalRef.current)
      fitAddon.fit()
    }

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/sandboxes/${sandboxId}/terminal`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
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
    }

    // Send terminal input to WebSocket
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // Handle window resize
    const handleWindowResize = () => {
      fitAddon.fit()
    }
    window.addEventListener('resize', handleWindowResize)

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      ws.close()
      terminal.dispose()
    }
  }, [sandboxId, onConnected, onDisconnected, onError])

  return (
    <div className={`relative ${className || ''}`}>
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
        />
        <span
          data-testid="terminal-status"
          className="text-xs text-white bg-black/50 px-2 py-1 rounded"
        >
          {status === 'connecting' && 'Connecting...'}
          {status === 'connected' && 'Connected'}
          {status === 'disconnected' && 'Disconnected'}
          {status === 'error' && 'Error'}
        </span>
      </div>

      {/* Fullscreen button */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute top-2 right-2 z-10 p-2 bg-black/50 text-white rounded hover:bg-black/70"
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

      {/* Terminal container */}
      <div
        ref={terminalRef}
        data-testid="terminal-container"
        className="w-full h-96 border rounded bg-gray-900 overflow-hidden"
      />
    </div>
  )
}

export default TerminalEmbed
