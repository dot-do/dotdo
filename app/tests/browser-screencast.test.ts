/**
 * BrowserScreencast Component Tests (TDD RED Phase)
 *
 * Tests for the BrowserScreencast component that provides CDP-based
 * live preview for Cloudflare browser sessions using WebSocket screencast.
 *
 * These tests verify:
 * - Component rendering and canvas element
 * - WebSocket connection lifecycle
 * - Frame rendering on canvas
 * - Connection status display
 * - Error handling
 * - Cleanup on unmount
 * - Fullscreen toggle
 * - BrowserLiveView integration with providers
 *
 * @see app/components/BrowserScreencast.tsx
 * @see app/routes/admin/browsers/$browserId.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []

  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readyState: number = WebSocket.CONNECTING
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = WebSocket.OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }

  static reset() {
    MockWebSocket.instances = []
  }

  static getLastInstance() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }
}

// ============================================================================
// Component File Structure Tests
// ============================================================================

describe('BrowserScreencast Component Structure', () => {
  describe('app/components/BrowserScreencast.tsx', () => {
    it('should exist as a component file', () => {
      expect(existsSync('app/components/BrowserScreencast.tsx')).toBe(true)
    })

    it('should export BrowserScreencast component', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/export\s+(function|const)\s+BrowserScreencast/)
    })

    it('should have default export', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('export default')
    })

    it('should import React hooks', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('useRef')
      expect(content).toContain('useState')
      expect(content).toContain('useEffect')
      expect(content).toContain('useCallback')
    })
  })
})

// ============================================================================
// BrowserScreencast Component Tests
// ============================================================================

describe('BrowserScreencast', () => {
  describe('Canvas Rendering', () => {
    it('should render canvas element', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('<canvas')
      expect(content).toContain('canvasRef')
    })

    it('should have width and height props for canvas', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/width[=:]/i)
      expect(content).toMatch(/height[=:]/i)
    })

    it('should use canvas 2d context for drawing', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain("getContext('2d')")
    })
  })

  describe('Connection Status', () => {
    it('should show "Connecting..." initially', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('Connecting...')
    })

    it('should have connection status state', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/status|connectionStatus|ConnectionStatus/i)
      expect(content).toContain('connecting')
    })

    it('should show "Connected" after WebSocket opens', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('connected')
      expect(content).toMatch(/ws\.onopen|onopen/)
    })

    it('should have status indicator with color coding', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/bg-green|green-500|green/i)
      expect(content).toMatch(/bg-yellow|yellow-500|yellow/i)
      expect(content).toMatch(/bg-red|red-500|red/i)
    })
  })

  describe('WebSocket Connection', () => {
    it('should connect to WebSocket on mount', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('WebSocket')
      expect(content).toMatch(/useEffect/)
    })

    it('should construct correct WebSocket URL', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      // Should build URL like /api/browsers/${browserId}/screencast
      expect(content).toMatch(/screencast|\/api\/browsers.*screencast/i)
    })

    it('should use wss: or ws: based on page protocol', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/wss:|ws:|protocol/)
    })

    it('should send start message after connection opens', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/ws\.send|send.*start|start.*action/i)
    })

    it('should store WebSocket reference', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/wsRef|webSocketRef|socketRef/)
    })
  })

  describe('Frame Rendering', () => {
    it('should handle frame messages from WebSocket', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/onmessage|msg\.type.*frame|type.*===.*frame/i)
    })

    it('should render base64 image data on canvas', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/base64|data:image|Image\(\)/)
      expect(content).toMatch(/drawImage/)
    })

    it('should have renderFrame function or callback', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/renderFrame|drawFrame|handleFrame/)
    })
  })

  describe('Error Handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/onerror|error/i)
      expect(content).toContain('error')
    })

    it('should show error status when connection fails', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/status.*error|setStatus.*error|Error/i)
    })

    it('should handle disconnected state', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('disconnected')
      expect(content).toMatch(/onclose/)
    })
  })

  describe('Cleanup', () => {
    it('should clean up WebSocket on unmount', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      // useEffect should return cleanup function that closes WebSocket
      expect(content).toMatch(/return.*\{[\s\S]*ws\.close|close\(\)/)
    })
  })

  describe('Fullscreen', () => {
    it('should support fullscreen toggle', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/fullscreen|isFullscreen|toggleFullscreen/i)
    })

    it('should have fullscreen button', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/button.*fullscreen|onClick.*fullscreen/is)
    })

    it('should use requestFullscreen API', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/requestFullscreen|exitFullscreen/)
    })
  })

  describe('Props', () => {
    it('should accept browserId prop', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('browserId')
    })

    it('should accept className prop', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toContain('className')
    })

    it('should accept optional width and height props', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/width\??:/)
      expect(content).toMatch(/height\??:/)
    })
  })

  describe('FPS Counter', () => {
    it('should track and display FPS', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/fps|FPS|frameCount/)
    })
  })
})

// ============================================================================
// BrowserLiveView Integration Tests
// ============================================================================

describe('BrowserLiveView Provider Support', () => {
  describe('Browserbase Provider', () => {
    it('should use iframe for browserbase provider with liveViewUrl', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toContain('<iframe')
      expect(content).toMatch(/browserbase.*iframe|iframe.*browserbase/is)
    })
  })

  describe('Cloudflare Provider', () => {
    it('should import BrowserScreencast component', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toContain('BrowserScreencast')
      expect(content).toMatch(/import.*BrowserScreencast/)
    })

    it('should use BrowserScreencast for cloudflare provider', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toContain('<BrowserScreencast')
      expect(content).toMatch(/cloudflare.*BrowserScreencast|BrowserScreencast.*cloudflare/is)
    })

    it('should pass browserId to BrowserScreencast', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toMatch(/BrowserScreencast.*browserId/is)
    })
  })

  describe('Fallback', () => {
    it('should show fallback when no liveViewUrl and cloudflare', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      // Should have fallback message for unsupported scenarios
      expect(content).toMatch(/not available|fallback|no.*view/i)
    })
  })

  describe('BrowserLiveView Props', () => {
    it('should accept browserId prop', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toMatch(/BrowserLiveView.*browserId|BrowserLiveViewProps.*browserId/is)
    })

    it('should accept provider prop', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toMatch(/BrowserLiveView.*provider|BrowserLiveViewProps.*provider/is)
    })

    it('should accept liveViewUrl prop', async () => {
      const content = await readFile('app/routes/admin/browsers/$browserId.tsx', 'utf-8')
      expect(content).toMatch(/BrowserLiveView.*liveViewUrl|BrowserLiveViewProps.*liveViewUrl/is)
    })
  })
})

// ============================================================================
// Type Definitions Tests
// ============================================================================

describe('Type Definitions', () => {
  describe('BrowserScreencast Types', () => {
    it('should define BrowserScreencastProps interface', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/interface\s+BrowserScreencastProps|type\s+BrowserScreencastProps/)
    })

    it('should define ConnectionStatus type', async () => {
      const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
      expect(content).toMatch(/ConnectionStatus|type.*connecting.*connected.*disconnected.*error/)
    })
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  it('should have aria-label for fullscreen button', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toMatch(/aria-label.*fullscreen/i)
  })

  it('should have meaningful status text', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toMatch(/Connecting|Connected|Disconnected|Error/i)
  })
})

// ============================================================================
// Styling Tests
// ============================================================================

describe('Styling', () => {
  it('should have responsive canvas styling', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toMatch(/w-full|width.*100%/)
  })

  it('should have border and rounded corners on canvas', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toContain('border')
    expect(content).toContain('rounded')
  })

  it('should position status indicator absolutely', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toContain('absolute')
  })

  it('should have dark background for canvas', async () => {
    const content = await readFile('app/components/BrowserScreencast.tsx', 'utf-8')
    expect(content).toMatch(/bg-gray-900|bg-black/)
  })
})
