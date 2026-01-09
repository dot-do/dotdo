/**
 * TerminalEmbed Component Tests (TDD RED Phase)
 *
 * Tests for the TerminalEmbed component that provides WebSocket-connected
 * terminal rendering using xterm.js for sandbox terminal sessions.
 *
 * These tests verify:
 * - Component structure and exports
 * - WebSocket connection lifecycle
 * - Terminal input/output handling via xterm.js
 * - Connection status display
 * - Error handling
 * - Cleanup on unmount
 * - Fullscreen toggle
 * - Resize handling with FitAddon
 * - Callback props (onConnected, onDisconnected, onError)
 *
 * @see app/components/TerminalEmbed.tsx
 * @see objects/Sandbox.ts - Sandbox Durable Object
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// Component File Structure Tests
// ============================================================================

describe('TerminalEmbed Component Structure', () => {
  describe('app/components/TerminalEmbed.tsx', () => {
    it('should exist as a component file', () => {
      expect(existsSync('app/components/TerminalEmbed.tsx')).toBe(true)
    })

    it('should export TerminalEmbed component', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/export\s+(function|const)\s+TerminalEmbed/)
    })

    it('should have default export', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('export default')
    })

    it('should import React hooks', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('useRef')
      expect(content).toContain('useState')
      expect(content).toContain('useEffect')
      expect(content).toContain('useCallback')
    })
  })
})

// ============================================================================
// TerminalEmbed Component Tests
// ============================================================================

describe('TerminalEmbed', () => {
  describe('Terminal Container', () => {
    it('should render terminal container with data-testid', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('data-testid="terminal-container"')
    })

    it('should have ref for terminal container', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/terminalRef|containerRef/)
    })
  })

  describe('xterm.js Integration', () => {
    it('should import Terminal from @xterm/xterm', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain("from '@xterm/xterm'")
      expect(content).toContain('Terminal')
    })

    it('should import FitAddon from @xterm/addon-fit', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain("from '@xterm/addon-fit'")
      expect(content).toContain('FitAddon')
    })

    it('should import xterm CSS', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/@xterm\/xterm\/css\/xterm\.css|xterm\.css/)
    })

    it('should create Terminal instance', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/new Terminal/)
    })

    it('should create FitAddon instance', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/new FitAddon/)
    })

    it('should load FitAddon into terminal', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/loadAddon.*fitAddon|terminal\.loadAddon/i)
    })

    it('should open terminal in container element', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/terminal\.open|\.open\(/)
    })

    it('should call fit() after opening terminal', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/fitAddon\.fit|\.fit\(\)/)
    })

    it('should store terminal reference', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/xtermRef|termRef|terminalRef.*Terminal/)
    })
  })

  describe('Connection Status', () => {
    it('should show "Connecting..." initially', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('Connecting')
    })

    it('should have connection status state', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/status|connectionStatus|ConnectionStatus/i)
      expect(content).toContain('connecting')
    })

    it('should show "Connected" after WebSocket opens', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('connected')
      expect(content).toMatch(/ws\.onopen|onopen/)
    })

    it('should render status indicator with data-testid', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('data-testid="terminal-status"')
    })

    it('should have status indicator with color coding', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/bg-green|green-500|green/i)
      expect(content).toMatch(/bg-yellow|yellow-500|yellow/i)
      expect(content).toMatch(/bg-red|red-500|red/i)
    })
  })

  describe('WebSocket Connection', () => {
    it('should connect to WebSocket on mount', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('WebSocket')
      expect(content).toMatch(/useEffect/)
    })

    it('should construct correct WebSocket URL with sandboxId', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      // Should build URL like /api/sandboxes/${sandboxId}/terminal
      expect(content).toMatch(/sandboxes.*terminal|\/api\/sandboxes.*terminal/i)
      expect(content).toContain('sandboxId')
    })

    it('should use wss: or ws: based on page protocol', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/wss:|ws:|protocol/)
    })

    it('should store WebSocket reference', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/wsRef|webSocketRef|socketRef/)
    })
  })

  describe('Terminal Output', () => {
    it('should handle output messages from WebSocket', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onmessage|type.*output|output.*type/i)
    })

    it('should write output data to terminal', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/terminal\.write|\.write\(/)
    })

    it('should handle error messages from WebSocket', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*error|error.*type/i)
    })
  })

  describe('Terminal Input', () => {
    it('should register onData handler for terminal input', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onData|terminal\.onData/)
    })

    it('should send input to WebSocket', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/ws\.send|send.*input|type.*input/i)
    })
  })

  describe('Resize Handling', () => {
    it('should handle terminal resize events', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onResize|resize/i)
    })

    it('should send resize message to WebSocket', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*resize|resize.*cols|cols.*rows/i)
    })
  })

  describe('Error Handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onerror|error/i)
      expect(content).toContain('error')
    })

    it('should show error status when connection fails', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/status.*error|setStatus.*error|Error/i)
    })

    it('should handle disconnected state', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('disconnected')
      expect(content).toMatch(/onclose/)
    })
  })

  describe('Cleanup', () => {
    it('should clean up WebSocket on unmount', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      // useEffect should return cleanup function that closes WebSocket
      expect(content).toMatch(/return.*\{[\s\S]*ws\.close|close\(\)/)
    })

    it('should clean up terminal on unmount', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/terminal\.dispose|\.dispose\(\)/)
    })
  })

  describe('Fullscreen', () => {
    it('should support fullscreen toggle', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/fullscreen|isFullscreen|toggleFullscreen/i)
    })

    it('should have fullscreen button', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/button.*fullscreen|onClick.*fullscreen/is)
    })

    it('should use requestFullscreen API', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/requestFullscreen|exitFullscreen/)
    })

    it('should have aria-label for fullscreen button', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/aria-label.*fullscreen/i)
    })
  })

  describe('Callback Props', () => {
    it('should call onConnected callback when connected', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onConnected\?\.\(\)|onConnected\s*&&|onConnected\s*\(/)
    })

    it('should call onDisconnected callback on disconnect', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onDisconnected\?\.\(\)|onDisconnected\s*&&|onDisconnected\s*\(/)
    })

    it('should call onError callback on error', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onError\?\.\(|onError\s*&&|onError\s*\(/)
    })
  })

  describe('Props', () => {
    it('should accept sandboxId prop', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('sandboxId')
    })

    it('should accept className prop', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toContain('className')
    })

    it('should accept optional onConnected prop', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onConnected\??:/)
    })

    it('should accept optional onDisconnected prop', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onDisconnected\??:/)
    })

    it('should accept optional onError prop', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/onError\??:/)
    })
  })
})

// ============================================================================
// Type Definitions Tests
// ============================================================================

describe('Type Definitions', () => {
  describe('TerminalEmbed Types', () => {
    it('should define TerminalEmbedProps interface', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/interface\s+TerminalEmbedProps|type\s+TerminalEmbedProps/)
    })

    it('should export TerminalEmbedProps type', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/export.*TerminalEmbedProps/)
    })

    it('should define ConnectionStatus type', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/ConnectionStatus|type.*connecting.*connected.*disconnected.*error/)
    })
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  it('should have aria-label for fullscreen button', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toMatch(/aria-label.*fullscreen/i)
  })

  it('should have meaningful status text', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toMatch(/Connecting|Connected|Disconnected|Error/i)
  })
})

// ============================================================================
// Styling Tests
// ============================================================================

describe('Styling', () => {
  it('should have terminal container styling', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toMatch(/className|class/)
  })

  it('should have border and rounded corners', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toContain('border')
    expect(content).toContain('rounded')
  })

  it('should position status indicator absolutely', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toContain('absolute')
  })

  it('should have dark background for terminal', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toMatch(/bg-gray-900|bg-black/)
  })

  it('should support custom className prop', async () => {
    const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
    expect(content).toMatch(/className.*\$\{className|className.*\|\||className.*&&/)
  })
})

// ============================================================================
// WebSocket Protocol Tests
// ============================================================================

describe('WebSocket Protocol', () => {
  describe('Client to Server Messages', () => {
    it('should send input messages', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*input|'input'|"input"/)
    })

    it('should send resize messages with cols and rows', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*resize|'resize'|"resize"/)
      expect(content).toMatch(/cols/)
      expect(content).toMatch(/rows/)
    })
  })

  describe('Server to Client Messages', () => {
    it('should handle output messages', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*output|'output'|"output"/)
    })

    it('should handle error messages', async () => {
      const content = await readFile('app/components/TerminalEmbed.tsx', 'utf-8')
      expect(content).toMatch(/type.*error|'error'|"error"/)
    })
  })
})
