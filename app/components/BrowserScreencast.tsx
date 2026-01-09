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
 *
 * @see api/routes/browsers.ts - Screencast WebSocket endpoint
 * @see objects/Browser.ts - Browser Durable Object
 */

import { useRef, useState, useEffect, useCallback } from 'react'

// ============================================================================
// Types
// ============================================================================

interface BrowserScreencastProps {
  browserId: string
  className?: string
  width?: number
  height?: number
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
}: BrowserScreencastProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fps, setFps] = useState(0)
  const frameCountRef = useRef(0)

  // Render a frame to the canvas
  const renderFrame = useCallback((base64Data: string) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = `data:image/jpeg;base64,${base64Data}`
  }, [])

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

  // WebSocket connection and frame handling
  useEffect(() => {
    // Calculate WebSocket URL based on current page protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/browsers/${browserId}/screencast`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      // Send start command to begin screencast
      ws.send(JSON.stringify({ action: 'start', options: { quality: 60 } }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'frame') {
          frameCountRef.current++
          renderFrame(msg.data)
        } else if (msg.type === 'error') {
          console.error('Screencast error:', msg.message)
        }
      } catch (e) {
        console.error('Failed to parse message:', e)
      }
    }

    ws.onerror = () => {
      setStatus('error')
    }

    ws.onclose = () => {
      setStatus('disconnected')
    }

    // FPS counter - update every second
    const fpsInterval = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)

    // Cleanup on unmount
    return () => {
      clearInterval(fpsInterval)
      ws.close()
    }
  }, [browserId, renderFrame])

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
        <span className="text-xs text-white bg-black/50 px-2 py-1 rounded">
          {status === 'connecting' && 'Connecting...'}
          {status === 'connected' && `Live (${fps} fps)`}
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

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-auto border rounded bg-gray-900"
      />
    </div>
  )
}

export default BrowserScreencast
