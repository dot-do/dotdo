'use client'

/**
 * BrowserScreencast Component
 *
 * Provides CDP-based live preview for Cloudflare browser sessions using WebSocket screencast.
 * Renders browser frames on a canvas element in real-time.
 *
 * Features:
 * - WebSocket connection to screencast endpoint
 * - Canvas-based frame rendering
 * - Connection status display with FPS counter
 * - Fullscreen toggle support
 * - Graceful error handling and cleanup
 * - Frame rate limiting (configurable max FPS)
 * - Quality/bandwidth controls
 * - Canvas memory management
 * - Auto-reconnection with exponential backoff
 *
 * @see api/routes/browsers.ts - Screencast WebSocket endpoint
 * @see objects/Browser.ts - Browser Durable Object
 */

import { useRef, useState, useEffect, useCallback } from 'react'

// ============================================================================
// Constants
// ============================================================================

/** Default JPEG quality (0-100) for screencast frames */
const DEFAULT_QUALITY = 60

/** Maximum frames per second to render (prevents overwhelming the browser) */
const DEFAULT_MAX_FPS = 30

/** Minimum milliseconds between frame renders (based on max FPS) */
const getMinFrameInterval = (maxFps: number) => 1000 / maxFps

/** Maximum reconnection attempts before giving up */
const MAX_RECONNECT_ATTEMPTS = 5

/** Base delay for exponential backoff (ms) */
const RECONNECT_BASE_DELAY = 1000

// ============================================================================
// Types
// ============================================================================

export interface BrowserScreencastProps {
  browserId: string
  className?: string
  width?: number
  height?: number
  /** JPEG quality 0-100 (default: 60) */
  quality?: number
  /** Max frames per second (default: 30) */
  maxFps?: number
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// ============================================================================
// BrowserScreencast Component
// ============================================================================

export function BrowserScreencast({
  browserId,
  className,
  width = 1280,
  height = 720,
  quality = DEFAULT_QUALITY,
  maxFps = DEFAULT_MAX_FPS,
  autoReconnect = true,
  onConnected,
  onDisconnected,
  onError,
}: BrowserScreencastProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fps, setFps] = useState(0)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  // Frame timing refs for rate limiting
  const frameCountRef = useRef(0)
  const lastFrameTimeRef = useRef(0)
  const pendingFrameRef = useRef<string | null>(null)
  const rafIdRef = useRef<number | null>(null)

  // Reconnection refs
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Image cache for memory management (reuse Image objects)
  const imageRef = useRef<HTMLImageElement | null>(null)

  // Render a frame to the canvas with rate limiting
  const renderFrame = useCallback((base64Data: string) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const now = performance.now()
    const minInterval = getMinFrameInterval(maxFps)
    const timeSinceLastFrame = now - lastFrameTimeRef.current

    // If we're within the rate limit, queue this frame for later
    if (timeSinceLastFrame < minInterval) {
      pendingFrameRef.current = base64Data

      // Schedule render for the next available slot if not already scheduled
      if (!rafIdRef.current) {
        const delay = minInterval - timeSinceLastFrame
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          if (pendingFrameRef.current) {
            renderFrame(pendingFrameRef.current)
            pendingFrameRef.current = null
          }
        })
      }
      return
    }

    // Update timing
    lastFrameTimeRef.current = now
    frameCountRef.current++

    // Reuse Image object to reduce GC pressure
    if (!imageRef.current) {
      imageRef.current = new Image()
    }
    const img = imageRef.current

    img.onload = () => {
      // Clear previous frame to prevent ghosting
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.onerror = () => {
      console.error('Failed to decode frame')
    }
    img.src = `data:image/jpeg;base64,${base64Data}`
  }, [maxFps])

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    const container = canvasRef.current?.parentElement
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch((err) => {
        console.error('Failed to enter fullscreen:', err)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch((err) => {
        console.error('Failed to exit fullscreen:', err)
      })
    }
  }, [])

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Connect to WebSocket with reconnection support
  const connectWebSocket = useCallback(() => {
    // Calculate WebSocket URL based on current page protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/browsers/${browserId}/screencast`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      reconnectAttemptRef.current = 0
      setReconnectAttempt(0)
      onConnected?.()

      // Send start command to begin screencast with configured quality
      ws.send(JSON.stringify({ action: 'start', options: { quality } }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'frame') {
          renderFrame(msg.data)
        } else if (msg.type === 'error') {
          console.error('Screencast error:', msg.message)
          onError?.(new Error(msg.message))
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

    return ws
  }, [browserId, quality, autoReconnect, renderFrame, onConnected, onDisconnected, onError])

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

  // WebSocket connection and frame handling
  useEffect(() => {
    connectWebSocket()

    // FPS counter - update every second
    const fpsInterval = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)

    // Cleanup on unmount
    return () => {
      clearInterval(fpsInterval)

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close()
      }

      // Clear image reference for GC
      if (imageRef.current) {
        imageRef.current.onload = null
        imageRef.current.onerror = null
        imageRef.current.src = ''
        imageRef.current = null
      }

      // Clear pending frame data
      pendingFrameRef.current = null
    }
  }, [connectWebSocket])

  // Get status message with reconnect info
  const getStatusMessage = () => {
    switch (status) {
      case 'connecting':
        return reconnectAttempt > 0
          ? `Reconnecting (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`
          : 'Connecting...'
      case 'connected':
        return `Live (${fps} fps)`
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
          aria-label={`Browser screencast ${status}`}
        />
        <span
          data-testid="screencast-status"
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
            aria-label="Reconnect to browser screencast"
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

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-auto border rounded bg-gray-900"
        role="img"
        aria-label="Live browser preview"
        tabIndex={0}
      />
    </div>
  )
}

export default BrowserScreencast
